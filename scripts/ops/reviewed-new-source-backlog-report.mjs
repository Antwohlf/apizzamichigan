#!/usr/bin/env node
/**
 * Read-only backlog report for likely-new source review rows.
 *
 * This answers the operator question: which reviewed-new source buckets have
 * strong enough evidence to accept/import next, and which ones are mostly
 * blocked by nearby canonical rows or missing required data?
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ENTITY_TABLES = {
  pizza: 'pizza_places',
  taco: 'taco_places',
};

const SIGNAL_COUNT_SQL = `(
  CASE WHEN NULLIF(source_data->>'address', '') IS NOT NULL OR NULLIF(source_data->>'addr:full', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN NULLIF(source_data->>'website', '') IS NOT NULL OR NULLIF(source_data->>'contact:website', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN NULLIF(source_data->>'phone', '') IS NOT NULL OR NULLIF(source_data->>'contact:phone', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN (
    (NULLIF(source_data->>'lat', '') IS NOT NULL OR NULLIF(source_data->>'latitude', '') IS NOT NULL) AND
    (NULLIF(source_data->>'lng', '') IS NOT NULL OR NULLIF(source_data->>'lon', '') IS NOT NULL OR NULLIF(source_data->>'longitude', '') IS NOT NULL)
  ) THEN 1 ELSE 0 END
)`;

function parseArgs(argv) {
  const args = {
    entity: 'pizza',
    source: 'all_the_places',
    minSignals: 3,
    maxRows: 20,
    dbStateFixture: '',
    nearbyRadiusM: 150,
    prefetchTileDegrees: 1,
    prefetchBatchSize: 100,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entity') args.entity = argv[++i];
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--min-signals') args.minSignals = Number.parseInt(argv[++i], 10);
    else if (arg === '--max-rows') args.maxRows = Number.parseInt(argv[++i], 10);
    else if (arg === '--db-state-fixture') args.dbStateFixture = argv[++i];
    else if (arg === '--nearby-radius-m') args.nearbyRadiusM = Number.parseFloat(argv[++i]);
    else if (arg === '--prefetch-tile-degrees') args.prefetchTileDegrees = Number.parseFloat(argv[++i]);
    else if (arg === '--prefetch-batch-size') args.prefetchBatchSize = Number.parseInt(argv[++i], 10);
    else if (arg === '--json') args.json = true;
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!ENTITY_TABLES[args.entity]) throw new Error('Invalid --entity. Use pizza or taco.');
  if (!Number.isFinite(args.minSignals) || args.minSignals < 0 || args.minSignals > 4) {
    throw new Error('Invalid --min-signals. Use 0-4.');
  }
  if (!Number.isFinite(args.maxRows) || args.maxRows <= 0 || args.maxRows > 100) {
    throw new Error('Invalid --max-rows. Use 1-100.');
  }
  if (!Number.isFinite(args.nearbyRadiusM) || args.nearbyRadiusM <= 0) throw new Error('Invalid --nearby-radius-m');
  if (!Number.isFinite(args.prefetchTileDegrees) || args.prefetchTileDegrees <= 0) throw new Error('Invalid --prefetch-tile-degrees');
  if (!Number.isFinite(args.prefetchBatchSize) || args.prefetchBatchSize <= 0) throw new Error('Invalid --prefetch-batch-size');
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/reviewed-new-source-backlog-report.mjs [options]

Options:
  --entity <pizza|taco>       Entity type (default pizza)
  --source <key>              Source key (default all_the_places)
  --min-signals <n>           Strong-candidate evidence threshold 0-4 (default 3)
  --max-rows <n>              Max report rows (default 20, max 100)
  --nearby-radius-m <n>       Live duplicate-review radius (default 150)
  --prefetch-tile-degrees <n> Tile size for live canonical prefetch (default 1)
  --prefetch-batch-size <n>   Number of tiles per prefetch query (default 100)
  --db-state-fixture <file>   Use JSON fixture rows instead of Postgres
  --json                      Emit JSON instead of Markdown

Read-only. Does not accept candidates, import canonical places, enqueue jobs, or
sync Supabase. Database mode recomputes pending-row nearby-canonical readiness
with the same live canonical-place guard used by the acceptance command.
`);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
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
    port: Number.parseInt(env.LOCAL_DB_PORT || env.PGPORT || '5432', 10),
    database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
    user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
    password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
  };
}

function normalizeReportFile(value) {
  return value || '(missing)';
}

function readinessFor(row, nearbyRadiusM = 150) {
  const data = row.source_data || {};
  const hasName = Boolean((row.source_name || data.name || '').trim());
  const hasSourceId = Boolean(String(row.source_id || '').trim());
  const hasLat = data.lat != null && data.lat !== '' || data.latitude != null && data.latitude !== '';
  const hasLng = data.lng != null && data.lng !== '' || data.lon != null && data.lon !== '' || data.longitude != null && data.longitude !== '';
  if (row.review_kind !== 'likely_new') return 'link_review';
  if (!hasName || !hasSourceId || !hasLat || !hasLng) return 'missing_required_data';
  if (row.nearest_distance_m != null && Number(row.nearest_distance_m) <= nearbyRadiusM) return 'nearby_canonical_review';
  return 'candidate_ready';
}

function signalCountFor(row) {
  if (row.source_signal_count !== undefined && row.source_signal_count !== null) {
    return Number(row.source_signal_count);
  }
  const data = row.source_data || {};
  const hasAddress = Boolean(data.address || data['addr:full']);
  const hasWebsite = Boolean(data.website || data['contact:website']);
  const hasPhone = Boolean(data.phone || data['contact:phone']);
  const hasLat = data.lat != null && data.lat !== '' || data.latitude != null && data.latitude !== '';
  const hasLng = data.lng != null && data.lng !== '' || data.lon != null && data.lon !== '' || data.longitude != null && data.longitude !== '';
  return Number(hasAddress) + Number(hasWebsite) + Number(hasPhone) + Number(hasLat && hasLng);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceCoordinate(row, keys) {
  for (const key of keys) {
    const value = toNumber(row.source_data?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function candidatePayload(row) {
  return {
    lat: sourceCoordinate(row, ['lat', 'latitude']),
    lng: sourceCoordinate(row, ['lng', 'lon', 'longitude']),
  };
}

function buildPrefetchTiles(payloads, { radiusM, tileDegrees }) {
  const tiles = new Map();
  for (const payload of payloads) {
    if (payload.lat === null || payload.lng === null) continue;
    const latCell = Math.floor(payload.lat / tileDegrees);
    const lngCell = Math.floor(payload.lng / tileDegrees);
    const key = `${latCell}:${lngCell}`;
    const existing = tiles.get(key);
    if (existing) {
      existing.minLat = Math.min(existing.minLat, payload.lat);
      existing.maxLat = Math.max(existing.maxLat, payload.lat);
      existing.minLng = Math.min(existing.minLng, payload.lng);
      existing.maxLng = Math.max(existing.maxLng, payload.lng);
    } else {
      tiles.set(key, {
        minLat: payload.lat,
        maxLat: payload.lat,
        minLng: payload.lng,
        maxLng: payload.lng,
      });
    }
  }

  const latPad = radiusM / 111320;
  return [...tiles.values()].map(tile => {
    const centerLat = (tile.minLat + tile.maxLat) / 2;
    const lngPad = radiusM / (111320 * Math.max(Math.cos(centerLat * Math.PI / 180), 0.01));
    return {
      minLat: tile.minLat - latPad,
      maxLat: tile.maxLat + latPad,
      minLng: tile.minLng - lngPad,
      maxLng: tile.maxLng + lngPad,
    };
  });
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function cellKey(lat, lng, cellDegrees) {
  return `${Math.floor(lat / cellDegrees)}:${Math.floor(lng / cellDegrees)}`;
}

function buildPlaceGrid(places, cellDegrees) {
  const grid = new Map();
  for (const place of places) {
    const key = cellKey(place.lat, place.lng, cellDegrees);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(place);
  }
  return grid;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = value => value * Math.PI / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearbyPlacesFromGrid(grid, payload, { radiusM, cellDegrees }) {
  if (payload.lat === null || payload.lng === null) return [];

  const latCell = Math.floor(payload.lat / cellDegrees);
  const lngCell = Math.floor(payload.lng / cellDegrees);
  const cellRadius = Math.max(1, Math.ceil((radiusM / 111320) / cellDegrees) + 1);
  const rows = [];

  for (let latOffset = -cellRadius; latOffset <= cellRadius; latOffset++) {
    for (let lngOffset = -cellRadius; lngOffset <= cellRadius; lngOffset++) {
      const places = grid.get(`${latCell + latOffset}:${lngCell + lngOffset}`) || [];
      for (const place of places) {
        const distanceM = haversineMeters(payload.lat, payload.lng, place.lat, place.lng);
        if (distanceM <= radiusM) {
          rows.push({
            ...place,
            distance_m: Number(distanceM.toFixed(2)),
          });
        }
      }
    }
  }

  return rows.sort((a, b) => a.distance_m - b.distance_m).slice(0, 3);
}

async function loadCanonicalPlaces(client, tableName, payloads, args) {
  const tiles = buildPrefetchTiles(payloads, {
    radiusM: args.nearbyRadiusM,
    tileDegrees: args.prefetchTileDegrees,
  });
  if (!tiles.length) return { rows: [], tileCount: 0, queryCount: 0 };

  const byId = new Map();
  let queryCount = 0;
  for (const batch of chunks(tiles, args.prefetchBatchSize)) {
    const values = [];
    const placeholders = batch.map((tile, idx) => {
      const base = idx * 4;
      values.push(tile.minLat, tile.maxLat, tile.minLng, tile.maxLng);
      return `($${base + 1}::double precision, $${base + 2}::double precision, $${base + 3}::double precision, $${base + 4}::double precision)`;
    });

    const result = await client.query(`
      WITH prefetch_boxes(min_lat, max_lat, min_lng, max_lng) AS (
        VALUES ${placeholders.join(', ')}
      )
      SELECT DISTINCT
        c.id,
        c.name,
        c.state,
        c.google_place_id,
        c.lat::double precision AS lat,
        c.lng::double precision AS lng
      FROM ${tableName} c
      JOIN prefetch_boxes b
        ON c.lat::double precision BETWEEN b.min_lat AND b.max_lat
       AND c.lng::double precision BETWEEN b.min_lng AND b.max_lng
      WHERE c.lat IS NOT NULL
        AND c.lng IS NOT NULL
    `, values);

    queryCount += 1;
    for (const row of result.rows) byId.set(row.id, row);
  }

  return { rows: [...byId.values()], tileCount: tiles.length, queryCount };
}

async function annotateLiveNearby(client, rows, args) {
  const pendingCandidateRows = rows.filter(row => (
    row.status === 'pending'
    && row.review_kind === 'likely_new'
    && readinessFor(row, args.nearbyRadiusM) === 'candidate_ready'
  ));
  const payloads = pendingCandidateRows.map(candidatePayload);
  const canonicalPrefetch = await loadCanonicalPlaces(client, ENTITY_TABLES[args.entity], payloads, args);
  const gridCellDegrees = 0.02;
  const placeGrid = buildPlaceGrid(canonicalPrefetch.rows, gridCellDegrees);
  let liveNearbyRows = 0;

  pendingCandidateRows.forEach((row, index) => {
    const nearbyRows = nearbyPlacesFromGrid(placeGrid, payloads[index], {
      radiusM: args.nearbyRadiusM,
      cellDegrees: gridCellDegrees,
    });
    const nearest = nearbyRows[0];
    if (nearest) {
      row.live_nearest_distance_m = nearest.distance_m;
      row.live_nearest_place_id = nearest.id;
      row.live_nearest_place_name = nearest.name;
      liveNearbyRows += 1;
    }
  });

  return {
    liveNearbyRows,
    canonicalRowsPrefetched: canonicalPrefetch.rows.length,
    canonicalPrefetchTiles: canonicalPrefetch.tileCount,
    canonicalPrefetchQueries: canonicalPrefetch.queryCount,
    coordinateGridCellsBuilt: placeGrid.size,
  };
}

function aggregateFixtureRows(rows, args) {
  const buckets = new Map();
  for (const row of rows) {
    if (row.entity_type !== args.entity) continue;
    if (args.source && row.source !== args.source) continue;
    if (row.review_kind !== 'likely_new') continue;
    const reportFile = normalizeReportFile(row.report_file);
    const readiness = readinessFor(row, args.nearbyRadiusM);
    const key = `${reportFile}\t${row.status}\t${readiness}\t${signalCountFor(row)}`;
    const current = buckets.get(key) || {
      report_file: reportFile,
      status: row.status,
      review_readiness: readiness,
      source_signal_count: signalCountFor(row),
      rows: 0,
    };
    current.rows += 1;
    buckets.set(key, current);
  }
  return [...buckets.values()];
}

async function loadGroupedRows(args) {
  if (args.dbStateFixture) {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), args.dbStateFixture), 'utf8'));
    return {
      rows: aggregateFixtureRows(fixture.reviewRows || fixture.rows || [], args),
      liveStats: null,
    };
  }

  const client = new pg.Client(dbConfig());
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        id,
        COALESCE(report_file, '(missing)') AS report_file,
        status,
        review_kind,
        source,
        source_id,
        source_name,
        source_data,
        nearest_distance_m,
        ${SIGNAL_COUNT_SQL}::int AS source_signal_count
      FROM source_review_queue
      WHERE entity_type = $1
        AND source = $2
        AND review_kind = 'likely_new'
    `, [args.entity, args.source]);
    const liveStats = await annotateLiveNearby(client, result.rows, args);
    return { rows: aggregateLiveRows(result.rows, args), liveStats };
  } finally {
    await client.end();
  }
}

function aggregateLiveRows(rows, args) {
  const buckets = new Map();
  for (const row of rows) {
    const reportFile = normalizeReportFile(row.report_file);
    const readiness = row.live_nearest_distance_m != null
      ? 'nearby_canonical_review'
      : readinessFor(row, args.nearbyRadiusM);
    const signalCount = signalCountFor(row);
    const key = `${reportFile}\t${row.status}\t${readiness}\t${signalCount}`;
    const current = buckets.get(key) || {
      report_file: reportFile,
      status: row.status,
      review_readiness: readiness,
      source_signal_count: signalCount,
      rows: 0,
    };
    current.rows += 1;
    buckets.set(key, current);
  }
  return [...buckets.values()];
}

function summarize(rows, args) {
  const byReport = new Map();
  for (const row of rows) {
    const report = row.report_file;
    if (!byReport.has(report)) {
      byReport.set(report, {
        report_file: report,
        pending: 0,
        accepted: 0,
        linked: 0,
        candidate_ready_pending: 0,
        strong_ready_pending: 0,
        nearby_pending: 0,
        missing_required_pending: 0,
        max_signal_count: 0,
      });
    }
    const item = byReport.get(report);
    const count = Number(row.rows || 0);
    item[row.status] = (item[row.status] || 0) + count;
    item.max_signal_count = Math.max(item.max_signal_count, Number(row.source_signal_count || 0));
    if (row.status === 'pending' && row.review_readiness === 'candidate_ready') {
      item.candidate_ready_pending += count;
      if (Number(row.source_signal_count || 0) >= args.minSignals) item.strong_ready_pending += count;
    }
    if (row.status === 'pending' && row.review_readiness === 'nearby_canonical_review') item.nearby_pending += count;
    if (row.status === 'pending' && row.review_readiness === 'missing_required_data') item.missing_required_pending += count;
  }

  const reportRows = [...byReport.values()].sort((a, b) => (
    b.strong_ready_pending - a.strong_ready_pending ||
    b.candidate_ready_pending - a.candidate_ready_pending ||
    b.pending - a.pending ||
    a.report_file.localeCompare(b.report_file)
  ));

  const totals = reportRows.reduce((acc, row) => {
    for (const key of ['pending', 'accepted', 'linked', 'candidate_ready_pending', 'strong_ready_pending', 'nearby_pending', 'missing_required_pending']) {
      acc[key] += Number(row[key] || 0);
    }
    return acc;
  }, {
    pending: 0,
    accepted: 0,
    linked: 0,
    candidate_ready_pending: 0,
    strong_ready_pending: 0,
    nearby_pending: 0,
    missing_required_pending: 0,
  });

  return { totals, reportRows };
}

function commandFor(row, args) {
  return `node scripts/ops/accept-likely-new-source-candidates.mjs --source ${args.source} --report-file ${row.report_file} --min-signals ${args.minSignals} --limit 25`;
}

function table(headers, rows) {
  if (!rows.length) return '_none_';
  const escape = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${headers.map(header => escape(row[header])).join(' | ')} |`),
  ].join('\n');
}

function printMarkdown(payload) {
  console.log('# Reviewed-New Source Backlog Report');
  console.log('');
  console.log(`Generated: ${payload.generated_at}`);
  console.log(`Entity: ${payload.entity}`);
  console.log(`Source: ${payload.source}`);
  console.log(`Minimum strong signals: ${payload.min_signals}/4`);
  console.log(`Nearby duplicate radius: ${payload.nearby_radius_m}m`);
  if (payload.live_stats) {
    console.log(`Live nearby rows: ${payload.live_stats.liveNearbyRows}`);
    console.log(`Canonical rows prefetched: ${payload.live_stats.canonicalRowsPrefetched}`);
    console.log(`Canonical prefetch tiles: ${payload.live_stats.canonicalPrefetchTiles}`);
    console.log(`Canonical prefetch queries: ${payload.live_stats.canonicalPrefetchQueries}`);
  }
  console.log('');
  console.log('## Totals');
  console.log(table(['metric', 'rows'], Object.entries(payload.totals).map(([metric, rows]) => ({ metric, rows }))));
  console.log('');
  console.log('## Ranked Buckets');
  console.log(table([
    'report_file',
    'pending',
    'candidate_ready_pending',
    'strong_ready_pending',
    'nearby_pending',
    'missing_required_pending',
    'accepted',
    'linked',
    'max_signal_count',
  ], payload.report_rows));
  console.log('');
  console.log('## Suggested Next Dry Runs');
  console.log(table(['report_file', 'strong_ready_pending', 'dry_run_command'], payload.suggested_next));
}

async function main() {
  const args = parseArgs(process.argv);
  const { rows, liveStats } = await loadGroupedRows(args);
  const { totals, reportRows } = summarize(rows, args);
  const trimmedRows = reportRows.slice(0, args.maxRows);
  const suggestedNext = reportRows
    .filter(row => row.strong_ready_pending > 0)
    .slice(0, Math.min(args.maxRows, 8))
    .map(row => ({
      report_file: row.report_file,
      strong_ready_pending: row.strong_ready_pending,
      dry_run_command: commandFor(row, args),
    }));
  const payload = {
    generated_at: new Date().toISOString(),
    entity: args.entity,
    source: args.source,
    min_signals: args.minSignals,
    nearby_radius_m: args.nearbyRadiusM,
    live_stats: liveStats,
    totals,
    report_rows: trimmedRows,
    suggested_next: suggestedNext,
  };

  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printMarkdown(payload);
}

main().catch(error => {
  console.error(`reviewed-new-source-backlog-report failed: ${error.message || error}`);
  process.exit(1);
});
