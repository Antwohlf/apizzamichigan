#!/usr/bin/env node
/**
 * Read-only coverage report for a small Foursquare OS Places sample.
 *
 * This does not write to Postgres or place_sources. It compares exported FSQ
 * sample rows against the current canonical place table by distance and name.
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { extname, resolve } from 'path';

const ENTITY_TABLES = {
  pizza: 'pizza_places',
  taco: 'taco_places',
};

const PIZZA_TERMS = [
  'pizza',
  'pizzeria',
  'slice',
  'apizza',
  'wood fired',
  'wood-fired',
];

function parseArgs(argv) {
  const out = {
    entity: 'pizza',
    input: null,
    maxDistanceM: 100,
    limit: 1000,
    sample: 20,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') out.entity = argv[++i];
    else if (arg === '--input') out.input = argv[++i];
    else if (arg === '--max-distance-m') out.maxDistanceM = parseFloat(argv[++i]);
    else if (arg === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (arg === '--sample') out.sample = parseInt(argv[++i], 10);
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!ENTITY_TABLES[out.entity]) throw new Error('Invalid --entity');
  if (!out.input) throw new Error('Missing --input');
  if (!Number.isFinite(out.maxDistanceM) || out.maxDistanceM <= 0) {
    throw new Error('Invalid --max-distance-m');
  }
  if (!Number.isFinite(out.limit) || out.limit <= 0) throw new Error('Invalid --limit');
  if (!Number.isFinite(out.sample) || out.sample < 0) throw new Error('Invalid --sample');
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/fsq-os-places-sample-report.mjs --input <file> [options]

Options:
  --entity <pizza|taco>      Canonical table to compare against (default pizza)
  --input <file>             FSQ sample file: .json, .jsonl, .ndjson, or .csv
  --max-distance-m <meters>  Nearby match radius (default 100)
  --limit <n>                Maximum FSQ rows to inspect from the input (default 1000)
  --sample <n>               Matched/unmatched examples to print (default 20)

This report is read-only. It expects a small exported FSQ OS Places sample, not
the full Parquet/Iceberg release.
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

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      current.push(field);
      field = '';
    } else if (char === '\n') {
      current.push(field);
      rows.push(current);
      current = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }

  const [headers, ...data] = rows.filter(row => row.some(value => value.trim() !== ''));
  if (!headers) return [];
  return data.map(row => Object.fromEntries(headers.map((header, idx) => [header, row[idx] ?? ''])));
}

function readRecords(inputPath, limit) {
  const absPath = resolve(process.cwd(), inputPath);
  const text = readFileSync(absPath, 'utf8');
  const ext = extname(absPath).toLowerCase();
  let rows;

  if (ext === '.jsonl' || ext === '.ndjson') {
    rows = text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } else if (ext === '.csv') {
    rows = parseCsv(text);
  } else {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed;
    else if (Array.isArray(parsed.rows)) rows = parsed.rows;
    else if (Array.isArray(parsed.places)) rows = parsed.places;
    else throw new Error('JSON input must be an array, or an object with rows/places');
  }

  return rows.slice(0, limit);
}

function caseMap(row) {
  const map = new Map();
  for (const [key, value] of Object.entries(row)) {
    map.set(key.toLowerCase(), value);
  }
  return map;
}

function valueFor(rowMap, keys) {
  for (const key of keys) {
    if (rowMap.has(key.toLowerCase())) return rowMap.get(key.toLowerCase());
  }
  return null;
}

function parseMaybeJson(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function flattenStrings(value) {
  const parsed = parseMaybeJson(value);
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed.flatMap(flattenStrings);
  if (typeof parsed === 'object') return Object.values(parsed).flatMap(flattenStrings);
  return String(parsed)
    .split(/[|;,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function nameTokens(value) {
  const ignored = new Set(['the', 'and', 'pizza', 'pizzeria', 'restaurant', 'bar', 'grill']);
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length > 1 && !ignored.has(token));
}

function nameScore(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  const aTokens = nameTokens(a);
  const bTokens = nameTokens(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const bSet = new Set(bTokens);
  const shared = aTokens.filter(token => bSet.has(token)).length;
  return shared / Math.max(aTokens.length, bTokens.length);
}

function normalizeFoursquareRow(row) {
  const map = caseMap(row);
  const categories = [
    ...flattenStrings(valueFor(map, ['fsq_category_labels', 'category_labels', 'categories'])),
    ...flattenStrings(valueFor(map, ['category_name', 'category', 'fsq_category_ids'])),
  ];
  const lat = Number(valueFor(map, ['latitude', 'lat']));
  const lng = Number(valueFor(map, ['longitude', 'lng', 'lon']));

  return {
    source_id: valueFor(map, ['fsq_place_id', 'fsq_id', 'id']),
    name: valueFor(map, ['name']),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    address: valueFor(map, ['address']),
    locality: valueFor(map, ['locality', 'city']),
    region: valueFor(map, ['region', 'state']),
    postcode: valueFor(map, ['postcode', 'postal_code', 'zip']),
    country: valueFor(map, ['country']),
    website: valueFor(map, ['website']),
    tel: valueFor(map, ['tel', 'phone']),
    categories,
    date_closed: valueFor(map, ['date_closed']),
    unresolved_flags: flattenStrings(valueFor(map, ['unresolved_flags'])),
  };
}

function isPizzaCandidate(candidate) {
  const haystack = normalizeText([
    candidate.name,
    candidate.categories.join(' '),
  ].join(' '));
  return PIZZA_TERMS.some(term => haystack.includes(term));
}

function isActiveCandidate(candidate) {
  const flags = candidate.unresolved_flags.map(normalizeText);
  return !candidate.date_closed && !flags.some(flag => ['closed', 'delete', 'doesnt exist'].includes(flag));
}

function matchMethod(distanceM, score) {
  if (distanceM <= 25 && score >= 0.99) return 'exact_name_nearby';
  if (distanceM <= 50 && score >= 0.6) return 'strong_spatial_name';
  if (distanceM <= 100 && score >= 0.35) return 'weak_spatial_name';
  if (distanceM <= 25) return 'spatial_only_review';
  return 'no_match';
}

async function nearbyPlaces(client, tableName, candidate, maxDistanceM) {
  const latSpan = maxDistanceM / 111320;
  const lngSpan = maxDistanceM / (111320 * Math.max(Math.cos(candidate.lat * Math.PI / 180), 0.01));
  const result = await client.query(`
    SELECT
      id,
      name,
      address,
      state,
      google_place_id,
      lat::double precision AS lat,
      lng::double precision AS lng,
      6371000 * acos(
        least(1, greatest(-1,
          cos(radians($1)) * cos(radians(lat::double precision)) *
          cos(radians(lng::double precision) - radians($2)) +
          sin(radians($1)) * sin(radians(lat::double precision))
        ))
      ) AS distance_m
    FROM ${tableName}
    WHERE lat IS NOT NULL
      AND lng IS NOT NULL
      AND lat::double precision BETWEEN $1 - $3 AND $1 + $3
      AND lng::double precision BETWEEN $2 - $4 AND $2 + $4
    ORDER BY distance_m ASC
    LIMIT 10
  `, [candidate.lat, candidate.lng, latSpan, lngSpan]);

  return result.rows.map(row => ({
    ...row,
    distance_m: Number(row.distance_m),
    name_score: nameScore(candidate.name, row.name),
  }));
}

function bestMatch(candidate, nearby) {
  if (!nearby.length) return null;
  const ranked = nearby
    .map(row => ({
      ...row,
      match_method: matchMethod(row.distance_m, row.name_score),
    }))
    .sort((a, b) => {
      const aGood = a.match_method === 'no_match' ? 0 : 1;
      const bGood = b.match_method === 'no_match' ? 0 : 1;
      if (aGood !== bGood) return bGood - aGood;
      if (a.name_score !== b.name_score) return b.name_score - a.name_score;
      return a.distance_m - b.distance_m;
    });
  return ranked[0];
}

function table(headers, rows) {
  if (!rows.length) return '_none_';
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function categoryLabel(candidate) {
  return candidate.categories.slice(0, 2).join('; ');
}

async function main() {
  const args = parseArgs(process.argv);
  const tableName = ENTITY_TABLES[args.entity];
  const rows = readRecords(args.input, args.limit);
  const candidates = rows.map(normalizeFoursquareRow);
  const active = candidates.filter(candidate => candidate.name && candidate.lat !== null && candidate.lng !== null && isActiveCandidate(candidate));
  const pizzaCandidates = active.filter(isPizzaCandidate);

  const client = new pg.Client(dbConfig());
  await client.connect();

  const matched = [];
  const ambiguous = [];
  const unmatched = [];

  try {
    for (const candidate of pizzaCandidates) {
      const nearby = await nearbyPlaces(client, tableName, candidate, args.maxDistanceM);
      const best = bestMatch(candidate, nearby);
      if (!best || best.match_method === 'no_match') {
        unmatched.push({ candidate, nearest: nearby[0] || null });
      } else if (best.match_method === 'spatial_only_review' || best.match_method === 'weak_spatial_name') {
        ambiguous.push({ candidate, match: best });
      } else {
        matched.push({ candidate, match: best });
      }
    }
  } finally {
    await client.end();
  }

  const sampleMatched = matched.slice(0, args.sample).map(({ candidate, match }) => ({
    fsq_place_id: candidate.source_id,
    fsq_name: candidate.name,
    fsq_region: candidate.region,
    category: categoryLabel(candidate),
    place_id: match.id,
    place_name: match.name,
    distance_m: match.distance_m.toFixed(1),
    name_score: match.name_score.toFixed(2),
    match_method: match.match_method,
  }));

  const sampleAmbiguous = ambiguous.slice(0, args.sample).map(({ candidate, match }) => ({
    fsq_place_id: candidate.source_id,
    fsq_name: candidate.name,
    category: categoryLabel(candidate),
    nearest_place_id: match.id,
    nearest_name: match.name,
    distance_m: match.distance_m.toFixed(1),
    name_score: match.name_score.toFixed(2),
    review_reason: match.match_method,
  }));

  const sampleUnmatched = unmatched.slice(0, args.sample).map(({ candidate, nearest }) => ({
    fsq_place_id: candidate.source_id,
    fsq_name: candidate.name,
    fsq_region: candidate.region,
    category: categoryLabel(candidate),
    address: [candidate.address, candidate.locality, candidate.region].filter(Boolean).join(', '),
    nearest_name: nearest?.name || '',
    nearest_distance_m: nearest?.distance_m?.toFixed(1) || '',
  }));

  console.log('# FSQ OS Places sample coverage report');
  console.log('');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Entity: ${args.entity}`);
  console.log(`Comparison table: ${tableName}`);
  console.log(`Input: ${args.input}`);
  console.log(`Max distance: ${args.maxDistanceM}m`);
  console.log('Writes performed: no');
  console.log('');
  console.log('## Counts');
  console.log(table(['metric', 'count'], [
    { metric: 'input rows inspected', count: rows.length },
    { metric: 'rows with usable name/coordinates and active status', count: active.length },
    { metric: 'pizza-ish active candidates', count: pizzaCandidates.length },
    { metric: 'matched existing places', count: matched.length },
    { metric: 'ambiguous/review candidates', count: ambiguous.length },
    { metric: 'likely new/unmatched candidates', count: unmatched.length },
  ]));
  console.log('');
  console.log('## Matched Sample');
  console.log(table([
    'fsq_place_id',
    'fsq_name',
    'fsq_region',
    'category',
    'place_id',
    'place_name',
    'distance_m',
    'name_score',
    'match_method',
  ], sampleMatched));
  console.log('');
  console.log('## Ambiguous Review Sample');
  console.log(table([
    'fsq_place_id',
    'fsq_name',
    'category',
    'nearest_place_id',
    'nearest_name',
    'distance_m',
    'name_score',
    'review_reason',
  ], sampleAmbiguous));
  console.log('');
  console.log('## Likely New Sample');
  console.log(table([
    'fsq_place_id',
    'fsq_name',
    'fsq_region',
    'category',
    'address',
    'nearest_name',
    'nearest_distance_m',
  ], sampleUnmatched));
}

main().catch(error => {
  console.error(`fsq-os-places-sample-report failed: ${error.message || error}`);
  process.exit(1);
});
