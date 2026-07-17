#!/usr/bin/env node
/**
 * Verify that source-input matching is using the prefetch/grid path.
 *
 * This runs the real source-input-sample-report against a tiny source sample
 * and asserts the optimized metrics are emitted. It is read-only.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import pg from 'pg';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function metricValue(output, metric) {
  const escaped = metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*([0-9]+)\\s*\\|`);
  const match = output.match(pattern);
  return match ? Number(match[1]) : null;
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
    ...loadEnvFile('.env'),
    ...loadEnvFile('.env.local'),
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

async function sampleCanonicalPlace() {
  const client = new pg.Client(dbConfig());
  try {
    await client.connect();
    const result = await client.query(`
      SELECT id, name, lat::double precision AS lat, lng::double precision AS lng
      FROM pizza_places
      WHERE name IS NOT NULL
        AND lat IS NOT NULL
        AND lng IS NOT NULL
      ORDER BY id
      LIMIT 1
    `);
    const row = result.rows[0];
    if (!row) throw new Error('No canonical pizza place with name/coordinates found.');
    return row;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'apizza-source-prefetch-'));
  const input = join(dir, 'sample.geojson');
  const reviewOutput = join(dir, 'review.json');

  try {
    let canonical;
    try {
      canonical = await sampleCanonicalPlace();
    } catch (error) {
      throw new Error(`Cannot sample canonical pizza place; verify local Postgres is reachable before running this check. ${error.message || error}`);
    }

    writeFileSync(input, `${JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'prefetch-test-1',
          geometry: {
            type: 'Point',
            coordinates: [canonical.lng, canonical.lat],
          },
          properties: {
            id: 'prefetch-test-1',
            name: canonical.name,
            amenity: 'restaurant',
            cuisine: 'pizza',
            website: 'https://example.test/pizza',
          },
        },
      ],
    }, null, 2)}\n`);

    let output = '';
    try {
      output = execFileSync(process.execPath, [
        'scripts/ops/source-input-sample-report.mjs',
        '--source', 'all_the_places',
        '--input', input,
        '--entity', 'pizza',
        '--max-distance-m', '100',
        '--limit', '10',
        '--sample', '0',
        '--review-output', reviewOutput,
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
      });
    } catch (error) {
      const detail = String(error.stderr || error.stdout || error.message || error).trim();
      throw new Error(`source-input-sample-report failed; verify local Postgres is reachable before running this check. ${detail}`);
    }

    const inputRows = metricValue(output, 'input rows inspected');
    const compared = metricValue(output, 'pizza-ish active candidates');
    const prefetched = metricValue(output, 'canonical rows prefetched');
    const prefetchTiles = metricValue(output, 'canonical prefetch tiles');
    const prefetchQueries = metricValue(output, 'canonical prefetch queries');
    const gridCells = metricValue(output, 'coordinate grid cells built');

    assert(inputRows === 1, `Expected one input row, got ${inputRows}`);
    assert(compared === 1, `Expected one candidate compared, got ${compared}`);
    assert(prefetched > 0, `Expected prefetch to load at least one canonical row, got ${prefetched}`);
    assert(prefetchTiles === 1, `Expected one canonical prefetch tile, got ${prefetchTiles}`);
    assert(prefetchQueries === 1, `Expected one canonical prefetch query, got ${prefetchQueries}`);
    assert(gridCells > 0, `Expected grid to contain at least one coordinate cell, got ${gridCells}`);
    assert(output.includes('Review output:'), 'Report should complete and write review output in dry-run mode.');

    console.log('# Source Matching Prefetch Verification');
    console.log('');
    console.log(`input_rows=${inputRows}`);
    console.log(`candidates_compared=${compared}`);
    console.log(`canonical_rows_prefetched=${prefetched}`);
    console.log(`canonical_prefetch_tiles=${prefetchTiles}`);
    console.log(`canonical_prefetch_queries=${prefetchQueries}`);
    console.log(`coordinate_grid_cells_built=${gridCells}`);
    console.log('status=ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`verify-source-matching-prefetch failed: ${error.message || error}`);
  process.exit(1);
});
