#!/usr/bin/env node

/**
 * Read-only AI assistance for ambiguous source-review rows.
 *
 * This script never changes Postgres, the review queue, provenance, or
 * Supabase. It produces decisions for inspection only.
 */

import pg from 'pg'
import { deterministicDecision, evidenceFor, normalizeText } from '../../server/product/source-review-identity.mjs'

const args = parseArgs(process.argv.slice(2))
const table = args.entity === 'taco' ? 'taco_places' : 'pizza_places'
const pool = new pg.Pool({
  host: process.env.LOCAL_DB_HOST || process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.LOCAL_DB_PORT || process.env.PGPORT || 5432),
  database: process.env.LOCAL_DB_NAME || process.env.PGDATABASE || 'pizza_enrichment',
  user: process.env.LOCAL_DB_USER || process.env.PGUSER || process.env.USER,
  password: process.env.LOCAL_DB_PASSWORD || process.env.PGPASSWORD || '',
})

function parseArgs(argv) {
  const out = {
    entity: 'pizza',
    source: '',
    ids: [],
    limit: 10,
    model: process.env.OLLAMA_MODEL || 'llama3.2:latest',
    cache: false,
    deterministicOnly: false,
    json: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--entity') out.entity = argv[++i]
    else if (argv[i] === '--source') out.source = argv[++i]
    else if (argv[i] === '--ids') out.ids = String(argv[++i] || '').split(',').map(Number).filter(Number.isInteger)
    else if (argv[i] === '--limit') out.limit = Math.max(1, Math.min(100, Number(argv[++i]) || 10))
    else if (argv[i] === '--model') out.model = argv[++i]
    else if (argv[i] === '--cache') out.cache = true
    else if (argv[i] === '--deterministic-only') out.deterministicOnly = true
    else if (argv[i] === '--json') out.json = true
  }
  if (!['pizza', 'taco'].includes(out.entity)) throw new Error('Entity must be pizza or taco.')
  return out
}

function normalizeDecision(value) {
  const raw = normalizeText(value).replace(/\s+/g, '_')
  const aliases = {
    same: 'same_place',
    same_business: 'same_place',
    likely_same: 'same_place',
    match: 'same_place',
    matches: 'same_place',
    different: 'different_place',
    different_business: 'different_place',
    not_same: 'different_place',
    no_match: 'different_place',
    replacement: 'business_replacement',
    business_replaced: 'business_replacement',
    replaced: 'business_replacement',
    unclear: 'uncertain',
    unknown: 'uncertain',
    needs_review: 'uncertain',
  }
  return aliases[raw] || raw
}

function promptFor(row, evidence) {
  return `You are reviewing whether two place records describe the same physical restaurant.
Return JSON only with this exact shape:
{"decision":"uncertain","confidence":0.0,"reason":"short explanation","supporting_evidence":["short item"],"needs_human_review":true}

Rules:
- Understand translations, transliterations, alternate scripts, abbreviations, and brand aliases.
- A name translation can support a match but is never enough by itself.
- Use location, address, phone, website, source identity, and business context together.
- If the old business may have been replaced by a new business at the same location, choose business_replacement and needs_human_review=true.
- Any conflict or missing evidence means uncertain and needs_human_review=true.
- Never recommend changing personal history.
- The decision value must be exactly one of: same_place, different_place, business_replacement, uncertain.
- Choose one value. Do not output the list of allowed values or a schema example as the decision.

SOURCE RECORD:
name: ${row.source_name || row.source_id}
source: ${row.source}
source_id: ${row.source_id}
address: ${row.source_data?.address || row.source_data?.['addr:full'] || 'unknown'}
phone: ${row.source_data?.phone || row.source_data?.['contact:phone'] || 'unknown'}
website: ${row.source_data?.website || row.source_data?.['contact:website'] || 'unknown'}

EXISTING MAP RECORD:
name: ${row.nearest_place_name || 'unknown'}
address: ${row.nearest_address || 'unknown'}
phone: ${row.nearest_phone || 'unknown'}
website: ${row.nearest_website_url || 'unknown'}
status: ${row.nearest_status || 'unknown'}
rating: ${row.nearest_rating ?? 'none'}
notes: ${row.nearest_notes || 'none'}

DETERMINISTIC EVIDENCE:
${JSON.stringify(evidence)}`
}

