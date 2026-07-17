#!/usr/bin/env node
/**
 * Apply local deterministic pizza style/price inference to exact canonical rows.
 *
 * This is for reviewed-new source imports that have enough identity evidence
 * to become canonical rows, but no per-location website to scrape. Default mode
 * is dry-run. It writes only local Postgres pizza_places when --apply is set and
 * never writes Supabase, source review state, or provenance tables.
 */

import pg from 'pg';
import 'dotenv/config';
import { inferPriceFromChain, inferStyleFromName } from '../lib/style-inference.mjs';

function parseInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseInteger(item, '--ids'));
}

function parseArgs(argv) {
  const args = {
    ids: [],
    minPlaceId: null,
    maxPlaceId: null,
    idPrefix: null,
    limit: 250,
    apply: false,
    json: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ids') args.ids = parseIds(argv[++i]);
    else if (arg === '--min-place-id') args.minPlaceId = parseInteger(argv[++i], '--min-place-id');
    else if (arg === '--max-place-id') args.maxPlaceId = parseInteger(argv[++i], '--max-place-id');
    else if (arg === '--id-prefix') args.idPrefix = argv[++i];
    else if (arg === '--limit') args.limit = parseInteger(argv[++i], '--limit');
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  const hasIds = args.ids.length > 0;
  const hasRange = Number.isFinite(args.minPlaceId) && Number.isFinite(args.maxPlaceId);
  if (!args.help && !hasIds && !hasRange) {
    throw new Error('Use --ids or both --min-place-id and --max-place-id.');
  }
  if (hasIds && hasRange) throw new Error('Use --ids or an ID range, not both.');
  if (hasRange && args.maxPlaceId < args.minPlaceId) throw new Error('--max-place-id must be >= --min-place-id.');
  if (!Number.isFinite(args.limit) || args.limit <= 0 || args.limit > 1000) {
    throw new Error('--limit must be between 1 and 1000.');
  }
  if (args.ids.length > 1000) throw new Error('--ids supports at most 1000 rows per run.');

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/apply-deterministic-classification.mjs [options]

Options:
  --ids <ids>              Exact local pizza_places ids
  --min-place-id <id>      Minimum local pizza_places id
  --max-place-id <id>      Maximum local pizza_places id
  --id-prefix <prefix>     Optional google_place_id prefix guard
  --limit <n>              Maximum rows to inspect (default 250, max 1000)
  --apply                  Write local Postgres updates
  --json                   Emit JSON instead of a text report
  --help                   Print this help

Default mode is dry-run. This command only fills null style, price_range, and
style_confidence from deterministic chain inference. It never writes Supabase.
`);
}

function compactRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    state: row.state,
    google_place_id: row.google_place_id,
    existing_style: row.style,
    existing_price_range: row.price_range,
    existing_style_confidence: row.style_confidence,
  };
}

function classify(row) {
  const styleResult = inferStyleFromName(row.name, row.address || '');
  const priceResult = inferPriceFromChain(row.name);
  const style = row.style || styleResult.style || null;
  const priceRange = row.price_range || priceResult.price || null;
  const styleConfidence = row.style_confidence || (styleResult.style ? 'inferred' : null);

  const changes = {};
  if (!row.style && styleResult.style) changes.style = styleResult.style;
  if (!row.price_range && priceResult.price) changes.price_range = priceResult.price;
  if (!row.style_confidence && styleResult.style) changes.style_confidence = 'inferred';

  return {
    ...compactRow(row),
    inferred_style: styleResult.style,
    inferred_style_match: styleResult.match,
    inferred_price_range: priceResult.price,
    inferred_price_match: priceResult.match,
    final_style: style,
    final_price_range: priceRange,
    final_style_confidence: styleConfidence,
    changes,
    will_update: Object.keys(changes).length > 0,
  };
}

async function fetchRows(client, args) {
  const clauses = [];
  const params = [];

  if (args.ids.length) {
    params.push(args.ids);
    clauses.push(`id = ANY($${params.length}::int[])`);
  } else {
    params.push(args.minPlaceId);
    clauses.push(`id >= $${params.length}`);
    params.push(args.maxPlaceId);
    clauses.push(`id <= $${params.length}`);
  }

  if (args.idPrefix) {
    params.push(`${args.idPrefix}%`);
    clauses.push(`google_place_id LIKE $${params.length}`);
  }

  params.push(args.limit);

  const result = await client.query(
    `SELECT id, name, state, google_place_id, address, style, price_range, style_confidence
     FROM pizza_places
     WHERE ${clauses.join(' AND ')}
     ORDER BY id
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

async function applyUpdates(client, classifiedRows) {
  const updated = [];
  for (const row of classifiedRows) {
    if (!row.will_update) continue;
    const result = await client.query(
      `UPDATE pizza_places
       SET style = COALESCE(style, $2),
           price_range = COALESCE(price_range, $3),
           style_confidence = COALESCE(style_confidence, $4),
           last_enriched_at = NOW()
       WHERE id = $1
       RETURNING id, name, state, google_place_id, style, price_range, style_confidence`,
      [
        row.id,
        row.changes.style || null,
        row.changes.price_range || null,
        row.changes.style_confidence || null,
      ]
    );
    if (result.rows[0]) updated.push(result.rows[0]);
  }
  return updated;
}

function textReport(payload) {
  console.log('# Deterministic Classification Report');
  console.log(`Mode: ${payload.mode}`);
  console.log(`Rows inspected: ${payload.rows_inspected}`);
  console.log(`Rows with deterministic inference: ${payload.rows_with_inference}`);
  console.log(`Rows needing update: ${payload.rows_needing_update}`);
  console.log(`Rows updated: ${payload.rows_updated}`);
  console.log('');
  console.log('| id | name | state | style | price_range | confidence | changes |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of payload.rows) {
    const changes = Object.keys(row.changes).join(', ');
    console.log(`| ${row.id} | ${row.name || ''} | ${row.state || ''} | ${row.final_style || ''} | ${row.final_price_range || ''} | ${row.final_style_confidence || ''} | ${changes} |`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? Number.parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || '',
  });

  await client.connect();
  try {
    const rows = await fetchRows(client, args);
    const classifiedRows = rows.map(classify);
    const updatedRows = args.apply ? await applyUpdates(client, classifiedRows) : [];
    const payload = {
      generated_at: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      rows_inspected: rows.length,
      rows_with_inference: classifiedRows.filter((row) => row.inferred_style || row.inferred_price_range).length,
      rows_needing_update: classifiedRows.filter((row) => row.will_update).length,
      rows_updated: updatedRows.length,
      rows: classifiedRows,
      updated_rows: updatedRows,
    };

    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else textReport(payload);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`apply-deterministic-classification failed: ${error.message || error}`);
  process.exit(1);
});
