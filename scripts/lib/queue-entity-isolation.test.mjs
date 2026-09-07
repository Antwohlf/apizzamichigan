import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

import { JobQueue } from '../enrichment/queue.mjs'

function withQueue(run) {
  const directory = mkdtempSync(join(tmpdir(), 'apizza-queue-'))
  const path = join(directory, 'queue.sqlite')
  const queue = new JobQueue(path).init()
  try {
    return run(queue, path)
  } finally {
    queue.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('allows the same source identity to have independent Pizza and Taco jobs', () => {
  withQueue(queue => {
    assert.equal(queue.addJob('scrape', 'osm:node/42', 'pizza'), true)
    assert.equal(queue.addJob('scrape', 'osm:node/42', 'taco'), true)
    assert.equal(queue.addJob('scrape', 'osm:node/42', 'pizza'), false)
    assert.deepEqual(
      queue.db.prepare('SELECT place_type FROM jobs ORDER BY place_type').all(),
      [{ place_type: 'pizza' }, { place_type: 'taco' }],
    )
  })
})

test('entity-scoped claims cannot consume another product queue', () => {
  withQueue(queue => {
    queue.addJob('scrape', 'osm:node/1', 'pizza', null, 100)
    queue.addJob('scrape', 'osm:node/2', 'taco', null, 10)
    queue.registerWorker('taco-scraper', 'scrape')
    const claimed = queue.claim('scrape', 'taco-scraper', { placeType: 'taco' })
    assert.equal(claimed.placeType, 'taco')
    assert.equal(claimed.osmId, 'osm:node/2')
    assert.equal(
      queue.db.prepare("SELECT status FROM jobs WHERE place_type='pizza'").get().status,
      'pending',
    )
  })
})

test('targetless conflict handling rejects malformed jobs instead of hiding them as duplicates', () => {
  withQueue(queue => {
    assert.throws(
      () => queue.addJob('scrape', 'osm:node/invalid', null),
      /NOT NULL constraint failed: jobs\.place_type/,
    )
  })
})

test('does not rewrite a live legacy queue during a rolling code deployment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'apizza-queue-migration-'))
  const path = join(directory, 'queue.sqlite')
  const legacy = new Database(path)
  legacy.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      osm_id TEXT NOT NULL,
      place_type TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      worker_id TEXT,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      last_error TEXT,
      data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(job_type, osm_id)
    );
    INSERT INTO jobs (job_type, osm_id, place_type) VALUES ('scrape', 'osm:node/42', 'pizza');
  `)
  const queue = new JobQueue(path).init()
  try {
    assert.equal(queue.addJob('scrape', 'osm:node/42', 'taco'), false)
    assert.equal(queue.addJob('scrape', 'osm:node/43', 'taco'), true)
    legacy.prepare(`
      INSERT INTO jobs (job_type, osm_id, place_type)
      VALUES (?, ?, ?)
      ON CONFLICT(job_type, osm_id) DO NOTHING
    `).run('scrape', 'osm:node/44', 'pizza')
    assert.equal(queue.db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count, 3)
    assert.match(
      queue.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get().sql,
      /UNIQUE\s*\(job_type, osm_id\)/,
    )
  } finally {
    queue.close()
    legacy.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
