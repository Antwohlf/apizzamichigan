#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import pg from 'pg';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const limit = Math.min(Math.max(Number(process.argv[2] || 25), 1), 25);
const pgClient = new pg.Client({ host: 'localhost', database: 'pizza_enrichment', user: process.env.PGUSER || process.env.USER });
await pgClient.connect();
const { rows } = await pgClient.query(`
  SELECT DISTINCT p.id
  FROM pizza_places p
  LEFT JOIN place_sources ps
    ON ps.entity_type='pizza'
   AND ps.place_id=p.id
   AND ps.match_method='reviewed_new_import'
  LEFT JOIN source_review_queue srq
    ON srq.entity_type='pizza'
   AND srq.canonical_place_id=p.id
   AND srq.status IN ('accepted', 'linked')
   AND srq.decision='imported_new'
  WHERE (ps.place_id IS NOT NULL OR srq.canonical_place_id IS NOT NULL)
    AND p.last_enriched_at IS NOT NULL
    AND (p.style IS NOT NULL OR p.price_range IS NOT NULL OR p.style_confidence IS NOT NULL)
  ORDER BY p.id
  LIMIT 250
`);
await pgClient.end();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
);
const ids = rows.map(row => row.id);
if (!ids.length) { console.log('reviewed-new Supabase reconciliation: no classified local rows'); process.exit(0); }
const { data, error } = await supabase.from('pizza_places').select('id').in('id', ids);
if (error) throw error;
const present = new Set((data || []).map(row => Number(row.id)));
const missing = ids.filter(id => !present.has(Number(id))).slice(0, limit);
if (!missing.length) { console.log(`reviewed-new Supabase reconciliation: no missing rows among ${ids.length} candidates`); process.exit(0); }

console.log(`reviewed-new Supabase reconciliation: inserting ${missing.length} rows`);
execFileSync(process.execPath, [
  'scripts/ops/guarded-supabase-sync.mjs',
  '--ids', missing.join(','),
  '--batch', String(missing.length),
  '--max-batches', '1',
  '--insert-missing-reviewed-new',
  '--apply',
], { stdio: 'inherit', timeout: 1200000 });
