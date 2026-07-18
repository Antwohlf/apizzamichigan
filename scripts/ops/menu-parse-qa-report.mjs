#!/usr/bin/env node

/**
 * Read-only coverage and queue report for the deterministic menu parser.
 * This deliberately does not claim that a menu was parsed successfully merely
 * because a place has a menu URL or scraped website evidence.
 */

import Database from 'better-sqlite3'
import pg from 'pg'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const json = process.argv.includes('--json')
const root = process.cwd()
const queuePath = process.env.QUEUE_DB_PATH || join(root, 'scripts/.job-queue.db')

function loadEnv(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line && !line.trim().startsWith('#') && line.includes('='))
    .map(line => {
      const [key, ...rest] = line.split('=')
      return [key.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')]
    }))
}

const env = { ...loadEnv(resolve(root, '.env')), ...loadEnv(resolve(root, '.env.local')), ...process.env }

function dbConfig() {
  return {
    host: env.LOCAL_DB_HOST || env.PGHOST || 'localhost',
    port: Number(env.LOCAL_DB_PORT || env.PGPORT || 5432),
    database: env.LOCAL_DB_NAME || env.PGDATABASE || 'pizza_enrichment',
    user: env.LOCAL_DB_USER || env.PGUSER || process.env.USER,
    password: env.LOCAL_DB_PASSWORD || env.PGPASSWORD || '',
  }
}

function queueReport() {
  if (!existsSync(queuePath)) return { ok: false, error: `queue DB missing: ${queuePath}` }
  const db = new Database(queuePath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM jobs
      WHERE job_type = 'menu_parse'
      GROUP BY status
      ORDER BY status
    `).all()
    return {
      ok: true,
      dbPath: queuePath,
      counts: Object.fromEntries(rows.map(row => [row.status, Number(row.count)])),
    }
  } finally {
    db.close()
  }
}

async function postgresReport() {
  const client = new pg.Client(dbConfig())
  await client.connect()
  try {
    const result = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE menu_url IS NOT NULL AND NULLIF(menu_url, '') IS NOT NULL)::int AS with_menu_url,
        COUNT(*) FILTER (WHERE menu_data IS NOT NULL AND menu_data <> '{}'::jsonb)::int AS with_menu_data,
        COUNT(*) FILTER (WHERE menu_parse_confidence IS NOT NULL)::int AS with_confidence,
        COUNT(*) FILTER (WHERE menu_last_parsed_at IS NOT NULL)::int AS parsed,
        COUNT(*) FILTER (WHERE menu_last_parsed_at >= NOW() - INTERVAL '30 days')::int AS parsed_recently,
        COUNT(*) FILTER (WHERE menu_url IS NOT NULL AND NULLIF(menu_url, '') IS NOT NULL AND menu_last_parsed_at IS NULL)::int AS never_parsed_with_menu_url,
        MAX(menu_last_parsed_at) AS last_parsed_at
      FROM pizza_places
    `)
    return { ok: true, ...result.rows[0] }
  } finally {
    await client.end().catch(() => {})
  }
}

try {
  const [queue, postgres] = await Promise.all([Promise.resolve(queueReport()), postgresReport()])
  const report = {
    generated_at: new Date().toISOString(),
    state: postgres.never_parsed_with_menu_url > 0 ? 'WARN' : 'OK',
    queue,
    postgres,
  }
  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`# Menu parse QA: ${report.state}`)
    console.log(`queue pending=${queue.counts?.pending || 0} processing=${queue.counts?.processing || 0} completed=${queue.counts?.completed || 0} failed=${queue.counts?.failed || 0}`)
    console.log(`places=${postgres.total} menu_urls=${postgres.with_menu_url} parsed=${postgres.parsed} parsed_recently=${postgres.parsed_recently}`)
    console.log(`never_parsed_with_menu_url=${postgres.never_parsed_with_menu_url}`)
    console.log(`last_parsed_at=${postgres.last_parsed_at || 'none'}`)
  }
} catch (error) {
  console.error(`menu-parse-qa-report failed: ${error.message || error}`)
  process.exitCode = 1
}
