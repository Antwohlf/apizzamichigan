#!/usr/bin/env node
/**
 * Read-only report for local Postgres -> Supabase sync readiness.
 *
 * Shows the exact fields that would be updated by sync-local-to-supabase.mjs
 * for the selected batch without writing to Supabase.
 */

import pg from 'pg';
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';
import {
  FILL_IF_NULL_COLS,
  OVERWRITE_COLS,
  QA_DEFAULT_COLS,
  SUPABASE_SYNC_SELECT_COLS,
  buildSupabasePayload,
  localSyncSelectSql,
  protectedFieldSkips,
} from '../lib/supabase-sync-policy.mjs';

function parseArgs(argv) {
  const out = {
    batch: 100,
    startAfter: 0,
    sample: 10,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--batch') out.batch = parseInt(argv[++i], 10);
    else if (arg === '--start-after') out.startAfter = parseInt(argv[++i], 10);
    else if (arg === '--sample') out.sample = parseInt(argv[++i], 10);
    else if (arg === '--json') out.json = true;
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/supabase-sync-readiness-report.mjs [options]

Options:
  --batch <n>        Number of local rows to inspect (default 100)
  --start-after <id> Start after this numeric id (default 0)
  --sample <n>       Rows per detail table (default 10)
  --json             Emit JSON instead of Markdown
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(out.batch) || out.batch <= 0) throw new Error('Invalid --batch');
  if (!Number.isFinite(out.startAfter) || out.startAfter < 0) throw new Error('Invalid --start-after');
  if (!Number.isFinite(out.sample) || out.sample <= 0) throw new Error('Invalid --sample');
  return out;
}

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return {};

  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function run(cmd, args = [], options = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout || 10000,
      ...options,
    }).trim();
  } catch {
    return '';
  }
}

function repoRoot() {
  return run('git', ['rev-parse', '--show-toplevel']) || process.cwd();
}

function gitReport(root) {
  return {
    branch: run('git', ['branch', '--show-current'], { cwd: root }) || '(unknown)',
    head: run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }) || '(unknown)',
    status: run('git', ['status', '--short', '--branch'], { cwd: root }) || '(status unavailable)',
  };
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

function compactPayload(payload) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) out[key] = value;
    else if (typeof value === 'object') out[key] = '[object]';
    else {
      const text = String(value);
      out[key] = text.length > 120 ? `${text.slice(0, 120)}...` : value;
    }
  }
  return out;
}

