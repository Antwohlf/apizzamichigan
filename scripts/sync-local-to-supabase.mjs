#!/usr/bin/env node
/**
 * Sync local Postgres enrichment data -> Supabase pizza_places.
 *
 * Mode: Option 2
 * - Overwrite raw enrichment blobs/fields in Supabase when local has a non-null value.
 * - Only fill NULLs for protected/user-facing fields (style/price/price_range/style_confidence).
 * - Never touches core identity fields (name/lat/lng/address/state/google_place_id/status/notes/rating).
 *
 * Requires .env.local:
 * - VITE_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * Optional local DB overrides:
 * - LOCAL_DB_HOST, LOCAL_DB_PORT, LOCAL_DB_NAME, LOCAL_DB_USER, LOCAL_DB_PASSWORD
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const out = {
    batch: 500,
    startAfter: 0,
    maxBatches: 0, // 0 = unlimited
    dryRun: false,
    verbose: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--batch') out.batch = parseInt(argv[++i], 10);
    else if (a === '--start-after') out.startAfter = parseInt(argv[++i], 10);
    else if (a === '--max-batches') out.maxBatches = parseInt(argv[++i], 10);
    else if (a === '--help') {
      console.log(`Usage: node scripts/sync-local-to-supabase.mjs [options]

Options:
  --batch <n>        Batch size (default 500)
  --start-after <id> Start after this numeric id (default 0)
  --max-batches <n>  Stop after n batches (default 0 = unlimited)
  --dry-run          Print what would happen, do not write to Supabase
  --verbose          Extra logging
`);
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.batch) || out.batch <= 0) throw new Error('Invalid --batch');
  if (!Number.isFinite(out.startAfter) || out.startAfter < 0) throw new Error('Invalid --start-after');
  if (!Number.isFinite(out.maxBatches) || out.maxBatches < 0) throw new Error('Invalid --max-batches');
  return out;
}

function loadEnvLocal() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return {};
  const txt = readFileSync(p, 'utf8');
  const out = {};
  for (const line of txt.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

const OVERWRITE_COLS = [
  // enrichment/meta
  'created_at',
  'updated_at',
  'enrichment_status',
  'last_enriched_at',
  'enrichment_agent',
  'enrichment_run_id',

  // classification extras (these are metadata; safe to overwrite)
  'address_source',

  // website/contact/social
  'website_url',
  'menu_url',
  'phone',
  'email',
  'instagram_url',
  'facebook_url',
  'twitter_url',
  'whatsapp',

  // hours
  'hours',

  // scraping
  'scrape_method',
  'scrape_notes',

  // amenities
  'delivery',
  'takeaway',
  'drive_through',
  'outdoor_seating',
  'indoor_seating',
  'wheelchair',

  // brand/operator
  'brand',
  'brand_wikidata',
  'operator',
  'operator_wikidata',

  // OSM enrichment
  'osm_tags',
  'osm_last_fetched_at',
  'osm_fetch_status',
  'osm_fetch_error',

  // menu parse
  'menu_data',
  'menu_parse_confidence',
  'menu_parse_notes',
  'menu_last_parsed_at',

  // QA defaults (only set if supabase null; handled separately)
];

const FILL_IF_NULL_COLS = [
  // user-facing derived fields
  'style',
  'price',
  'price_range',
  'style_confidence',
];

function hasAnyNonNull(obj, cols) {
  return cols.some(c => obj[c] !== null && obj[c] !== undefined);
}

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnvLocal();

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }

  const dbConfig = {
    host: env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(env.LOCAL_DB_PORT || '5432', 10),
    database: env.LOCAL_DB_NAME || 'pizza_enrichment',
    user: env.LOCAL_DB_USER || process.env.USER,
    password: env.LOCAL_DB_PASSWORD || '',
  };

  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const client = new pg.Client(dbConfig);
  await client.connect();

  let cursor = args.startAfter;
  let batchNum = 0;
  let totalUpdates = 0;
  let totalRowsScanned = 0;

  try {
    while (true) {
      if (args.maxBatches && batchNum >= args.maxBatches) break;

      // Pull a chunk of local rows that have anything worth syncing.
      // (We still include rows where only style/price are present so we can NULL-fill.)
      const q = `
        select
          id,
          style,
          price,
          price_range,
          style_confidence,

          created_at,
          updated_at,
          enrichment_status,
          last_enriched_at,
          enrichment_agent,
          enrichment_run_id,

          address_source,

          website_url,
          menu_url,
          phone,
          email,
          instagram_url,
          facebook_url,
          twitter_url,
          whatsapp,

          hours,

          scrape_method,
          scrape_notes,

          delivery,
          takeaway,
          drive_through,
          outdoor_seating,
          indoor_seating,
          wheelchair,

          brand,
          brand_wikidata,
          operator,
          operator_wikidata,

          osm_tags,
          osm_last_fetched_at,
          osm_fetch_status,
          osm_fetch_error,

          menu_data,
          menu_parse_confidence,
          menu_parse_notes,
          menu_last_parsed_at
        from pizza_places
        where id > $1
          and (
            style is not null
            or price is not null
            or price_range is not null
            or style_confidence is not null
            or website_url is not null
            or menu_url is not null
            or phone is not null
            or email is not null
            or instagram_url is not null
            or facebook_url is not null
            or twitter_url is not null
            or whatsapp is not null
            or hours is not null
            or scrape_method is not null
            or scrape_notes is not null
            or osm_tags is not null
            or osm_last_fetched_at is not null
            or osm_fetch_status is not null
            or osm_fetch_error is not null
            or menu_data is not null
            or menu_parse_confidence is not null
            or menu_parse_notes is not null
            or menu_last_parsed_at is not null
            or enrichment_status is not null
            or last_enriched_at is not null
            or enrichment_agent is not null
            or enrichment_run_id is not null
            or address_source is not null
            or delivery is not null
            or takeaway is not null
            or drive_through is not null
            or outdoor_seating is not null
            or indoor_seating is not null
            or wheelchair is not null
            or brand is not null
            or brand_wikidata is not null
            or operator is not null
            or operator_wikidata is not null
          )
        order by id asc
        limit $2
      `;

      const { rows: localRows } = await client.query(q, [cursor, args.batch]);
      if (!localRows.length) break;

      batchNum++;
      totalRowsScanned += localRows.length;
      cursor = localRows[localRows.length - 1].id;

      const ids = localRows.map(r => r.id);

      // Fetch current supabase state for protected fields + QA.
      const { data: sbRows, error: sbErr } = await sb
        .from('pizza_places')
        .select('id, style, price, price_range, style_confidence, qa_status, qa_schema_version')
        .in('id', ids);

      if (sbErr) throw sbErr;

      // Supabase may return ids as strings; normalize keys to string for reliable lookup.
      const sbMap = new Map((sbRows || []).map(r => [String(r.id), r]));

      const updates = [];
      let wouldUpdate = 0;

      for (const local of localRows) {
        const current = sbMap.get(String(local.id));
        if (!current) {
          // No row in Supabase with this id. We skip to avoid duplicates.
          if (args.verbose) console.warn('[skip missing supabase row]', local.id);
          continue;
        }

        const payload = { id: local.id };

        // Overwrite-style: set when local has a non-null value.
        for (const col of OVERWRITE_COLS) {
          const v = local[col];
          if (v !== null && v !== undefined) payload[col] = v;
        }

        // NULL-fill style fields.
        for (const col of FILL_IF_NULL_COLS) {
          const localV = local[col];
          const sbV = current[col];
          if ((sbV === null || sbV === undefined) && localV !== null && localV !== undefined) {
            payload[col] = localV;
          }
        }

        // QA defaults: only fill if currently null.
        if (current.qa_status == null) payload.qa_status = 'unreviewed';
        if (current.qa_schema_version == null) payload.qa_schema_version = 1;

        // If we're not changing anything, skip.
        const keys = Object.keys(payload);
        if (keys.length > 1) {
          // Touch updated_at if we changed anything and local didn't provide one.
          if (!('updated_at' in payload)) payload.updated_at = new Date().toISOString();
          updates.push(payload);
          wouldUpdate++;
        }
      }

      if (args.dryRun) {
        console.log(`[dry-run] batch ${batchNum}: local_rows=${localRows.length} supabase_rows=${(sbRows||[]).length} would_update=${wouldUpdate} cursor=${cursor}`);
        if (args.verbose && updates.length) {
          console.log('sample update payload:', JSON.stringify(updates[0], null, 2));
        }
        continue;
      }

      if (!updates.length) {
        console.log(`[ok] batch ${batchNum}: nothing to update (local_rows=${localRows.length}, cursor=${cursor})`);
        continue;
      }

      const { error: upErr } = await sb
        .from('pizza_places')
        .upsert(updates, { onConflict: 'id' });

      if (upErr) throw upErr;

      totalUpdates += updates.length;
      console.log(`[ok] batch ${batchNum}: updated=${updates.length} local_rows=${localRows.length} cursor=${cursor}`);
    }

    console.log(`Done. batches=${batchNum} local_rows_scanned=${totalRowsScanned} supabase_rows_updated=${totalUpdates} last_cursor=${cursor}`);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('sync-local-to-supabase failed:', err);
  process.exit(1);
});
