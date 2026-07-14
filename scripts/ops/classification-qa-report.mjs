#!/usr/bin/env node
/**
 * Read-only QA report for local pizza classification output.
 *
 * This does not mutate queue, Postgres, or Supabase. Use it before any
 * local-to-Supabase write sync.
 */

import pg from 'pg'
import 'dotenv/config'
import { execFileSync } from 'child_process'
import { inferPriceFromChain, inferStyleFromName, isKnownChain } from '../lib/style-inference.mjs'

const PIZZA_STYLES = [
  'Traditional',
  'New York',
  'Chicago',
  'Tavern',
  'Detroit',
  'Neapolitan',
  'Sicilian',
  'Roman',
  'California'
]

const PRICE_RANGES = ['$', '$$', '$$$', '$$$$']
const CONFIDENCES = ['confirmed', 'inferred']

const STYLE_EVIDENCE = {
  Detroit: ['detroit'],
  Chicago: ['chicago', 'deep dish', 'deep-dish', 'stuffed'],
  'New York': ['new york', 'ny style', 'ny-style', 'brooklyn'],
  Neapolitan: ['neapolitan', 'wood fired', 'wood-fired', 'brick oven', 'coal fired', 'napoletana', 'napoli'],
  Sicilian: ['sicilian', 'grandma'],
  Roman: ['roman', 'al taglio', 'taglio'],
  Tavern: ['tavern', 'party cut', 'thin crust', 'square cut'],
  California: ['california'],
  Traditional: ['pizza', 'pizzeria', 'pizzaria', 'pizzería', 'pizzas', 'domino', 'pizza hut', 'papa john', 'little caesars', 'sbarro']
}

const PIZZA_SIGNAL_TERMS = [
  'pizza',
  'pizzeria',
  'pizzaria',
  'pizzería',
  'pizzas',
  'pizz',
  'slice',
  'slices',
  'pie',
  'cuisine":"pizza',
  'cuisine:pizza',
  'italian'
]

function parseArgs(argv) {
  const out = {
    hours: 24,
    limit: 500,
    sample: 25,
    json: false
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--hours') out.hours = parseInt(argv[++i], 10)
    else if (arg === '--limit') out.limit = parseInt(argv[++i], 10)
    else if (arg === '--sample') out.sample = parseInt(argv[++i], 10)
    else if (arg === '--json') out.json = true
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/classification-qa-report.mjs [options]

Options:
  --hours <n>   Review rows enriched in the last n hours (default 24)
  --limit <n>   Maximum recent rows to inspect (default 500)
  --sample <n>  Maximum rows per detail table (default 25)
  --json        Emit JSON instead of Markdown
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(out.hours) || out.hours <= 0) throw new Error('Invalid --hours')
  if (!Number.isFinite(out.limit) || out.limit <= 0) throw new Error('Invalid --limit')
  if (!Number.isFinite(out.sample) || out.sample <= 0) throw new Error('Invalid --sample')

  return out
}

function run(cmd, cmdArgs = [], options = {}) {
  try {
    const stdout = execFileSync(cmd, cmdArgs, {
      encoding: 'utf8',
      timeout: options.timeout || 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    })
    return { ok: true, stdout: stdout.trim(), stderr: '', status: 0 }
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout || '').toString().trim(),
      stderr: (error.stderr || error.message || '').toString().trim(),
      status: error.status ?? 1
    }
  }
}

function repoRoot() {
  const result = run('git', ['rev-parse', '--show-toplevel'])
  return result.ok ? result.stdout : process.cwd()
}

function gitReport(root) {
  return {
    branch: run('git', ['branch', '--show-current'], { cwd: root }).stdout || '(unknown)',
    head: run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).stdout || '(unknown)',
    status: run('git', ['status', '--short', '--branch'], { cwd: root }).stdout || '(status unavailable)'
  }
}

function errorMessage(error) {
  return error?.message || error?.code || String(error)
}

function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function evidenceText(row) {
  return [
    row.name,
    row.website_url,
    toText(row.osm_tags),
    toText(row.scrape_notes)
  ].filter(Boolean).join(' ').toLowerCase()
}

function hasAny(text, terms) {
  return terms.some(term => text.includes(term))
}

function hasStyleEvidence(row) {
  if (!row.style) return true
  const text = evidenceText(row)
  const terms = STYLE_EVIDENCE[row.style] || []
  return terms.length ? hasAny(text, terms) : false
}

function hasPizzaSignal(row) {
  return hasAny(evidenceText(row), PIZZA_SIGNAL_TERMS)
}

function expectedChain(row) {
  if (!isKnownChain(row.name)) return null
  const style = inferStyleFromName(row.name, '')?.style || null
  const priceRange = inferPriceFromChain(row.name)?.price || null
  return { style, price_range: priceRange }
}