function table(headers, rows) {
  if (!rows.length) return '_none_';
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function sample(rows, options) {
  return rows.slice(0, options.sample);
}

async function main() {
  const options = parseArgs(process.argv);
  const root = repoRoot();
  const env = loadEnvLocal();

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }

  const client = new pg.Client({
    host: env.LOCAL_DB_HOST || 'localhost',
    port: parseInt(env.LOCAL_DB_PORT || '5432', 10),
    database: env.LOCAL_DB_NAME || 'pizza_enrichment',
    user: env.LOCAL_DB_USER || process.env.USER,
    password: env.LOCAL_DB_PASSWORD || '',
  });

  await client.connect();

  try {
    const { rows: localRows } = await client.query(localSyncSelectSql(), [options.startAfter, options.batch]);
    const ids = localRows.map(row => row.id);
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    const { data: sbRows, error } = await supabase
      .from('pizza_places')
      .select(SUPABASE_SYNC_SELECT_COLS.join(', '))
      .in('id', ids);

    if (error) throw error;

    const sbMap = new Map((sbRows || []).map(row => [String(row.id), row]));
    const nowIso = new Date().toISOString();
    const updates = [];
    const missingSupabaseRows = [];
    const protectedSkips = [];

    for (const local of localRows) {
      const current = sbMap.get(String(local.id));
      if (!current) {
        missingSupabaseRows.push(local);
        continue;
      }

      for (const skip of protectedFieldSkips(local, current)) {
        protectedSkips.push({
          id: local.id,
          name: local.name,
          state: local.state,
          google_place_id: local.google_place_id,
          ...skip,
        });
      }

      const payload = buildSupabasePayload(local, current, { nowIso });
      if (payload) updates.push({ local, current, payload });
    }

    const changedFields = updates.flatMap(item => Object.keys(item.payload).filter(key => key !== 'id'));
    const protectedFills = changedFields.filter(col => FILL_IF_NULL_COLS.includes(col));
    const overwriteWrites = changedFields.filter(col => OVERWRITE_COLS.includes(col));
    const qaDefaults = changedFields.filter(col => QA_DEFAULT_COLS.includes(col));
    const protectedConflicts = protectedSkips.filter(skip => skip.differs);

    const state = missingSupabaseRows.length ? 'WARN' : 'OK';
    const payloadSamples = sample(updates, options).map(item => ({
      id: item.local.id,
      name: item.local.name,
      state: item.local.state,
      google_place_id: item.local.google_place_id,
      fields: Object.keys(item.payload).filter(key => key !== 'id').join(', '),
      payload: JSON.stringify(compactPayload(item.payload)),
    }));

    const result = {
      generatedAt: new Date().toISOString(),
      state,
      repo: { root, ...gitReport(root) },
      options,
      totals: {
        localRows: localRows.length,
        supabaseRows: sbRows?.length || 0,
        wouldUpdate: updates.length,
        missingSupabaseRows: missingSupabaseRows.length,
        protectedFieldFills: protectedFills.length,
        protectedFieldSkips: protectedSkips.length,
        protectedFieldConflicts: protectedConflicts.length,
        overwriteWrites: overwriteWrites.length,
        qaDefaults: qaDefaults.length,
      },
      fieldCounts: countBy(changedFields, value => value),
      protectedFillCounts: countBy(protectedFills, value => value),
      protectedSkipCounts: countBy(protectedSkips, skip => `${skip.column}${skip.differs ? ' differs' : ' same'}`),
      payloadSamples,
      protectedConflictSamples: sample(protectedConflicts, options),
      missingSupabaseSamples: sample(missingSupabaseRows, options).map(row => ({
        id: row.id,
        name: row.name,
        state: row.state,
        google_place_id: row.google_place_id,
      })),
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`# Supabase Sync Readiness: ${result.state}`);
    console.log('');
    console.log(`Generated: ${result.generatedAt}`);
    console.log(`Repo: \`${root}\``);
    console.log(`Batch: start_after=${options.startAfter}, batch=${options.batch}`);
    console.log('');
    console.log('## Summary');
    console.log(`- branch/head: \`${result.repo.branch}\` / \`${result.repo.head}\``);
    console.log(`- local rows inspected: ${result.totals.localRows}`);
    console.log(`- matching Supabase rows: ${result.totals.supabaseRows}`);
    console.log(`- rows that would update: ${result.totals.wouldUpdate}`);
    console.log(`- missing Supabase rows: ${result.totals.missingSupabaseRows}`);
    console.log(`- protected field fills: ${result.totals.protectedFieldFills}`);
    console.log(`- protected field skips: ${result.totals.protectedFieldSkips}`);
    console.log(`- protected field conflicts: ${result.totals.protectedFieldConflicts}`);
    console.log(`- overwrite-field writes: ${result.totals.overwriteWrites}`);
    console.log(`- QA default writes: ${result.totals.qaDefaults}`);
    console.log('');

    console.log('## Field Counts');
    console.log(table(['value', 'count'], result.fieldCounts));
    console.log('');

    console.log('## Protected Field Fills');
    console.log(table(['value', 'count'], result.protectedFillCounts));
    console.log('');

    console.log('## Protected Field Skips');
    console.log(table(['value', 'count'], result.protectedSkipCounts));
    console.log('');

    console.log('## Protected Conflict Samples');
    console.log(table(['id', 'name', 'state', 'google_place_id', 'column', 'local', 'supabase', 'differs'], result.protectedConflictSamples));
    console.log('');

    console.log('## Missing Supabase Row Samples');
    console.log(table(['id', 'name', 'state', 'google_place_id'], result.missingSupabaseSamples));
    console.log('');

    console.log('## Payload Samples');
    console.log(table(['id', 'name', 'state', 'google_place_id', 'fields', 'payload'], result.payloadSamples));
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(error => {
  console.error('supabase-sync-readiness-report failed:', error);
  process.exit(1);
});
