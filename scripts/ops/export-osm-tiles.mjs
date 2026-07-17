#!/usr/bin/env node

/**
 * Bounded, resumable OSM source export.
 *
 * The single-bbox exporter already owns Overpass query and endpoint failover
 * behavior. This runner adds geographic tiling, per-tile checkpoints, and
 * deduplication so one slow tile cannot discard an entire regional run.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const [south, west, north, east] = String(args.bbox || '').split(',').map(Number)
const output = args.output
const manifestPath = args.manifest || `${output}.manifest.json`
const step = positiveNumber(args.step, 0.5)
const maxTiles = positiveInt(args['max-tiles'], Number.MAX_SAFE_INTEGER)
const delayMs = nonNegativeInt(args['delay-ms'], 1500)
const tileTimeoutMs = positiveInt(process.env.OSM_TILE_TIMEOUT_MS, 240000)
const retryCooldownMs = positiveInt(process.env.OSM_RETRY_COOLDOWN_MS, 60 * 60 * 1000)
const retryFailed = args['retry-failed'] === true || args['retry-failed'] === 'true'
if (![south, west, north, east].every(Number.isFinite) || !output) {
  throw new Error('Usage: export-osm-tiles.mjs --bbox south,west,north,east --output file [--step 0.5] [--manifest file]')
}
if (south >= north || west >= east || step <= 0) throw new Error('Invalid bbox or step')

const child = resolve(dirname(new URL(import.meta.url).pathname), 'export-osm-source.mjs')
const tiles = buildTiles(south, west, north, east, step)
const manifest = loadManifest(manifestPath, args.resume !== 'false')
if (args.resume !== 'false' && manifest.bbox && !sameNumbers(manifest.bbox, [south, west, north, east])) {
  throw new Error(`Manifest bbox mismatch for ${manifestPath}: existing=${manifest.bbox.join(',')} requested=${[south, west, north, east].join(',')}. Use a new manifest or --resume=false.`)
}
if (args.resume !== 'false' && manifest.step && Number(manifest.step) !== step) {
  throw new Error(`Manifest step mismatch for ${manifestPath}: existing=${manifest.step} requested=${step}. Use a new manifest or --resume=false.`)
}
manifest.bbox = [south, west, north, east]
manifest.step = step
manifest.total_tiles = tiles.length
manifest.tiles = manifest.tiles || {}

const rowsById = new Map()
for (const tile of Object.values(manifest.tiles)) {
  for (const row of tile.rows || []) rowsById.set(row.id, row)
}

let processed = 0
let deferred = 0
for (const tile of tiles) {
  const key = tileKey(tile)
  const prior = manifest.tiles[key]
  if (prior?.status === 'success' && args.resume !== 'false') continue
  if (prior?.status === 'failed' && !retryFailed && prior.next_retry_at && Date.parse(prior.next_retry_at) > Date.now() && args.resume !== 'false') {
    deferred += 1
    continue
  }
  if (processed >= maxTiles) break
  processed += 1

  const tileOutput = `${output}.${key}.json`
  try {
    const result = runTile(tile, tileOutput, child, tileTimeoutMs, 0, prior?.subtiles)
    const rows = result.rows
    for (const row of rows) rowsById.set(row.id, row)
    manifest.tiles[key] = { ...tile, status: 'success', rows, output: tileOutput, stdout: result.stdout, retry_count: 0, next_retry_at: null, completed_at: new Date().toISOString() }
  } catch (error) {
    const retryCount = Number(prior?.retry_count || 0) + 1
    const cooldown = Math.min(retryCooldownMs * (2 ** Math.max(0, retryCount - 1)), 6 * 60 * 60 * 1000)
    manifest.tiles[key] = {
      ...tile,
      status: 'failed',
      rows: [],
      retry_count: retryCount,
      next_retry_at: new Date(Date.now() + cooldown).toISOString(),
      ...(error.subtiles ? { subtiles: error.subtiles } : {}),
      error: String(error.stderr || error.message || error).trim().slice(-2000),
      completed_at: new Date().toISOString()
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  if (delayMs) await sleep(delayMs)
}

const rows = [...rowsById.values()]
writeFileSync(output, `${JSON.stringify(rows, null, 2)}\n`)
const statuses = Object.values(manifest.tiles).reduce((out, tile) => {
  out[tile.status] = (out[tile.status] || 0) + 1
  return out
}, {})
writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, rows: rows.length, statuses, deferred_tiles: deferred, updated_at: new Date().toISOString() }, null, 2)}\n`)
console.log(JSON.stringify({ source: 'osm', rows: rows.length, output, manifest: manifestPath, tiles: tiles.length, processed, retry_failed: retryFailed, deferred_tiles: deferred, statuses }))
// Successful tiles are still valid source input. Keep failed/deferred tiles in
// the manifest for retry, but do not discard the rows already collected from
// successful tiles or block unrelated source processing.
if ((statuses.success || 0) === 0 && (statuses.failed || 0) > 0) process.exitCode = 1

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else out[key] = argv[++i]
  }
  return out
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function positiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value || '')
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function sameNumbers(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => Number(value) === Number(right[index]))
}

function buildTiles(s, w, n, e, size) {
  const result = []
  for (let lat = s; lat < n; lat += size) {
    for (let lng = w; lng < e; lng += size) {
      result.push({ bbox: [round(lat), round(lng), round(Math.min(lat + size, n)), round(Math.min(lng + size, e))] })
    }
  }
  return result
}

function runTile(tile, tileOutput, child, timeoutMs, depth = 0, resumeSubtiles = null) {
  if (depth === 0 && Array.isArray(resumeSubtiles) && resumeSubtiles.length) {
    return runSubtiles(resumeSubtiles, child, timeoutMs, tileOutput, depth)
  }
  try {
    const stdout = execFileSync(process.execPath, [child, '--bbox', tile.bbox.join(','), '--output', tileOutput], {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    return { rows: JSON.parse(readFileSync(tileOutput, 'utf8')), stdout }
  } catch (error) {
    // One split level is enough to reduce query size without allowing a
    // single source run to fan out into an unbounded request tree. Failed
    // subtiles remain persisted for the next scheduled attempt.
    if (depth >= 1 || !isTimeout(error)) throw error

    // Overpass can time out on a sparse-looking but geographically broad tile.
    // Split only the failed tile so the manifest remains resumable and the
    // successful subtiles can still contribute rows to the regional export.
    const subtiles = buildTiles(...tile.bbox, (tile.bbox[2] - tile.bbox[0]) / 2)
    return runSubtiles(subtiles, child, timeoutMs, tileOutput, depth + 1)
  }
}

function runSubtiles(subtiles, child, timeoutMs, parentOutput, depth) {
    const results = []
    const descriptors = []
    for (const [index, subtile] of subtiles.entries()) {
      const subOutput = `${parentOutput}.sub${depth + 1}-${index}.json`
      if (subtile.status === 'success') {
        results.push({ rows: subtile.rows || [], stdout: subtile.stdout || '' })
        descriptors.push(subtile)
        continue
      }
      try {
        const result = runTile(subtile, subOutput, child, timeoutMs, depth)
        results.push(result)
        descriptors.push({ ...subtile, status: 'success', rows: result.rows, output: subOutput, stdout: result.stdout })
      } catch (error) {
        descriptors.push({
          ...subtile,
          status: 'failed',
          rows: [],
          error: String(error.stderr || error.message || error).trim().slice(-2000),
        })
      }
    }
    const failed = descriptors.filter(subtile => subtile.status !== 'success')
    if (failed.length) {
      const error = new Error(`adaptive OSM tile recovery failed for ${failed.length} subtiles`)
      error.subtiles = descriptors
      throw error
    }
    return {
      rows: [...new Map(results.flatMap(result => result.rows).map(row => [row.id, row])).values()],
      stdout: results.map(result => result.stdout).filter(Boolean).join('\n'),
      subtiles: descriptors,
    }
}

function isTimeout(error) {
  return error?.code === 'ETIMEDOUT' || /timed?out/i.test(String(error?.message || error?.stderr || ''))
}

function round(value) {
  return Number(value.toFixed(6))
}

function tileKey(tile) {
  return tile.bbox.map(value => String(value).replace('-', 'm').replace('.', 'p')).join('_')
}

function loadManifest(path, resume) {
  if (!resume || !existsSync(path)) return { version: 1, created_at: new Date().toISOString(), tiles: {} }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}