async function askOllama(prompt) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OLLAMA_TIMEOUT_MS || 120000))
  try {
    const response = await fetch(`${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: args.model,
        prompt,
        stream: false,
        format: {
          type: 'object',
          properties: {
            decision: { type: 'string', enum: ['same_place', 'different_place', 'business_replacement', 'uncertain'] },
            confidence: { type: 'number' },
            reason: { type: 'string' },
            supporting_evidence: { type: 'array', items: { type: 'string' } },
            needs_human_review: { type: 'boolean' },
          },
          required: ['decision', 'confidence', 'reason', 'supporting_evidence', 'needs_human_review'],
        },
        options: { temperature: 0, num_predict: 160 },
      }),
    })
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
    const payload = await response.json()
    const text = String(payload.response || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    const result = JSON.parse(text)
    const rawDecision = result.decision
    result.decision = normalizeDecision(result.decision)
    const decisions = new Set(['same_place', 'different_place', 'business_replacement', 'uncertain'])
    if (!decisions.has(result.decision)) throw new Error(`Ollama returned an invalid decision: ${String(rawDecision || 'missing')}`)
    result.confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0))
    result.needs_human_review = result.decision !== 'same_place' || result.needs_human_review !== false
    return result
  } finally {
    clearTimeout(timeout)
  }
}

async function ensureAssessmentTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS source_review_ai_assessments (
      id BIGSERIAL PRIMARY KEY,
      review_queue_id BIGINT NOT NULL,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('pizza', 'taco')),
      model TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('same_place', 'different_place', 'business_replacement', 'uncertain')),
      confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
      reason TEXT,
      supporting_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      needs_human_review BOOLEAN NOT NULL DEFAULT TRUE,
      decision_origin TEXT NOT NULL DEFAULT 'ollama',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (review_queue_id, model)
    )
  `)
}

async function cacheAssessment(row, ai) {
  await pool.query(`
    INSERT INTO source_review_ai_assessments (
      review_queue_id, entity_type, model, decision, confidence, reason,
      supporting_evidence, needs_human_review, decision_origin, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, NOW())
    ON CONFLICT (review_queue_id, model) DO UPDATE SET
      decision = EXCLUDED.decision,
      confidence = EXCLUDED.confidence,
      reason = EXCLUDED.reason,
      supporting_evidence = EXCLUDED.supporting_evidence,
      needs_human_review = EXCLUDED.needs_human_review,
      decision_origin = EXCLUDED.decision_origin,
      created_at = NOW()
  `, [
    row.id,
    args.entity,
    args.model,
    ai.decision,
    ai.confidence,
    ai.reason || null,
    JSON.stringify(ai.supporting_evidence || []),
    ai.needs_human_review !== false,
    ai.decision_origin || 'ollama',
  ])
}

try {
  if (args.cache) await ensureAssessmentTable()
  const values = [args.entity]
  const filters = ["srq.status = 'pending'", "srq.review_kind = 'ambiguous'", 'srq.entity_type = $1']
  if (args.source) {
    values.push(args.source)
    filters.push(`srq.source = $${values.length}`)
  }
  if (args.ids.length) {
    values.push(args.ids)
    filters.push(`srq.id = ANY($${values.length}::bigint[])`)
  }
  values.push(args.limit)
  const result = await pool.query(`
    SELECT srq.id, srq.entity_type, srq.source, srq.source_id, srq.source_name, srq.source_data,
      srq.nearest_place_id, srq.nearest_place_name, srq.nearest_distance_m,
      nearest.google_place_id AS nearest_current_google_place_id,
      nearest.address AS nearest_address,
      nearest.phone AS nearest_phone, nearest.website_url AS nearest_website_url,
      nearest.status AS nearest_status, nearest.rating AS nearest_rating, nearest.notes AS nearest_notes,
      nearest.brand_wikidata AS nearest_brand_wikidata,
      nearest.operator_wikidata AS nearest_operator_wikidata,
      nearest.osm_tags AS nearest_osm_tags
    FROM source_review_queue srq
    LEFT JOIN ${table} nearest ON nearest.id = srq.nearest_place_id
    WHERE ${filters.join(' AND ')}
    ORDER BY srq.nearest_distance_m ASC NULLS LAST, srq.id
    LIMIT $${values.length}
  `, values)

  const rows = []
  for (const row of result.rows) {
    const evidence = evidenceFor(row)
    let ai
    try {
      const deterministic = deterministicDecision(row, evidence)
      if (deterministic) {
        ai = deterministic
      } else if (args.deterministicOnly) {
        ai = {
          decision: 'uncertain',
          confidence: 0,
          reason: 'No deterministic identity signal matched; Ollama was skipped for this row.',
          supporting_evidence: [],
          needs_human_review: true,
          decision_origin: 'deterministic_only',
        }
      } else {
        ai = await askOllama(promptFor(row, evidence))
        ai.decision_origin ||= 'ollama'
      }
    } catch (error) {
      ai = { decision: 'uncertain', confidence: 0, reason: error.message, supporting_evidence: [], needs_human_review: true }
    }
    if (args.cache && (!args.deterministicOnly || ai.decision_origin !== 'deterministic_only')) {
      await cacheAssessment(row, ai)
    }
    rows.push({ id: row.id, source: row.source, source_name: row.source_name, nearest_place_name: row.nearest_place_name, evidence, ai })
  }

  const report = { mode: args.cache ? 'cache' : 'dry-run', model: args.model, entity: args.entity, generated_at: new Date().toISOString(), rows }
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`AI source review dry-run (${args.entity}, ${args.model})`)
    for (const row of rows) console.log(`#${row.id} ${row.source_name} -> ${row.nearest_place_name}: ${row.ai.decision} (${row.ai.confidence.toFixed(2)}) — ${row.ai.reason}`)
  }
} finally {
  await pool.end()
}
