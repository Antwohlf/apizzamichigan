#!/usr/bin/env node
/**
 * Hourly status report for apizzamichigan enrichment pipeline.
 * Tracks queue progress + row/column value updates with hour-over-hour deltas.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const snapshotPath = join(repoRoot, '.status_hourly.json');
const queueDbPath = join(repoRoot, 'scripts', '.job-queue.db');

// Load DB config
const envPath = join(repoRoot, '.env.local');
const envConfig = existsSync(envPath)
  ? Object.fromEntries(
      readFileSync(envPath, 'utf-8')
        .split('\n')
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
          const [key, ...rest] = line.split('=');
          return [key.trim(), rest.join('=').trim()];
        })
    )
  : {};

const dbConfig = {
  host: envConfig.LOCAL_DB_HOST || 'localhost',
  port: parseInt(envConfig.LOCAL_DB_PORT || '5432'),
  database: envConfig.LOCAL_DB_NAME || 'pizza_enrichment',
  user: envConfig.LOCAL_DB_USER || process.env.USER,
  password: envConfig.LOCAL_DB_PASSWORD || ''
};

async function getQueueStats() {
  const db = new Database(queueDbPath, { readonly: true });
  try {
    const stats = {};
    const types = ['osm_extract', 'scrape', 'classify'];

    for (const type of types) {
      const row = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM jobs
        WHERE job_type = ?
      `).get(type);
      stats[type] = row;
    }

    return stats;
  } finally {
    db.close();
  }
}

async function getEnrichmentMetrics() {
  const client = new pg.Client(dbConfig);
  await client.connect();

  try {
    const metrics = {};

    // Overall stats
    const overall = await client.query(`
      SELECT
        COUNT(*) as total_rows,
        COUNT(osm_tags) as osm_tags_populated,
        COUNT(scrape_method) as scraped,
        COUNT(CASE WHEN style IS NOT NULL OR price_range IS NOT NULL THEN 1 END) as classified
      FROM pizza_places
    `);
    metrics.overall = overall.rows[0];

    // Michigan stats (state='MI')
    const mi = await client.query(`
      SELECT
        COUNT(*) as total_rows,
        COUNT(osm_tags) as osm_tags_populated,
        COUNT(scrape_method) as scraped,
        COUNT(CASE WHEN style IS NOT NULL OR price_range IS NOT NULL THEN 1 END) as classified
      FROM pizza_places
      WHERE state = 'MI'
    `);
    metrics.michigan = mi.rows[0];

    return metrics;
  } finally {
    await client.end();
  }
}

function loadPreviousSnapshot() {
  if (!existsSync(snapshotPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  } catch (err) {
    console.error('Failed to load previous snapshot:', err.message);
    return null;
  }
}

function saveSnapshot(data) {
  writeFileSync(snapshotPath, JSON.stringify(data, null, 2), 'utf-8');
}

function formatDelta(current, previous, label) {
  if (previous === null || previous === undefined) {
    return `${current.toLocaleString()} ${label}`;
  }
  const delta = current - previous;
  if (delta === 0) {
    return `${current.toLocaleString()} ${label}`;
  }
  const sign = delta > 0 ? '+' : '';
  return `${current.toLocaleString()} ${label} (${sign}${delta.toLocaleString()})`;
}

function formatQueueProgress(current, previous, type) {
  const pct = current.total > 0
    ? Math.round((current.completed / current.total) * 100)
    : 0;

  let line = `**${type}**: ${formatDelta(current.completed, previous?.completed, 'completed')} / ${current.total.toLocaleString()} (${pct}%)`;

  if (current.failed > 0) {
    line += ` • ${formatDelta(current.failed, previous?.failed, 'failed')}`;
  }

  return line;
}

async function main() {
  const timestamp = new Date().toISOString();
  const previous = loadPreviousSnapshot();

  const [queueStats, enrichmentMetrics] = await Promise.all([
    getQueueStats(),
    getEnrichmentMetrics()
  ]);

  // Build report
  const lines = [];
  lines.push('## 📊 apizzamichigan Enrichment Status');
  lines.push('');

  // Queue progress
  lines.push('### Queue Progress');
  lines.push(formatQueueProgress(queueStats.osm_extract, previous?.queue?.osm_extract, 'OSM Extract'));
  lines.push(formatQueueProgress(queueStats.scrape, previous?.queue?.scrape, 'Scrape'));
  lines.push(formatQueueProgress(queueStats.classify, previous?.queue?.classify, 'Classify'));
  lines.push('');

  // Enrichment metrics
  lines.push('### Enrichment Metrics (Overall)');
  lines.push(`- **OSM tags populated**: ${formatDelta(
    parseInt(enrichmentMetrics.overall.osm_tags_populated),
    previous?.metrics?.overall?.osm_tags_populated,
    'rows'
  )}`);
  lines.push(`- **Scraped**: ${formatDelta(
    parseInt(enrichmentMetrics.overall.scraped),
    previous?.metrics?.overall?.scraped,
    'rows'
  )}`);
  lines.push(`- **Classified**: ${formatDelta(
    parseInt(enrichmentMetrics.overall.classified),
    previous?.metrics?.overall?.classified,
    'rows'
  )}`);
  lines.push('');

  lines.push('### Michigan Stats');
  lines.push(`- **OSM tags populated**: ${formatDelta(
    parseInt(enrichmentMetrics.michigan.osm_tags_populated),
    previous?.metrics?.michigan?.osm_tags_populated,
    'rows'
  )}`);
  lines.push(`- **Scraped**: ${formatDelta(
    parseInt(enrichmentMetrics.michigan.scraped),
    previous?.metrics?.michigan?.scraped,
    'rows'
  )}`);
  lines.push(`- **Classified**: ${formatDelta(
    parseInt(enrichmentMetrics.michigan.classified),
    previous?.metrics?.michigan?.classified,
    'rows'
  )}`);

  // Save snapshot
  const snapshot = {
    timestamp,
    queue: queueStats,
    metrics: {
      overall: {
        osm_tags_populated: parseInt(enrichmentMetrics.overall.osm_tags_populated),
        scraped: parseInt(enrichmentMetrics.overall.scraped),
        classified: parseInt(enrichmentMetrics.overall.classified)
      },
      michigan: {
        osm_tags_populated: parseInt(enrichmentMetrics.michigan.osm_tags_populated),
        scraped: parseInt(enrichmentMetrics.michigan.scraped),
        classified: parseInt(enrichmentMetrics.michigan.classified)
      }
    }
  };
  saveSnapshot(snapshot);

  console.log(lines.join('\n'));
}

main().catch(err => {
  console.error('Error generating hourly status:', err);
  process.exit(1);
});
