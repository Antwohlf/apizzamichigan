#!/usr/bin/env node
/**
 * Backfill place_sources from existing OSM-backed place rows.
 *
 * Defaults to a read-only dry-run. Apply schema and data separately:
 *   node scripts/ops/backfill-place-sources.mjs
 *   node scripts/ops/backfill-place-sources.mjs --apply-schema
 *   node scripts/ops/backfill-place-sources.mjs --apply-backfill
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ENTITY_TABLES = {
  pizza: 'pizza_places',
  taco: 'taco_places',
};

const OSM_LICENSE = 'ODbL-1.0';
const OSM_ATTRIBUTION = 'Data copyright OpenStreetMap contributors';

function parseArgs(argv) {
  const out = {
    entity: 'pizza',
    applySchema: false,
    applyBackfill: false,
    sample: 10,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') out.entity = argv[++i];
    else if (arg === '--apply-schema') out.applySchema = true;
    else if (arg === '--apply-backfill') out.applyBackfill = true;
    else if (arg === '--sample') out.sample = parseInt(argv[++i], 10);
    else if (arg === '--help') {
      console.log(`Usage: node scripts/ops/backfill-place-sources.mjs [options]

Options:
  --entity <pizza|taco>  Source table to inspect/backfill (default pizza)
  --sample <n>          Sample rows to print in dry-run/report (default 10)
  --apply-schema        Create place_sources table/indexes
  --apply-backfill      Insert OSM source rows into place_sources
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!ENTITY_TABLES[out.entity]) throw new Error('Invalid --entity');
  if (!Number.isFinite(out.sample) || out.sample < 0) throw new Error('Invalid --sample');
  return out;
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  const txt = readFileSync(path, 'utf8');
  for (const line of txt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
}

function dbConfig() {
  const env = {
    ...loadEnvFile(resolve(process.cwd(), '.env')),
    ...loadEnvFile(resolve(process.cwd(), '.env.local')),
    ...process.env,
  };

  return {
    host: env.LOCAL_DB_HOST || env.PGHOST || 'localhost',
    port: parseInt(env.LOCAL_DB_PORT || env.PGPORT || '5432', 10),
    database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
    user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
    password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
  };
}

function table(headers, rows) {
  if (!rows.length) return '_none_';
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

async function tableExists(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'place_sources'
    ) AS exists
  `);
  return result.rows[0].exists;
}

async function applySchema(client) {
  const schemaPath = resolve(process.cwd(), 'scripts/enrichment/place-sources-schema.sql');
  await client.query(readFileSync(schemaPath, 'utf8'));
}

async function sourceCounts(client, { tableName, entity, hasTable }) {
  const candidate = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM ${tableName}
    WHERE google_place_id LIKE 'osm:%'
  `);

  const existing = hasTable
    ? await client.query(`
        SELECT COUNT(*)::int AS count
        FROM place_sources
        WHERE entity_type = $1
          AND source = 'osm'
      `, [entity])
    : { rows: [{ count: 0 }] };

  const missing = hasTable
    ? await client.query(`
        SELECT COUNT(*)::int AS count
        FROM ${tableName} p
        WHERE p.google_place_id LIKE 'osm:%'
          AND NOT EXISTS (
            SELECT 1
            FROM place_sources ps
            WHERE ps.entity_type = $1
              AND ps.source = 'osm'
              AND ps.source_id = regexp_replace(p.google_place_id, '^osm:', '')
          )
      `, [entity])
    : candidate;

  return {
    candidates: candidate.rows[0].count,
    existing: existing.rows[0].count,
    missing: missing.rows[0].count,
  };
}

async function sampleRows(client, { tableName, entity, hasTable, sample }) {
  if (!sample) return [];
  const result = hasTable
    ? await client.query(`
        SELECT
          p.id,
          p.name,
          p.state,
          p.google_place_id,
          regexp_replace(p.google_place_id, '^osm:', '') AS source_id,
          CASE WHEN ps.id IS NULL THEN 'missing' ELSE 'exists' END AS place_sources_status
        FROM ${tableName} p
        LEFT JOIN place_sources ps
          ON ps.entity_type = $1
         AND ps.source = 'osm'
         AND ps.source_id = regexp_replace(p.google_place_id, '^osm:', '')
        WHERE p.google_place_id LIKE 'osm:%'
        ORDER BY p.id
        LIMIT $2
      `, [entity, sample])
    : await client.query(`
        SELECT
          p.id,
          p.name,
          p.state,
          p.google_place_id,
          regexp_replace(p.google_place_id, '^osm:', '') AS source_id,
          'table_missing' AS place_sources_status
        FROM ${tableName} p
        WHERE p.google_place_id LIKE 'osm:%'
        ORDER BY p.id
        LIMIT $1
      `, [sample]);
  return result.rows;
}

async function applyBackfill(client, { tableName, entity }) {
  const result = await client.query(`
    INSERT INTO place_sources (
      entity_type,
      place_id,
      source,
      source_id,
      source_url,
      license,
      attribution,
      data,
      match_confidence,
      match_method,
      retrieved_at
    )
    SELECT
      $1 AS entity_type,
      p.id AS place_id,
      'osm' AS source,
      regexp_replace(p.google_place_id, '^osm:', '') AS source_id,
      CASE
        WHEN split_part(regexp_replace(p.google_place_id, '^osm:', ''), '/', 1) IN ('node', 'way', 'relation')
         AND split_part(regexp_replace(p.google_place_id, '^osm:', ''), '/', 2) <> ''
        THEN 'https://www.openstreetmap.org/'
          || split_part(regexp_replace(p.google_place_id, '^osm:', ''), '/', 1)
          || '/'
          || split_part(regexp_replace(p.google_place_id, '^osm:', ''), '/', 2)
        ELSE NULL
      END AS source_url,
      $2 AS license,
      $3 AS attribution,
      jsonb_strip_nulls(jsonb_build_object(
        'name', p.name,
        'lat', p.lat,
        'lng', p.lng,
        'address', p.address,
        'state', p.state,
        'website_url', p.website_url,
        'menu_url', p.menu_url,
        'phone', p.phone,
        'email', p.email,
        'instagram_url', p.instagram_url,
        'facebook_url', p.facebook_url,
        'hours', p.hours,
        'brand', p.brand,
        'brand_wikidata', p.brand_wikidata,
        'operator', p.operator,
        'operator_wikidata', p.operator_wikidata,
        'osm_tags', p.osm_tags,
        'osm_last_fetched_at', p.osm_last_fetched_at,
        'osm_fetch_status', p.osm_fetch_status
      )) AS data,
      1.0 AS match_confidence,
      'imported_primary' AS match_method,
      COALESCE(p.osm_last_fetched_at, p.updated_at, p.created_at, NOW()) AS retrieved_at
    FROM ${tableName} p
    WHERE p.google_place_id LIKE 'osm:%'
    ON CONFLICT (entity_type, source, source_id) DO UPDATE SET
      place_id = EXCLUDED.place_id,
      source_url = EXCLUDED.source_url,
      license = EXCLUDED.license,
      attribution = EXCLUDED.attribution,
      data = EXCLUDED.data,
      match_confidence = EXCLUDED.match_confidence,
      match_method = EXCLUDED.match_method,
      retrieved_at = EXCLUDED.retrieved_at,
      updated_at = NOW()
  `, [entity, OSM_LICENSE, OSM_ATTRIBUTION]);
  return result.rowCount;
}

async function main() {
  const args = parseArgs(process.argv);
  const tableName = ENTITY_TABLES[args.entity];
  const client = new pg.Client(dbConfig());
  await client.connect();

  try {
    if (args.applySchema) {
      await applySchema(client);
    }

    const hasTable = await tableExists(client);
    if (args.applyBackfill && !hasTable) {
      throw new Error('place_sources table does not exist. Run with --apply-schema first.');
    }

    const before = await sourceCounts(client, { tableName, entity: args.entity, hasTable });
    let rowsWritten = 0;
    if (args.applyBackfill) {
      rowsWritten = await applyBackfill(client, { tableName, entity: args.entity });
    }

    const finalHasTable = await tableExists(client);
    const after = await sourceCounts(client, { tableName, entity: args.entity, hasTable: finalHasTable });
    const sample = await sampleRows(client, {
      tableName,
      entity: args.entity,
      hasTable: finalHasTable,
      sample: args.sample,
    });

    console.log(`# place_sources OSM backfill ${args.applyBackfill ? 'apply' : 'dry-run'}`);
    console.log('');
    console.log(`Generated: ${new Date().toISOString()}`);
    console.log(`Entity: ${args.entity}`);
    console.log(`Source table: ${tableName}`);
    console.log(`place_sources exists: ${finalHasTable ? 'yes' : 'no'}`);
    console.log(`schema applied: ${args.applySchema ? 'yes' : 'no'}`);
    console.log(`rows written: ${rowsWritten}`);
    console.log('');
    console.log('## Counts');
    console.log(table(['metric', 'before', 'after'], [
      { metric: 'OSM candidate rows', before: before.candidates, after: after.candidates },
      { metric: 'existing place_sources osm rows', before: before.existing, after: after.existing },
      { metric: 'missing place_sources osm rows', before: before.missing, after: after.missing },
    ]));
    console.log('');
    console.log('## Sample');
    console.log(table(['id', 'name', 'state', 'google_place_id', 'source_id', 'place_sources_status'], sample));
    console.log('');
    if (!args.applySchema && !finalHasTable) {
      console.log('Run with `--apply-schema` to create place_sources.');
    } else if (!args.applyBackfill && after.missing > 0) {
      console.log('Run with `--apply-backfill` to insert/update missing OSM source rows.');
    }
  } finally {
    await client.end();
  }
}

main().catch(error => {
  if (error instanceof AggregateError) {
    const messages = error.errors?.map(item => item.message || String(item)).join('; ');
    console.error(`backfill-place-sources failed: ${messages || error.message}`);
  } else {
    console.error(`backfill-place-sources failed: ${error.message || error}`);
  }
  process.exit(1);
});
