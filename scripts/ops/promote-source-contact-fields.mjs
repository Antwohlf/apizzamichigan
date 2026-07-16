#!/usr/bin/env node
/**
 * Promote safe contact fields from local source evidence into canonical places.
 *
 * Default mode is dry-run. With --apply, this fills only empty canonical
 * website_url and/or phone fields from accepted place_sources rows.
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ENTITY_TABLES = {
  pizza: 'pizza_places',
  taco: 'taco_places',
};

const FIELD_CONFIGS = {
  website_url: {
    label: 'website_url',
    sourceKeys: ['website', 'website_url', 'contact:website', 'url'],
    valid: isValidWebsite,
    normalize: normalizeWebsite,
  },
  phone: {
    label: 'phone',
    sourceKeys: ['phone', 'contact:phone', 'tel'],
    valid: isValidPhone,
    normalize: normalizePhone,
  },
};

function parseArgs(argv) {
  const args = {
    entity: 'pizza',
    sources: ['all_the_places', 'osm'],
    fields: ['website_url', 'phone'],
    limit: 50,
    apply: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--sources') args.sources = argv[++i].split(',').map(value => value.trim()).filter(Boolean);
    else if (arg === '--fields') args.fields = argv[++i].split(',').map(value => value.trim()).filter(Boolean);
    else if (arg === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!ENTITY_TABLES[args.entity]) throw new Error('Invalid --entity. Use pizza or taco.');
  if (!args.sources.length) throw new Error('At least one --sources value is required.');
  if (!args.fields.length || args.fields.some(field => !FIELD_CONFIGS[field])) {
    throw new Error(`Invalid --fields. Use any of: ${Object.keys(FIELD_CONFIGS).join(',')}`);
  }
  if (!Number.isFinite(args.limit) || args.limit < 0) throw new Error('Invalid --limit');

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/promote-source-contact-fields.mjs [options]

Options:
  --entity <pizza|taco>          Canonical table to update (default pizza)
  --sources <a,b>                Source priority order
                                 (default all_the_places,osm)
  --fields <a,b>                 Fields to promote: website_url,phone
                                 (default website_url,phone)
  --limit <n>                    Candidate sample size to print (default 50)
  --apply                        Fill empty canonical fields

Default mode is dry-run. This updates only the local canonical table and only
fills null/blank fields. It never changes identity fields, style, price,
ratings, notes, photos, place_sources, source_review_queue, or Supabase.
`);
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

function normalizeWebsite(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withProtocol);
    url.hash = '';
    return url.toString();
  } catch (error) {
    return null;
  }
}

function isValidWebsite(value) {
  const normalized = normalizeWebsite(value);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname?.includes('.'));
  } catch (error) {
    return false;
  }
}

function normalizePhone(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.replace(/\s+/g, ' ');
}

function isValidPhone(value) {
  const text = normalizePhone(value);
  if (!text) return false;
  const digits = text.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 16;
}

function sourceValue(data, config) {
  for (const key of config.sourceKeys) {
    const value = data?.[key];
    if (value != null && String(value).trim()) return value;
  }
  return null;
}

async function ensurePlaceSources(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'place_sources'
    ) AS exists
  `);
  if (!result.rows[0]?.exists) {
    throw new Error('place_sources table does not exist.');
  }
}

async function loadEvidenceRows(client, args) {
  const tableName = ENTITY_TABLES[args.entity];
  const result = await client.query(`
    SELECT
      p.id AS place_id,
      p.name AS place_name,
      p.google_place_id,
      p.website_url AS current_website_url,
      p.phone AS current_phone,
      ps.source,
      ps.source_id,
      ps.source_url,
      ps.match_method,
      ps.match_confidence,
      ps.data
    FROM place_sources ps
    JOIN ${tableName} p
      ON p.id = ps.place_id
    WHERE ps.entity_type = $1
      AND ps.source = ANY($2::text[])
    ORDER BY p.id, array_position($2::text[], ps.source), ps.match_confidence DESC NULLS LAST
  `, [args.entity, args.sources]);

  return result.rows;
}

function promotionCandidates(rows, args) {
  const byFieldPlace = new Map();

  for (const row of rows) {
    for (const field of args.fields) {
      const config = FIELD_CONFIGS[field];
      const currentValue = field === 'website_url' ? row.current_website_url : row.current_phone;
      if (String(currentValue || '').trim()) continue;

      const rawValue = sourceValue(row.data, config);
      if (!config.valid(rawValue)) continue;

      const key = `${field}:${row.place_id}`;
      if (byFieldPlace.has(key)) continue;
      byFieldPlace.set(key, {
        field,
        place_id: row.place_id,
        place_name: row.place_name,
        google_place_id: row.google_place_id,
        promoted_value: config.normalize(rawValue),
        source: row.source,
        source_id: row.source_id,
        source_url: row.source_url,
        match_method: row.match_method,
        match_confidence: row.match_confidence,
      });
    }
  }

  return [...byFieldPlace.values()];
}

async function applyCandidates(client, args, candidates) {
  const tableName = ENTITY_TABLES[args.entity];
  const candidatesByPlace = candidates.reduce((acc, candidate) => {
    if (!acc.has(candidate.place_id)) acc.set(candidate.place_id, {});
    acc.get(candidate.place_id)[candidate.field] = candidate.promoted_value;
    return acc;
  }, new Map());

  let placesUpdated = 0;
  let fieldsUpdated = 0;

  for (const [placeId, fields] of candidatesByPlace.entries()) {
    const sets = [];
    const values = [placeId];

    if (fields.website_url) {
      values.push(fields.website_url);
      sets.push(`website_url = COALESCE(NULLIF(website_url, ''), $${values.length})`);
    }
    if (fields.phone) {
      values.push(fields.phone);
      sets.push(`phone = COALESCE(NULLIF(phone, ''), $${values.length})`);
    }
    if (!sets.length) continue;

    const result = await client.query(`
      UPDATE ${tableName}
      SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1
        AND (${Object.keys(fields).map(field => `${field} IS NULL OR ${field} = ''`).join(' OR ')})
    `, values);

    if (result.rowCount > 0) {
      placesUpdated += result.rowCount;
      fieldsUpdated += Object.keys(fields).length;
    }
  }

  return { placesUpdated, fieldsUpdated };
}

async function main() {
  const args = parseArgs(process.argv);
  const client = new pg.Client(dbConfig());
  await client.connect();

  try {
    await ensurePlaceSources(client);
    const rows = await loadEvidenceRows(client, args);
    const candidates = promotionCandidates(rows, args);
    const byField = candidates.reduce((acc, candidate) => {
      acc[candidate.field] = (acc[candidate.field] || 0) + 1;
      return acc;
    }, {});
    const bySource = candidates.reduce((acc, candidate) => {
      const key = `${candidate.source}|${candidate.field}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const result = args.apply ? await applyCandidates(client, args, candidates) : { placesUpdated: 0, fieldsUpdated: 0 };

    console.log(`# Source Contact Promotion ${args.apply ? 'Apply' : 'Dry Run'}`);
    console.log('');
    console.log(`Entity: ${args.entity}`);
    console.log(`Sources: ${args.sources.join(', ')}`);
    console.log(`Fields: ${args.fields.join(', ')}`);
    console.log(`Evidence rows read: ${rows.length}`);
    console.log(`Promotion candidates: ${candidates.length}`);
    console.log(`Places updated: ${result.placesUpdated}`);
    console.log(`Fields updated: ${result.fieldsUpdated}`);
    console.log('');
    console.log('## Candidates by Field');
    console.log(table(['field', 'count'], Object.entries(byField).map(([field, count]) => ({ field, count }))));
    console.log('');
    console.log('## Candidates by Source');
    console.log(table(
      ['source', 'field', 'count'],
      Object.entries(bySource).map(([key, count]) => {
        const [source, field] = key.split('|');
        return { source, field, count };
      })
    ));
    console.log('');
    console.log('## Sample');
    console.log(table(
      ['field', 'place_id', 'place_name', 'promoted_value', 'source', 'match_method'],
      candidates.slice(0, args.limit)
    ));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`promote-source-contact-fields failed: ${error.message || error}`);
  process.exit(1);
});
