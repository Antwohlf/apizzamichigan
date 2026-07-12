#!/usr/bin/env node
/**
 * Requeue MI OSM extract jobs when local Postgres indicates they were never fetched.
 *
 * Problem this addresses:
 * - Michigan stats can stall if the SQLite queue marks MI osm_extract jobs completed,
 *   but local Postgres rows still have osm_fetch_status != 'success'.
 *
 * This script:
 * 1) Finds MI pizza_places rows missing osm_fetch_status='success'
 * 2) Ensures a corresponding osm_extract job exists in SQLite
 * 3) Forces that job back to pending (and resets attempts) so the extractor will retry.
 *
 * Usage:
 *   node scripts/enrichment/requeue-mi-osm-extract.mjs [--dry-run]
 */

import 'dotenv/config'
import pg from 'pg'
import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const queueDbPath = join(repoRoot, 'scripts', '.job-queue.db')

const dryRun = process.argv.includes('--dry-run')

async function main() {
  const client = new pg.Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    database: process.env.PGDATABASE || 'pizza_enrichment',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || ''
  })

  await client.connect()

  const { rows } = await client.query(`
    SELECT google_place_id
    FROM pizza_places
    WHERE state = 'MI'
      AND google_place_id LIKE 'osm:%'
      AND COALESCE(osm_fetch_status, '') <> 'success'
  `)

  const osmIds = rows.map(r => r.google_place_id)
  console.log(`MI rows needing OSM fetch: ${osmIds.length}`)

  if (!osmIds.length) {
    await client.end()
    return
  }

  const db = new Database(queueDbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 20000')

  const selectJob = db.prepare(`
    SELECT id, status, attempts, max_attempts
    FROM jobs
    WHERE job_type = 'osm_extract'
      AND osm_id = ?
      AND place_type = 'pizza'
    LIMIT 1
  `)

  const insertJob = db.prepare(`
    INSERT INTO jobs (job_type, osm_id, place_type, priority, status, attempts, max_attempts)
    VALUES ('osm_extract', ?, 'pizza', 100, 'pending', 0, 3)
    ON CONFLICT(job_type, osm_id) DO NOTHING
  `)

  const forcePending = db.prepare(`
    UPDATE jobs
    SET status = 'pending',
        worker_id = NULL,
        started_at = NULL,
        completed_at = NULL,
        last_error = NULL,
        attempts = 0,
        priority = CASE WHEN priority < 100 THEN 100 ELSE priority END
    WHERE id = ?
  `)

  let created = 0
  let reset = 0
  let alreadyPending = 0

  const tx = db.transaction(() => {
    for (const osmId of osmIds) {
      const j = selectJob.get(osmId)
      if (!j) {
        if (!dryRun) insertJob.run(osmId)
        created++
        continue
      }

      if (j.status === 'pending') {
        alreadyPending++
        continue
      }

      if (!dryRun) forcePending.run(j.id)
      reset++
    }
  })

  tx()
  db.close()
  await client.end()

  console.log(`Queue reconciliation complete (dryRun=${dryRun})`)
  console.log(`- jobs created: ${created}`)
  console.log(`- jobs reset to pending: ${reset}`)
  console.log(`- already pending: ${alreadyPending}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