function compact(row) {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    google_place_id: row.google_place_id,
    style: row.style,
    price_range: row.price_range,
    style_confidence: row.style_confidence,
    last_enriched_at: row.last_enriched_at
  }
}

function reasoned(row, reason) {
  return { reason, ...compact(row) }
}

function groupCounts(rows, key) {
  const counts = new Map()
  for (const row of rows) {
    const value = row[key] ?? '(null)'
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
}

function pct(n, d) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : '0.0%'
}

async function loadRows(options) {
  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  try {
    await client.connect()
    const summary = await client.query(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL)::int as enriched,
        COUNT(*) FILTER (WHERE style IS NOT NULL OR price_range IS NOT NULL OR style_confidence IS NOT NULL)::int as classified_or_priced,
        COUNT(*) FILTER (WHERE last_enriched_at >= now() - ($1::text || ' hours')::interval)::int as enriched_in_window,
        MAX(last_enriched_at) as last_enriched_at
      FROM pizza_places
    `, [String(options.hours)])

    const recent = await client.query(`
      SELECT
        id,
        name,
        state,
        google_place_id,
        style,
        price_range,
        style_confidence,
        website_url,
        osm_tags,
        scrape_notes,
        scrape_method,
        enrichment_status,
        last_enriched_at
      FROM pizza_places
      WHERE last_enriched_at >= now() - ($1::text || ' hours')::interval
        AND google_place_id LIKE 'osm:%'
      ORDER BY last_enriched_at DESC
      LIMIT $2
    `, [String(options.hours), options.limit])

    return { ok: true, summary: summary.rows[0], rows: recent.rows }
  } catch (error) {
    return { ok: false, error: errorMessage(error), rows: [] }
  } finally {
    await client.end().catch(() => {})
  }
}

function analyze(rows, options) {
  const flags = {
    invalidValues: [],
    confidenceWithoutStyle: [],
    styleWithoutConfidence: [],
    confirmedWithoutEvidence: [],
    chainMismatches: [],
    lowPizzaSignalWithStyle: [],
    priceOnly: [],
    nullOutput: []
  }

  for (const row of rows) {
    if (
      (row.style !== null && !PIZZA_STYLES.includes(row.style)) ||
      (row.price_range !== null && !PRICE_RANGES.includes(row.price_range)) ||
      (row.style_confidence !== null && !CONFIDENCES.includes(row.style_confidence))
    ) {
      flags.invalidValues.push(reasoned(row, 'value outside classifier enum'))
    }

    if (!row.style && row.style_confidence) {
      flags.confidenceWithoutStyle.push(reasoned(row, 'style_confidence present while style is null'))
    }

    if (row.style && !row.style_confidence) {
      flags.styleWithoutConfidence.push(reasoned(row, 'style present while style_confidence is null'))
    }

    if (row.style && row.style_confidence === 'confirmed' && !hasStyleEvidence(row)) {
      flags.confirmedWithoutEvidence.push(reasoned(row, 'confirmed style without matching keyword evidence'))
    }

    const chain = expectedChain(row)
    if (chain) {
      const styleMismatch = chain.style && row.style && chain.style !== row.style
      const priceMismatch = chain.price_range && row.price_range && chain.price_range !== row.price_range
      if (styleMismatch || priceMismatch) {
        flags.chainMismatches.push(reasoned(row, `known chain expected style=${chain.style || ''} price_range=${chain.price_range || ''}`))
      }
    }

    if (row.style && !hasPizzaSignal(row)) {
      flags.lowPizzaSignalWithStyle.push(reasoned(row, 'style assigned with weak pizza signal in name/tags/scrape text'))
    }

    if (!row.style && !row.style_confidence && row.price_range) {
      flags.priceOnly.push(reasoned(row, 'price_range only'))
    }

    if (!row.style && !row.price_range && !row.style_confidence) {
      flags.nullOutput.push(reasoned(row, 'no style, price_range, or confidence written'))
    }
  }

  const totals = {
    inspected: rows.length,
    withStyle: rows.filter(row => row.style).length,
    withPriceRange: rows.filter(row => row.price_range).length,
    withConfidence: rows.filter(row => row.style_confidence).length,
    confirmed: rows.filter(row => row.style_confidence === 'confirmed').length,
    inferred: rows.filter(row => row.style_confidence === 'inferred').length,
    priceOnly: flags.priceOnly.length,
    nullOutput: flags.nullOutput.length
  }

  const issueCount =
    flags.invalidValues.length +
    flags.confidenceWithoutStyle.length +
    flags.styleWithoutConfidence.length +
    flags.chainMismatches.length

  const warningCount = flags.confirmedWithoutEvidence.length + flags.lowPizzaSignalWithStyle.length

  return {
    state: issueCount ? 'FAIL' : warningCount ? 'WARN' : 'OK',
    totals,
    distributions: {
      style: groupCounts(rows, 'style'),
      price_range: groupCounts(rows, 'price_range'),
      style_confidence: groupCounts(rows, 'style_confidence'),
      state: groupCounts(rows, 'state').slice(0, options.sample)
    },
    flags,
    issueCount,
    warningCount
  }
}

function table(headers, rows) {
  if (!rows.length) return '_none_'
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

function sample(rows, options) {
  return rows.slice(0, options.sample)
}

function printFlagTable(title, rows, options) {
  console.log(`## ${title}`)
  console.log(table(['reason', 'id', 'name', 'state', 'google_place_id', 'style', 'price_range', 'style_confidence', 'last_enriched_at'], sample(rows, options)))
  console.log('')
}

async function main() {
  const options = parseArgs(process.argv)
  const root = repoRoot()
  const git = gitReport(root)
  const generatedAt = new Date().toISOString()
  const data = await loadRows(options)

  if (!data.ok) {
    if (options.json) {
      console.log(JSON.stringify({ generatedAt, root, git, ok: false, error: data.error }, null, 2))
    } else {
      console.log('# Classification QA: FAIL')
      console.log('')
      console.log(`Generated: ${generatedAt}`)
      console.log(`Repo: \`${root}\``)
      console.log(`Error: ${data.error}`)
    }
    process.exitCode = 1
    return
  }

  const analysis = analyze(data.rows, options)
  const payload = { generatedAt, root, git, ok: true, options, summary: data.summary, ...analysis }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log(`# Classification QA: ${analysis.state}`)
  console.log('')
  console.log(`Generated: ${generatedAt}`)
  console.log(`Repo: \`${root}\``)
  console.log(`Window: last ${options.hours}h, inspected ${analysis.totals.inspected} most recent OSM rows (limit ${options.limit})`)
  console.log('')

  console.log('## Summary')
  console.log(`- branch/head: \`${git.branch}\` / \`${git.head}\``)
  console.log(`- local pizza rows: ${data.summary.total}`)
  console.log(`- enriched rows: ${data.summary.enriched}`)
  console.log(`- classified_or_priced rows: ${data.summary.classified_or_priced}`)
  console.log(`- enriched in window: ${data.summary.enriched_in_window}`)
  console.log(`- inspected rows: ${analysis.totals.inspected}`)
  console.log(`- with style: ${analysis.totals.withStyle} (${pct(analysis.totals.withStyle, analysis.totals.inspected)})`)
  console.log(`- with price_range: ${analysis.totals.withPriceRange} (${pct(analysis.totals.withPriceRange, analysis.totals.inspected)})`)
  console.log(`- confirmed: ${analysis.totals.confirmed} (${pct(analysis.totals.confirmed, analysis.totals.inspected)})`)
  console.log(`- inferred: ${analysis.totals.inferred} (${pct(analysis.totals.inferred, analysis.totals.inspected)})`)
  console.log(`- price-only rows: ${analysis.totals.priceOnly} (${pct(analysis.totals.priceOnly, analysis.totals.inspected)})`)
  console.log(`- null-output rows: ${analysis.totals.nullOutput} (${pct(analysis.totals.nullOutput, analysis.totals.inspected)})`)
  console.log(`- hard issues: ${analysis.issueCount}`)
  console.log(`- soft warnings: ${analysis.warningCount}`)
  console.log('')

  console.log('## Distributions')
  console.log('### Style')
  console.log(table(['value', 'count'], analysis.distributions.style))
  console.log('')
  console.log('### Price Range')
  console.log(table(['value', 'count'], analysis.distributions.price_range))
  console.log('')
  console.log('### Style Confidence')
  console.log(table(['value', 'count'], analysis.distributions.style_confidence))
  console.log('')

  printFlagTable('Invalid Enum Values', analysis.flags.invalidValues, options)
  printFlagTable('Confidence Without Style', analysis.flags.confidenceWithoutStyle, options)
  printFlagTable('Style Without Confidence', analysis.flags.styleWithoutConfidence, options)
  printFlagTable('Suspicious Confirmed Style Rows', analysis.flags.confirmedWithoutEvidence, options)
  printFlagTable('Known Chain Mismatches', analysis.flags.chainMismatches, options)
  printFlagTable('Low Pizza Signal With Style', analysis.flags.lowPizzaSignalWithStyle, options)
  printFlagTable('Price Only Rows', analysis.flags.priceOnly, options)
  printFlagTable('Null Output Rows', analysis.flags.nullOutput, options)

  console.log('## Recent Sample')
  console.log(table(['id', 'name', 'state', 'google_place_id', 'style', 'price_range', 'style_confidence', 'last_enriched_at'], sample(data.rows.map(compact), options)))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
