#!/usr/bin/env node
/**
 * Read-only coverage report for approved source input samples.
 *
 * This is the generic version of the FSQ sample workflow. It normalizes small
 * source exports, filters pizza-ish records, and compares them to the current
 * canonical place table without writing to Postgres or Supabase.
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { extname, resolve } from 'path';

const ENTITY_TABLES = {
  pizza: 'pizza_places',
  taco: 'taco_places',
};

const SOURCE_CONFIGS = {
  fsq_os_places: {
    label: 'Foursquare OS Places',
    license: 'Apache-2.0',
    attribution: 'Copyright Foursquare Labs, Inc.',
    sourceId: ['fsq_place_id', 'fsq_id', 'id'],
    lat: ['latitude', 'lat'],
    lng: ['longitude', 'lng', 'lon'],
    category: ['fsq_category_labels', 'category_labels', 'categories', 'category_name', 'category', 'fsq_category_ids'],
    website: ['website'],
    phone: ['tel', 'phone'],
    closed: ['date_closed'],
    flags: ['unresolved_flags'],
  },
  all_the_places: {
    label: 'All the Places',
    license: 'CC0-1.0',
    attribution: 'All the Places contributors',
    sourceId: ['id', 'ref'],
    lat: ['lat', 'latitude'],
    lng: ['lng', 'lon', 'longitude'],
    category: ['amenity', 'cuisine', 'shop', 'category', 'categories'],
    website: ['website', 'contact:website'],
    phone: ['phone', 'contact:phone'],
    spider: ['@spider', 'spider'],
    sourceUrl: ['@source_uri', 'source_url'],
    closed: ['end_date'],
  },
  overture_places: {
    label: 'Overture Places',
    license: 'see-release-attribution',
    attribution: 'Overture Maps Foundation and source contributors',
    sourceId: ['id', 'gers_id'],
    lat: ['lat', 'latitude'],
    lng: ['lng', 'lon', 'longitude'],
    category: ['basic_category', 'categories', 'taxonomy', 'primary_category'],
    website: ['websites', 'website'],
    phone: ['phones', 'phone'],
    closed: ['operating_status'],
    confidence: ['confidence'],
  },
  wikidata: {
    label: 'Wikidata',
    license: 'CC0-1.0',
    attribution: 'Wikidata contributors',
    sourceId: ['item', 'qid', 'id'],
    lat: ['lat', 'latitude'],
    lng: ['lng', 'lon', 'longitude'],
    category: ['instance_of', 'cuisine', 'category', 'categories'],
    website: ['official_website', 'website'],
    phone: ['phone'],
  },
  government_open_data: {
    label: 'Government/open data',
    license: 'dataset-specific',
    attribution: 'dataset-specific',
    sourceId: ['id', 'license_id', 'permit_id', 'facility_id', 'record_id'],
    lat: ['lat', 'latitude'],
    lng: ['lng', 'lon', 'longitude'],
    category: ['facility_type', 'business_type', 'description', 'category'],
    website: ['website'],
    phone: ['phone'],
    closed: ['status'],
  },
  denue: {
    label: 'DENUE / INEGI',
    license: 'verify-before-import',
    attribution: 'INEGI DENUE',
    sourceId: ['clee', 'id', 'record_id'],
    lat: ['latitud', 'lat', 'latitude'],
    lng: ['longitud', 'lng', 'lon', 'longitude'],
    category: ['nombre_act', 'activity', 'category'],
    website: ['sitio_internet', 'website'],
    phone: ['telefono', 'phone'],
  },
  official_website: {
    label: 'Official restaurant website',
    license: 'first-party-factual-evidence',
    attribution: 'official restaurant website',
    sourceId: ['url', 'website', 'source_url', 'id'],
    lat: ['lat', 'latitude'],
    lng: ['lng', 'lon', 'longitude'],
    category: ['category', 'cuisine', 'menu_tags'],
    website: ['url', 'website', 'source_url'],
    phone: ['phone'],
  },
};

const PIZZA_TERMS = [
  'apizza',
  'flatbread',
  'italian restaurant',
  'pizza',
  'pizzeria',
  'slice',
  'wood fired',
  'wood-fired',
];

function parseArgs(argv) {
  const out = {
    source: null,
    entity: 'pizza',
    input: null,
    maxDistanceM: 100,
    limit: 1000,
    sample: 20,
    includeNonPizza: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') out.source = argv[++i];
    else if (arg === '--entity') out.entity = argv[++i];
    else if (arg === '--input') out.input = argv[++i];
    else if (arg === '--max-distance-m') out.maxDistanceM = parseFloat(argv[++i]);
    else if (arg === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (arg === '--sample') out.sample = parseInt(argv[++i], 10);
    else if (arg === '--include-non-pizza') out.includeNonPizza = true;
    else if (arg === '--list-sources') {
      for (const [key, config] of Object.entries(SOURCE_CONFIGS)) {
        console.log(`${key}\t${config.label}`);
      }
      process.exit(0);
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!SOURCE_CONFIGS[out.source]) throw new Error('Missing or invalid --source. Use --list-sources.');
  if (!ENTITY_TABLES[out.entity]) throw new Error('Invalid --entity');
  if (!out.input) throw new Error('Missing --input');
  if (!Number.isFinite(out.maxDistanceM) || out.maxDistanceM <= 0) throw new Error('Invalid --max-distance-m');
  if (!Number.isFinite(out.limit) || out.limit <= 0) throw new Error('Invalid --limit');
  if (!Number.isFinite(out.sample) || out.sample < 0) throw new Error('Invalid --sample');
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/source-input-sample-report.mjs --source <key> --input <file> [options]

Options:
  --source <key>            Source adapter. Use --list-sources.
  --entity <pizza|taco>     Canonical table to compare against (default pizza)
  --input <file>            Sample file: GeoJSON, JSON, JSONL, NDJSON, or CSV
  --max-distance-m <meters> Nearby match radius (default 100)
  --limit <n>               Maximum source rows to inspect (default 1000)
  --sample <n>              Detail rows to print per bucket (default 20)
  --include-non-pizza       Compare all active records, not just pizza-ish rows
  --list-sources            Print supported source adapters

This report is read-only. It does not import records, write place_sources, or
sync to Supabase.
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

function featureToRow(feature) {
  const props = feature.properties || {};
  const coords = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : [];
  return {
    id: feature.id,
    ...props,
    longitude: props.longitude ?? props.lon ?? props.lng ?? coords?.[0],
    latitude: props.latitude ?? props.lat ?? coords?.[1],
  };
}

function readRecords(inputPath, limit) {
  const absPath = resolve(process.cwd(), inputPath);
  const text = readFileSync(absPath, 'utf8');
  const ext = extname(absPath).toLowerCase();
  let rows;

  if (ext === '.jsonl' || ext === '.ndjson') {
    rows = text.split('\n').map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
  } else if (ext === '.csv') {
    rows = parseCsv(text);
  } else {
    const parsed = JSON.parse(text);
    if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) rows = parsed.features.map(featureToRow);
    else if (parsed?.type === 'Feature') rows = [featureToRow(parsed)];
    else if (Array.isArray(parsed)) rows = parsed;
    else if (Array.isArray(parsed.rows)) rows = parsed.rows;
    else if (Array.isArray(parsed.places)) rows = parsed.places;
    else if (Array.isArray(parsed.features)) rows = parsed.features.map(featureToRow);
    else throw new Error('JSON input must be an array, GeoJSON, or an object with rows/places/features');
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

function valueFor(rowMap, keys = []) {
  for (const key of keys) {
    if (rowMap.has(key.toLowerCase())) return rowMap.get(key.toLowerCase());
  }
  return null;
}

function valuesFor(rowMap, keys = []) {
  return keys
    .filter(key => rowMap.has(key.toLowerCase()))
    .map(key => rowMap.get(key.toLowerCase()));
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
  return String(parsed).split(/[|;,]/).map(item => item.trim()).filter(Boolean);
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
  return normalizeText(value).split(' ').filter(token => token.length > 1 && !ignored.has(token));
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

function firstUrl(value) {
  const values = flattenStrings(value);
  return values[0] || value || null;
}

function normalizeSourceRow(row, sourceKey) {
  const config = SOURCE_CONFIGS[sourceKey];
  const map = caseMap(row);
  const lat = Number(valueFor(map, config.lat));
  const lng = Number(valueFor(map, config.lng));
  const sourceId = valueFor(map, config.sourceId);
  const website = firstUrl(valueFor(map, config.website));
  const phone = firstUrl(valueFor(map, config.phone));
  const categories = [
    ...valuesFor(map, config.category).flatMap(flattenStrings),
    ...flattenStrings(row.categories),
    ...flattenStrings(row.taxonomy),
  ];
  const closedValue = normalizeText(valueFor(map, config.closed));
  const flags = flattenStrings(valueFor(map, config.flags)).map(normalizeText);

  return {
    source: sourceKey,
    source_label: config.label,
    source_id: sourceId ? String(sourceId).replace(/^https?:\/\/www\.wikidata\.org\/entity\//, '') : null,
    name: valueFor(map, ['name', 'label', 'title', 'business_name', 'facility_name', 'dba', 'trade_name']),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    address: valueFor(map, ['address', 'addr:full', 'street_address', 'address1', 'location_address']),
    locality: valueFor(map, ['locality', 'city', 'addr:city', 'municipality']),
    region: valueFor(map, ['region', 'state', 'addr:state', 'province']),
    postcode: valueFor(map, ['postcode', 'postal_code', 'zip', 'addr:postcode']),
    country: valueFor(map, ['country', 'addr:country']),
    website,
    phone,
    categories,
    spider: valueFor(map, config.spider),
    source_url: valueFor(map, config.sourceUrl) || website,
    confidence: Number(valueFor(map, config.confidence)),
    is_closed: Boolean(
      closedValue &&
      ['closed', 'permanently closed', 'permanently_closed', 'inactive', 'out of business'].some(term => closedValue.includes(term))
    ) || flags.some(flag => ['closed', 'delete', 'doesnt exist'].includes(flag)),
  };
}

function isPizzaCandidate(candidate) {
  const haystack = normalizeText([
    candidate.name,
    candidate.categories.join(' '),
    candidate.website,
    candidate.source_url,
  ].join(' '));
  return PIZZA_TERMS.some(term => haystack.includes(term));
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

function bestMatch(nearby) {
  if (!nearby.length) return null;
  return nearby
    .map(row => ({ ...row, match_method: matchMethod(row.distance_m, row.name_score) }))
    .sort((a, b) => {
      const aGood = a.match_method === 'no_match' ? 0 : 1;
      const bGood = b.match_method === 'no_match' ? 0 : 1;
      if (aGood !== bGood) return bGood - aGood;
      if (a.name_score !== b.name_score) return b.name_score - a.name_score;
      return a.distance_m - b.distance_m;
    })[0];
}

function table(headers, rows) {
  if (!rows.length) return '_none_';
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function sourceData(candidate) {
  return {
    source_id: candidate.source_id,
    name: candidate.name,
    category: candidate.categories.slice(0, 3).join('; '),
    address: [candidate.address, candidate.locality, candidate.region].filter(Boolean).join(', '),
    website: candidate.website,
    phone: candidate.phone,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const config = SOURCE_CONFIGS[args.source];
  const tableName = ENTITY_TABLES[args.entity];
  const rows = readRecords(args.input, args.limit);
  const normalized = rows.map(row => normalizeSourceRow(row, args.source));
  const active = normalized.filter(candidate => candidate.name && candidate.lat !== null && candidate.lng !== null && !candidate.is_closed);
  const candidates = args.includeNonPizza ? active : active.filter(isPizzaCandidate);

  const client = new pg.Client(dbConfig());
  await client.connect();

  const matched = [];
  const ambiguous = [];
  const unmatched = [];

  try {
    for (const candidate of candidates) {
      const nearby = await nearbyPlaces(client, tableName, candidate, args.maxDistanceM);
      const best = bestMatch(nearby);
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

  const matchedRows = matched.slice(0, args.sample).map(({ candidate, match }) => ({
    ...sourceData(candidate),
    place_id: match.id,
    place_name: match.name,
    distance_m: match.distance_m.toFixed(1),
    name_score: match.name_score.toFixed(2),
    match_method: match.match_method,
  }));

  const ambiguousRows = ambiguous.slice(0, args.sample).map(({ candidate, match }) => ({
    ...sourceData(candidate),
    nearest_place_id: match.id,
    nearest_name: match.name,
    distance_m: match.distance_m.toFixed(1),
    name_score: match.name_score.toFixed(2),
    review_reason: match.match_method,
  }));

  const unmatchedRows = unmatched.slice(0, args.sample).map(({ candidate, nearest }) => ({
    ...sourceData(candidate),
    nearest_name: nearest?.name || '',
    nearest_distance_m: nearest?.distance_m?.toFixed(1) || '',
  }));

  console.log(`# Source input sample report: ${config.label}`);
  console.log('');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Source key: ${args.source}`);
  console.log(`Entity: ${args.entity}`);
  console.log(`Comparison table: ${tableName}`);
  console.log(`Input: ${args.input}`);
  console.log(`License expectation: ${config.license}`);
  console.log(`Attribution expectation: ${config.attribution}`);
  console.log(`Writes performed: no`);
  console.log('');
  console.log('## Counts');
  console.log(table(['metric', 'count'], [
    { metric: 'input rows inspected', count: rows.length },
    { metric: 'rows with usable name/coordinates and active status', count: active.length },
    { metric: args.includeNonPizza ? 'active candidates compared' : 'pizza-ish active candidates', count: candidates.length },
    { metric: 'matched existing places', count: matched.length },
    { metric: 'ambiguous/review candidates', count: ambiguous.length },
    { metric: 'likely new/unmatched candidates', count: unmatched.length },
  ]));
  console.log('');
  console.log('## Matched Sample');
  console.log(table(['source_id', 'name', 'category', 'address', 'website', 'phone', 'place_id', 'place_name', 'distance_m', 'name_score', 'match_method'], matchedRows));
  console.log('');
  console.log('## Ambiguous Review Sample');
  console.log(table(['source_id', 'name', 'category', 'address', 'website', 'phone', 'nearest_place_id', 'nearest_name', 'distance_m', 'name_score', 'review_reason'], ambiguousRows));
  console.log('');
  console.log('## Likely New Sample');
  console.log(table(['source_id', 'name', 'category', 'address', 'website', 'phone', 'nearest_name', 'nearest_distance_m'], unmatchedRows));
}

main().catch(error => {
  console.error(`source-input-sample-report failed: ${error.message || error}`);
  process.exit(1);
});
