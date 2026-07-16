#!/usr/bin/env node
/**
 * Search the latest All the Places spider inventory without downloading
 * full GeoJSON outputs.
 */

const DEFAULT_LATEST_URL = 'https://data.alltheplaces.xyz/runs/latest.json';
const DEFAULT_TERMS = [
  'pizza',
  'pizzeria',
  'domino',
  'papa',
  'howie',
  'jet',
  'marco',
  'caesars',
  'hut',
  'murphy',
  'mod',
  'grimaldi',
  'monical',
  'gatti',
  'fox',
];

function parseArgs(argv) {
  const args = {
    latestUrl: DEFAULT_LATEST_URL,
    statsUrl: null,
    outputBaseUrl: null,
    terms: DEFAULT_TERMS,
    limit: 25,
    minFeatures: 1,
    validateOutput: false,
    printImportCommand: false,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--latest-url') args.latestUrl = argv[++i];
    else if (arg === '--stats-url') args.statsUrl = argv[++i];
    else if (arg === '--output-base-url') args.outputBaseUrl = argv[++i].replace(/\/$/, '');
    else if (arg === '--terms') args.terms = splitList(argv[++i]);
    else if (arg === '--term') args.terms.push(argv[++i]);
    else if (arg === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (arg === '--min-features') args.minFeatures = parseInt(argv[++i], 10);
    else if (arg === '--include-empty') args.minFeatures = 0;
    else if (arg === '--validate-output') args.validateOutput = true;
    else if (arg === '--print-import-command') args.printImportCommand = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.terms = [...new Set(args.terms.map(term => term.trim().toLowerCase()).filter(Boolean))];
  if (!args.terms.length) throw new Error('At least one search term is required.');
  if (!Number.isFinite(args.limit) || args.limit <= 0) throw new Error('Invalid --limit');
  if (!Number.isFinite(args.minFeatures) || args.minFeatures < 0) throw new Error('Invalid --min-features');
  return args;
}

function splitList(value) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function printHelp() {
  console.log(`Usage: node scripts/ops/discover-atp-spiders.mjs [options]

Options:
  --terms <a,b,c>        Comma-separated spider search terms
  --term <value>         Add one search term
  --limit <n>            Max rows printed per term (default 25)
  --min-features <n>     Hide spiders below feature count (default 1)
  --include-empty        Include zero-feature spiders
  --validate-output      HEAD-check matched GeoJSON URLs
  --print-import-command Print an import-atp-spiders command for displayed rows
  --latest-url <url>     ATP latest metadata URL
  --stats-url <url>      ATP stats _results.json URL
  --output-base-url <u>  GeoJSON output base URL
  --json                 Emit JSON instead of Markdown

This is read-only. It searches ATP run metadata and does not download full
spider outputs.
`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.json();
}

function deriveOutputBaseUrl(latest, args) {
  if (args.outputBaseUrl) return args.outputBaseUrl;
  if (latest?.stats_url) return latest.stats_url.replace(/\/stats\/_results\.json$/, '/output');
  return 'https://data.alltheplaces.xyz/runs/latest/output';
}

function normalizeResult(result) {
  return {
    spider: String(result.spider || ''),
    filename: String(result.filename || ''),
    features: Number.isFinite(result.features) ? result.features : 0,
    errors: Number.isFinite(result.errors) ? result.errors : 0,
    elapsed_time: Number.isFinite(result.elapsed_time) ? result.elapsed_time : null,
  };
}

function findMatches(results, terms, minFeatures) {
  const rowsByTerm = new Map(terms.map(term => [term, []]));
  const unique = new Map();

  for (const result of results.map(normalizeResult)) {
    if (result.features < minFeatures) continue;
    const haystack = `${result.spider} ${result.filename}`.toLowerCase();
    const matchedTerms = terms.filter(term => haystack.includes(term));
    if (!matchedTerms.length) continue;

    const row = { ...result, matched_terms: matchedTerms };
    unique.set(result.spider, row);
    for (const term of matchedTerms) rowsByTerm.get(term).push(row);
  }

  for (const rows of rowsByTerm.values()) {
    rows.sort(compareRows);
  }

  return { rowsByTerm, uniqueRows: [...unique.values()].sort(compareRows) };
}

function compareRows(a, b) {
  return b.features - a.features || a.spider.localeCompare(b.spider);
}

async function addOutputChecks(rows, outputBaseUrl) {
  await Promise.all(rows.map(async row => {
    const url = `${outputBaseUrl}/${row.spider}.geojson`;
    row.output_url = url;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      row.output_status = response.status;
    } catch (error) {
      row.output_status = `error: ${error.message}`;
    }
  }));
}

function printMarkdown({ latest, outputBaseUrl, rowsByTerm, args }) {
  const visibleRows = visibleUniqueRows(rowsByTerm, args.limit);

  console.log('# All the Places Spider Discovery');
  if (latest?.run_id) console.log(`run_id: ${latest.run_id}`);
  if (latest?.end_time) console.log(`run_ended: ${latest.end_time}`);
  console.log(`stats_url: ${args.statsUrl || latest?.stats_url || '(custom)'}`);
  console.log(`output_base_url: ${outputBaseUrl}`);
  console.log('');

  console.log('## Search Terms');
  console.log('| term | matches | top_spiders |');
  console.log('| --- | ---: | --- |');
  for (const [term, rows] of rowsByTerm.entries()) {
    const top = rows.slice(0, Math.min(5, args.limit)).map(row => row.spider).join(', ') || '-';
    console.log(`| ${term} | ${rows.length} | ${top} |`);
  }
  console.log('');

  console.log(`## Displayed Unique Matches`);
  console.log('| spider | features | errors | matched_terms | output | filename |');
  console.log('| --- | ---: | ---: | --- | --- | --- |');
  for (const row of visibleRows) {
    const output = row.output_status === undefined ? `${outputBaseUrl}/${row.spider}.geojson` : `${row.output_status} ${row.output_url}`;
    console.log(`| ${row.spider} | ${row.features} | ${row.errors} | ${row.matched_terms.join(', ')} | ${output} | ${row.filename} |`);
  }
  console.log('');

  if (args.printImportCommand) {
    console.log('## Import Command');
    const usable = visibleRows.filter(row => row.features > 0 && row.errors === 0).map(row => row.spider);
    if (usable.length) {
      console.log('```bash');
      console.log(`node scripts/ops/import-atp-spiders.mjs --spiders ${usable.join(',')}`);
      console.log('```');
      console.log('');
      console.log('Review the displayed spider names before running this command; broad terms can match unrelated brands.');
    } else {
      console.log('No zero-error, non-empty spider matches found for these terms.');
    }
  }
}

function visibleUniqueRows(rowsByTerm, limit) {
  const bySpider = new Map();
  for (const rows of rowsByTerm.values()) {
    for (const row of rows.slice(0, limit)) {
      bySpider.set(row.spider, row);
    }
  }
  return [...bySpider.values()].sort(compareRows);
}

async function main() {
  const args = parseArgs(process.argv);
  const latest = args.statsUrl ? null : await fetchJson(args.latestUrl);
  const statsUrl = args.statsUrl || latest.stats_url;
  if (!statsUrl) throw new Error('Could not determine stats URL.');

  const stats = await fetchJson(statsUrl);
  const results = Array.isArray(stats.results) ? stats.results : [];
  const outputBaseUrl = deriveOutputBaseUrl(latest, args);
  const matches = findMatches(results, args.terms, args.minFeatures);

  if (args.validateOutput) await addOutputChecks(matches.uniqueRows, outputBaseUrl);

  const payload = {
    latest,
    stats_url: statsUrl,
    output_base_url: outputBaseUrl,
    terms: args.terms,
    matches_by_term: Object.fromEntries(matches.rowsByTerm.entries()),
    unique_matches: matches.uniqueRows,
  };

  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printMarkdown({ latest, outputBaseUrl, rowsByTerm: matches.rowsByTerm, args });
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
