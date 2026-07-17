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
import {
  checkpointFromRow,
  readSyncCheckpoint,
  writeSyncCheckpoint,
} from './lib/supabase-sync-checkpoint.mjs';
import {
  SUPABASE_SYNC_TARGET_TABLE,
  buildSupabasePayload,
  assertSupabaseSyncTableBoundary,
  localSyncSelectParams,
  localSyncSelectSql,
  SUPABASE_SYNC_SELECT_COLS,
  buildSupabaseInsertPayload,
} from './lib/supabase-sync-policy.mjs';

function parseArgs(argv) {
  const out = {
    ids: [],
    batch: 500,
    startAfter: 0,
    maxBatches: 0, // 0 = unlimited
    dryRun: false,
    verbose: false,
    changedSinceHours: null,
    onlyClassified: false,
    insertMissingReviewedNew: false,
    checkpointPath: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--only-classified') out.onlyClassified = true;
    else if (a === '--insert-missing-reviewed-new') out.insertMissingReviewedNew = true;
    else if (a === '--ids') out.ids = parseIds(argv[++i]);
    else if (a === '--batch') out.batch = parseInt(argv[++i], 10);
    else if (a === '--start-after') out.startAfter = parseInt(argv[++i], 10);
    else if (a === '--max-batches') out.maxBatches = parseInt(argv[++i], 10);
    else if (a === '--changed-since-hours') out.changedSinceHours = parseFloat(argv[++i]);
    else if (a === '--checkpoint') out.checkpointPath = argv[++i];
    else if (a === '--help') {
      console.log(`Usage: node scripts/sync-local-to-supabase.mjs [options]

Options:
  --batch <n>                 Batch size (default 500)
  --ids <a,b,c>               Sync only these local pizza_places ids
  --start-after <id>          Start after this numeric id (default 0)
  --max-batches <n>           Stop after n batches (default 0 = unlimited)
  --changed-since-hours <n>   Only scan rows enriched in the last n hours
  --only-classified           Only scan rows with style/price classification output
  --insert-missing-reviewed-new
                              With --ids, insert missing Supabase rows only when
                              local place_sources proves reviewed_new_import
  --checkpoint <path>         Resume/save a last_enriched_at + id checkpoint
  --dry-run                   Print what would happen, do not write to Supabase
  --verbose                   Extra logging
`);
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.batch) || out.batch <= 0) throw new Error('Invalid --batch');
  if (out.ids.length && out.checkpointPath) throw new Error('--ids cannot be combined with --checkpoint');
  if (!Number.isFinite(out.startAfter) || out.startAfter < 0) throw new Error('Invalid --start-after');
  if (!Number.isFinite(out.maxBatches) || out.maxBatches < 0) throw new Error('Invalid --max-batches');
  if (out.changedSinceHours !== null && (!Number.isFinite(out.changedSinceHours) || out.changedSinceHours <= 0)) {
    throw new Error('Invalid --changed-since-hours');
  }
  return out;
}

