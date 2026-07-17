#!/usr/bin/env node

/**
 * Read-only report for source evidence freshness and confidence.
 * This is an operator gate, not a promotion or sync command.
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const policyPath = resolve(process.cwd(), 'config/source-policy.json');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const json = process.argv.includes('--json');

function loadEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => { const [key, ...rest] = line.split('='); return [key.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')]; }));
}

const env = { ...loadEnv(resolve(process.cwd(), '.env')), ...loadEnv(resolve(process.cwd(), '.env.local')), ...process.env };
const client = new pg.Client({
  host: env.LOCAL_DB_HOST || env.PGHOST || 'localhost',
  port: Number(env.LOCAL_DB_PORT || env.PGPORT || 5432),
  database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
  user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
  password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
});

function table(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [
    `| ${keys.join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${keys.map(key => String(row[key] ?? '')).join(' | ')} |`),
  ].join('\n');
}

try {
  await client.connect();
  const exists = await client.query(`SELECT to_regclass('public.place_sources') IS NOT NULL AS exists`);
  if (!exists.rows[0].exists) throw new Error('place_sources does not exist; run the local provenance schema first.');
  const freshnessCase = Object.entries(policy.sources)
    .map(([source, config]) => `WHEN '${source.replaceAll("'", "''")}' THEN ${Number(config.freshness_days)}`)
    .join(' ');
  const result = await client.query(`
    SELECT source,
           COUNT(*)::int AS evidence_rows,
           COUNT(*) FILTER (WHERE retrieved_at >= NOW() - make_interval(days => CASE source ${freshnessCase} ELSE 365 END))::int AS fresh_rows,
           COUNT(*) FILTER (WHERE retrieved_at < NOW() - make_interval(days => CASE source ${freshnessCase} ELSE 365 END))::int AS stale_rows,
           ROUND(AVG(match_confidence)::numeric, 4) AS avg_match_confidence,
           COUNT(*) FILTER (WHERE match_confidence IS NULL)::int AS missing_confidence
    FROM place_sources
    WHERE entity_type = $1
    GROUP BY source
    ORDER BY source
  `, [policy.entity]);
  const sources = Object.entries(policy.sources).map(([source, config]) => {
    const row = result.rows.find(item => item.source === source);
    return {
      source,
      priority: config.priority,
      freshness_days: config.freshness_days,
      minimum_match_confidence: config.minimum_match_confidence,
      evidence_rows: row?.evidence_rows || 0,
      fresh_rows: row?.fresh_rows || 0,
      stale_rows: row?.stale_rows || 0,
      avg_match_confidence: row?.avg_match_confidence ?? null,
      missing_confidence: row?.missing_confidence || 0,
    };
  });
  const report = { policy_version: policy.version, entity: policy.entity, checked_at: new Date().toISOString(), sources };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`# Source Freshness Report (${policy.entity})`);
    console.log(`Policy version: ${policy.version}`);
    console.log(`Checked at: ${report.checked_at}`);
    console.log('');
    console.log(table(sources));
  }
} finally {
  await client.end().catch(() => {});
}