function parseIds(value) {
  const ids = String(value || '')
    .split(',')
    .map(item => Number(item.trim()))
    .filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) throw new Error('Invalid --ids');
  return [...new Set(ids)];
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

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnvLocal();
  assertSupabaseSyncTableBoundary();

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
  let checkpointAfter = readSyncCheckpoint(args.checkpointPath);
  let batchNum = 0;
  let totalUpdates = 0;
  let totalInserts = 0;
  let totalRowsScanned = 0;

  try {
    while (true) {
      if (args.maxBatches && batchNum >= args.maxBatches) break;

      // Pull a chunk of local rows that have anything worth syncing.
      // (We still include rows where only style/price are present so we can NULL-fill.)
      const selector = {
        ...args,
        startAfter: cursor,
        checkpointMode: Boolean(args.checkpointPath),
        checkpointAfter,
      };
      const { rows: localRows } = await client.query(localSyncSelectSql(selector), localSyncSelectParams(selector));
      if (!localRows.length) break;

      batchNum++;
      totalRowsScanned += localRows.length;
      cursor = localRows[localRows.length - 1].id;

      const ids = localRows.map(r => r.id);

      // Fetch current supabase state for protected fields + QA.
      const { data: sbRows, error: sbErr } = await sb
        .from(SUPABASE_SYNC_TARGET_TABLE)
        .select(SUPABASE_SYNC_SELECT_COLS.join(', '))
        .in('id', ids);

      if (sbErr) throw sbErr;

      // Supabase may return ids as strings; normalize keys to string for reliable lookup.
      const sbMap = new Map((sbRows || []).map(r => [String(r.id), r]));
      let reviewedNewImportedIds = new Set();
      if (args.insertMissingReviewedNew) {
        const { rows: reviewedRows } = await client.query(`
          SELECT DISTINCT place_id::int AS place_id
          FROM place_sources
          WHERE entity_type = 'pizza'
            AND match_method = 'reviewed_new_import'
            AND place_id = ANY($1::int[])
          UNION
          SELECT DISTINCT canonical_place_id::int AS place_id
          FROM source_review_queue
          WHERE entity_type = 'pizza'
            AND status IN ('accepted', 'linked')
            AND decision = 'imported_new'
            AND canonical_place_id = ANY($1::int[])
        `, [ids]);
        reviewedNewImportedIds = new Set(reviewedRows.map(row => Number(row.place_id)));
      }

      const updates = [];
      const inserts = [];
      let wouldUpdate = 0;
      let wouldInsert = 0;

      for (const local of localRows) {
        const current = sbMap.get(String(local.id));
        if (!current) {
          if (args.insertMissingReviewedNew && reviewedNewImportedIds.has(Number(local.id))) {
            inserts.push(buildSupabaseInsertPayload(local));
            wouldInsert++;
          } else if (args.verbose) {
            // No row in Supabase with this id. We skip to avoid duplicates.
            console.warn('[skip missing supabase row]', local.id);
          }
          continue;
        }

        const payload = buildSupabasePayload(local, current);
        if (payload) {
          updates.push(payload);
          wouldUpdate++;
        }
      }

      if (args.dryRun) {
        const selectorText = [
          `ids=${selector.ids?.length ? selector.ids.join(',') : 'none'}`,
          `start_after=${selector.startAfter}`,
          `changed_since_hours=${selector.changedSinceHours ?? 'none'}`,
          `only_classified=${selector.onlyClassified}`,
          `checkpoint=${args.checkpointPath || 'none'}`,
          `checkpoint_after=${checkpointAfter ? `${checkpointAfter.lastEnrichedAt}/${checkpointAfter.id}` : 'none'}`,
        ].join(' ');
        console.log(`[dry-run] batch ${batchNum}: local_rows=${localRows.length} supabase_rows=${(sbRows||[]).length} would_update=${wouldUpdate} would_insert=${wouldInsert} cursor=${cursor} ${selectorText}`);
        if (args.verbose && updates.length) {
          console.log('sample update payload:', JSON.stringify(updates[0], null, 2));
        }
        if (args.verbose && inserts.length) {
          console.log('sample insert payload:', JSON.stringify(inserts[0], null, 2));
        }
        const nextCheckpoint = checkpointFromRow(localRows[localRows.length - 1]);
        if (args.checkpointPath && nextCheckpoint) {
          checkpointAfter = {
            lastEnrichedAt: nextCheckpoint.last_enriched_at,
            id: nextCheckpoint.id,
            source: args.checkpointPath,
          };
        }
        if (args.ids.length) break;
        continue;
      }

      if (!updates.length && !inserts.length) {
        console.log(`[ok] batch ${batchNum}: nothing to update or insert (local_rows=${localRows.length}, cursor=${cursor})`);
        if (args.ids.length) break;
        continue;
      }

      let inserted = 0;
      for (const payload of inserts) {
        const { data, error: insertErr } = await sb
          .from(SUPABASE_SYNC_TARGET_TABLE)
          .insert(payload)
          .select('id');

        if (insertErr) throw insertErr;
        if (!data?.length) {
          throw new Error(`Supabase insert returned no row for id=${payload.id}`);
        }
        inserted++;
      }

      let updated = 0;
      for (const payload of updates) {
        const { id, ...fields } = payload;
        const { data, error: upErr } = await sb
          .from(SUPABASE_SYNC_TARGET_TABLE)
          .update(fields)
          .eq('id', id)
          .select('id');

        if (upErr) throw upErr;
        if (!data?.length) {
          throw new Error(`Supabase update matched no rows for id=${id}`);
        }
        updated++;
      }

      totalUpdates += updated;
      totalInserts += inserted;
      const nextCheckpoint = checkpointFromRow(localRows[localRows.length - 1]);
      if (args.checkpointPath && nextCheckpoint) {
        writeSyncCheckpoint(args.checkpointPath, nextCheckpoint);
        checkpointAfter = {
          lastEnrichedAt: nextCheckpoint.last_enriched_at,
          id: nextCheckpoint.id,
          source: args.checkpointPath,
        };
      }
      console.log(`[ok] batch ${batchNum}: updated=${updated} inserted=${inserted} local_rows=${localRows.length} cursor=${cursor}`);
      if (args.ids.length) break;
    }

    console.log(`Done. batches=${batchNum} local_rows_scanned=${totalRowsScanned} supabase_rows_updated=${totalUpdates} supabase_rows_inserted=${totalInserts} last_cursor=${cursor}`);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('sync-local-to-supabase failed:', err);
  process.exit(1);
});
