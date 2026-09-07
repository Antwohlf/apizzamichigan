require('dotenv').config()

const express = require('express')
const cookieParser = require('cookie-parser')
const { createHash } = require('crypto')
const { existsSync, readdirSync, readFileSync, statSync } = require('fs')
const { join, resolve } = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const pg = require('pg')
const { createClient } = require('@supabase/supabase-js')
const { handleBugReport } = require('../api/_lib/bugReport')
const { handleAutocomplete, handlePlaceDetails } = require('../api/_lib/places')
const { getClientIp } = require('../api/_lib/request')
const { applyLifecycleChange, normalizeLifecycleChange } = require('../scripts/lib/lifecycle-mutation.cjs')
const {
  DEFAULT_SESSION_TTL_MS,
  createAdminSessionValue,
  isAdminAuthConfigured,
  validateAdminSessionValue,
} = require('../shared/admin-session-boundary.cjs')
const {
  presentPipelineStatus,
  readPipelineStatusSnapshot,
  resolveStatusSelection,
} = require('../shared/pipeline-status-boundary.cjs')

const app = express()
// Note: 5000 is commonly hijacked by AirPlay Receiver on macOS.
// Use 5050 by default to avoid the AirTunes 403 you observed.
const PORT = process.env.PORT || 5050
const COOKIE_NAME = 'admin_auth'
const REVIEW_PHOTO_BUCKET = 'review-photos'
const SUGGESTED_PLACES_TABLE = 'suggested_places'
const LOCATIONS_TABLE = 'locations'
const REVIEW_PHOTO_TABLE = 'review-photos'
const FALLBACK_SUPABASE_URL = 'https://htahyiuvqmalfpbgiizx.supabase.co'
const MAX_REVIEW_PHOTOS = 10
const MAX_REVIEW_PHOTO_BYTES = 8 * 1024 * 1024
const execFileAsync = promisify(execFile)
const SOURCE_REVIEW_DIR = process.env.SOURCE_REVIEW_DIR || 'reports/source-review'
const SOURCE_REVIEW_QUEUE_CSV = process.env.SOURCE_REVIEW_QUEUE_CSV || 'reports/source-review-queue.csv'
const SOURCE_POLICY = JSON.parse(readFileSync(resolve(__dirname, '..', 'config/source-policy.json'), 'utf8'))
const SOURCE_PIPELINE = JSON.parse(readFileSync(resolve(__dirname, '..', 'config/source-pipeline.json'), 'utf8'))
const ENTITY_PROFILES = JSON.parse(readFileSync(resolve(__dirname, '..', 'config/entity-profiles.json'), 'utf8'))
const PIPELINE_BOUNDARY = JSON.parse(readFileSync(resolve(__dirname, '..', 'config/pipeline-boundary.json'), 'utf8'))
const SOURCE_FRESHNESS_CASE = Object.entries(SOURCE_POLICY.sources || {})
  .map(([source, config]) => `WHEN '${source.replaceAll("'", "''")}' THEN ${Number(config.freshness_days) || 365}`)
  .join(' ')
let reviewPhotosTableAvailable = true
let sourceReviewDecisionHistorySchemaReady = false

function normalizedSourceId(value) {
  return String(value || '').trim().replace(/^osm:/i, '')
}

function latestOsmInputIds(entity) {
  if (entity !== 'pizza' && entity !== 'taco') return { files: [], ids: new Set() }
  const regions = SOURCE_PIPELINE.operational_regions || SOURCE_PIPELINE.regions || []
  const ids = new Set()
  const files = []
  for (const region of regions) {
    const key = typeof region === 'string' ? region : region?.key
    if (!key) continue
    const file = resolve(__dirname, '..', 'reports', 'osm', `${String(key).toLowerCase()}-${entity}.json`)
    if (!existsSync(file)) continue
    files.push(file)
    try {
      const payload = JSON.parse(readFileSync(file, 'utf8'))
      const rows = Array.isArray(payload) ? payload : payload?.rows
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        const id = normalizedSourceId(row?.id || row?.source_id)
        if (id) ids.add(id)
      }
    } catch {
      // A partial refresh cannot prove that a source row was observed.
    }
  }
  return { files, ids }
}

const ADMIN_PASSWORD = process.env.ADMIN_PORTAL_PASSWORD
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD || null
const ADMIN_AUTH_CONFIGURED = isAdminAuthConfigured({
  password: ADMIN_PASSWORD,
  sessionSecret: ADMIN_SESSION_SECRET,
})
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  FALLBACK_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

let serviceClient = null
if (SUPABASE_URL && SERVICE_ROLE_KEY) {
  serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
} else {
  console.warn('[admin] Supabase service client not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
}

app.use(cookieParser(ADMIN_SESSION_SECRET || undefined))
app.use(express.json({ limit: '12mb' }))
app.set('trust proxy', true)

function requireSignedAdminSession(req, res, next) {
  if (!ADMIN_AUTH_CONFIGURED) {
    return res.status(503).json({ error: 'Admin authentication not configured' })
  }
  const session = validateAdminSessionValue(req.signedCookies?.[COOKIE_NAME])
  if (!session.ok) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  return next()
}

function requireSupabaseServiceClient(req, res, next) {
  if (!serviceClient) {
    return res.status(500).json({ error: 'Supabase service role not configured' })
  }
  return next()
}

function requireAdminAuth(req, res, next) {
  return requireSignedAdminSession(req, res, () => requireSupabaseServiceClient(req, res, next))
}

const getPlaceTable = (entity = 'pizza') =>
  ENTITY_PROFILES.profiles?.[entity]?.canonical_table || ENTITY_PROFILES.profiles?.pizza?.canonical_table || 'pizza_places'

const localPostgresConfig = () => ({
  host: process.env.PGHOST || process.env.LOCAL_DB_HOST || 'localhost',
  port: parseInt(process.env.PGPORT || process.env.LOCAL_DB_PORT || '5432', 10),
  database: process.env.PGDATABASE || process.env.LOCAL_DB_NAME || 'pizza_enrichment',
  user: process.env.PGUSER || process.env.LOCAL_DB_USER || process.env.USER,
  password: process.env.PGPASSWORD || process.env.LOCAL_DB_PASSWORD || '',
})

const normalizeCount = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const configuredCoverageRegions = entity => {
  if (entity === 'pizza') {
    return (SOURCE_PIPELINE.operational_regions || SOURCE_PIPELINE.regions || [])
      .map(region => typeof region === 'string' ? region : region?.key)
      .map(region => String(region || '').trim().toUpperCase())
      .filter(Boolean)
  }
  return (ENTITY_PROFILES.profiles?.[entity]?.regions || [])
    .map(region => String(region || '').trim().toUpperCase())
    .filter(Boolean)
}

// Review work defaults to the active product geography. Operators can pass
// state=all when deliberately expanding the worklist beyond that scope.
const sourceReviewRegions = (entity, rawState) => {
  const requested = String(rawState || '').trim().toLowerCase()
  if (requested === 'all') return null
  if (requested) {
    return [...new Set(requested.split(',').map(value => value.trim().toUpperCase()).filter(Boolean))]
  }
  return configuredCoverageRegions(entity)
}

const sourceReviewRegionSql = (sourceAlias, placeAlias, parameterIndex) => `(
  UPPER(COALESCE(${sourceAlias}.source_data->>'region', ${sourceAlias}.source_data->>'state', ${sourceAlias}.source_data->>'country', '')) = ANY($${parameterIndex}::text[])
  OR UPPER(COALESCE(${placeAlias}.state, '')) = ANY($${parameterIndex}::text[])
)`

const buildBasicFieldCoverage = (totalRow = {}, stateRows = [], scope = []) => {
  const fields = ['address', 'website_url', 'phone', 'style', 'price_range']
  const normalize = row => {
    const total = normalizeCount(row?.total)
    const missing = Object.fromEntries(fields.map(field => [field, normalizeCount(row?.[`missing_${field}`])]))
    return {
      total,
      missing,
      needsAttention: normalizeCount(row?.needs_attention),
    }
  }
  return {
    scope,
    fields,
    overall: normalize(totalRow),
    byState: Object.fromEntries(stateRows.map(row => [row.state, normalize(row)])),
  }
}

const sourceReviewSignalCountSql = `(
  CASE WHEN NULLIF(source_data->>'address', '') IS NOT NULL OR NULLIF(source_data->>'addr:full', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN NULLIF(source_data->>'website', '') IS NOT NULL OR NULLIF(source_data->>'contact:website', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN NULLIF(source_data->>'phone', '') IS NOT NULL OR NULLIF(source_data->>'contact:phone', '') IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN (
    (NULLIF(source_data->>'lat', '') IS NOT NULL OR NULLIF(source_data->>'latitude', '') IS NOT NULL) AND
    (NULLIF(source_data->>'lng', '') IS NOT NULL OR NULLIF(source_data->>'lon', '') IS NOT NULL OR NULLIF(source_data->>'longitude', '') IS NOT NULL)
  ) THEN 1 ELSE 0 END
)`

// This is only a review-ordering hint. It never auto-links a source row or
// promotes source fields into the canonical place record.
const sourceReviewEvidenceCountSql = `(
  CASE WHEN nearest_distance_m IS NOT NULL AND nearest_distance_m <= 10 THEN 1 ELSE 0 END +
  CASE WHEN nearest_name_score IS NOT NULL AND nearest_name_score >= 0.98 THEN 1 ELSE 0 END +
  CASE WHEN (
    length(right(regexp_replace(coalesce(NULLIF(source_data->>'phone', ''), NULLIF(source_data->>'contact:phone', ''), ''), '[^0-9]', '', 'g'), 10)) = 10
    AND right(regexp_replace(coalesce(NULLIF(source_data->>'phone', ''), NULLIF(source_data->>'contact:phone', ''), ''), '[^0-9]', '', 'g'), 10)
      = right(regexp_replace(coalesce(nearest.phone, ''), '[^0-9]', '', 'g'), 10)
  ) THEN 1 ELSE 0 END +
  CASE WHEN (
    COALESCE(NULLIF(source_data->>'website', ''), NULLIF(source_data->>'contact:website', '')) IS NOT NULL
    AND regexp_replace(regexp_replace(lower(COALESCE(NULLIF(source_data->>'website', ''), NULLIF(source_data->>'contact:website', ''))), '^https?://(www\\.)?', '', ''), '/+$', '', 'g')
      = regexp_replace(regexp_replace(lower(coalesce(nearest.website_url, '')), '^https?://(www\\.)?', '', ''), '/+$', '', 'g')
  ) THEN 1 ELSE 0 END
)`

const sourceReviewReadinessSql = `(
  CASE
    WHEN review_kind <> 'likely_new' THEN 'link_review'
    WHEN COALESCE(NULLIF(source_name, ''), NULLIF(source_data->>'name', '')) IS NULL
      OR NULLIF(source_id, '') IS NULL
      OR NOT (
        (NULLIF(source_data->>'lat', '') IS NOT NULL OR NULLIF(source_data->>'latitude', '') IS NOT NULL) AND
        (NULLIF(source_data->>'lng', '') IS NOT NULL OR NULLIF(source_data->>'lon', '') IS NOT NULL OR NULLIF(source_data->>'longitude', '') IS NOT NULL)
      )
      THEN 'missing_required_data'
    WHEN nearest_distance_m IS NOT NULL AND nearest_distance_m <= 150
      THEN 'nearby_canonical_review'
    WHEN status = 'accepted' AND EXISTS (
      SELECT 1
      FROM source_review_queue peer
      WHERE peer.entity_type = source_review_queue.entity_type
        AND peer.source = source_review_queue.source
        AND peer.review_kind = 'likely_new'
        AND peer.status = 'accepted'
        AND peer.id <> source_review_queue.id
        AND COALESCE(NULLIF(peer.source_data->>'lat', ''), NULLIF(peer.source_data->>'latitude', '')) IS NOT NULL
        AND COALESCE(NULLIF(peer.source_data->>'lng', ''), NULLIF(peer.source_data->>'lon', ''), NULLIF(peer.source_data->>'longitude', '')) IS NOT NULL
        AND COALESCE(NULLIF(source_review_queue.source_data->>'lat', ''), NULLIF(source_review_queue.source_data->>'latitude', '')) IS NOT NULL
        AND COALESCE(NULLIF(source_review_queue.source_data->>'lng', ''), NULLIF(source_review_queue.source_data->>'lon', ''), NULLIF(source_review_queue.source_data->>'longitude', '')) IS NOT NULL
        AND (111320 * sqrt(
          power(COALESCE(NULLIF(peer.source_data->>'lat', ''), NULLIF(peer.source_data->>'latitude', ''))::double precision - COALESCE(NULLIF(source_review_queue.source_data->>'lat', ''), NULLIF(source_review_queue.source_data->>'latitude', ''))::double precision, 2)
          + power((COALESCE(NULLIF(peer.source_data->>'lng', ''), NULLIF(peer.source_data->>'lon', ''), NULLIF(peer.source_data->>'longitude', ''))::double precision - COALESCE(NULLIF(source_review_queue.source_data->>'lng', ''), NULLIF(source_review_queue.source_data->>'lon', ''), NULLIF(source_review_queue.source_data->>'longitude', ''))::double precision)
            * cos(radians(COALESCE(NULLIF(source_review_queue.source_data->>'lat', ''), NULLIF(source_review_queue.source_data->>'latitude', ''))::double precision)), 2)
        )) <= 150
    ) THEN 'duplicate_accepted_source_coordinate'
    ELSE 'candidate_ready'
  END
)`
const sourceReviewReadinessSqlForAlias = sourceReviewReadinessSql
  .replaceAll('source_review_queue.', 'srq.')
  .replace(/(?<![\w.])review_kind\b/g, 'srq.review_kind')
  .replace(/(?<![\w.])source_name\b/g, 'srq.source_name')
  .replace(/(?<![\w.])source_data\b/g, 'srq.source_data')
  .replace(/(?<![\w.])source_id\b/g, 'srq.source_id')
  .replace(/(?<![\w.])nearest_distance_m\b/g, 'srq.nearest_distance_m')
  .replace(/(?<![\w.])status\b/g, 'srq.status')

function readSourceReviewReports(entity, inputDir = SOURCE_REVIEW_DIR) {
  const absDir = resolve(process.cwd(), inputDir)
  const result = {
    available: existsSync(absDir),
    inputDir,
    totals: { inputRows: 0, matched: 0, ambiguous: 0, likelyNew: 0, accepted: 0 },
    reports: [],
    errors: [],
  }

  if (!result.available) return result

  for (const file of readdirSync(absDir).filter(name => name.endsWith('-review.json')).sort()) {
    try {
      const report = JSON.parse(readFileSync(join(absDir, file), 'utf8'))
      if (report.entity && report.entity !== entity) continue
      const counts = report.counts || {}
      const row = {
        file,
        source: report.source || '',
        sourceLabel: report.source_label || report.source || '',
        generatedAt: report.generated_at || null,
        inputRows: normalizeCount(counts.inputRowsInspected),
        matched: normalizeCount(counts.matchedExistingPlaces),
        ambiguous: normalizeCount(counts.ambiguousReviewCandidates ?? report.ambiguous?.length),
        likelyNew: normalizeCount(counts.likelyNewUnmatchedCandidates ?? report.likely_new?.length),
        accepted: normalizeCount(counts.acceptedForPlaceSourcesImport),
      }
      result.reports.push(row)
      result.totals.inputRows += row.inputRows
      result.totals.matched += row.matched
      result.totals.ambiguous += row.ambiguous
      result.totals.likelyNew += row.likelyNew
      result.totals.accepted += row.accepted
    } catch (error) {
      result.errors.push({ file, error: error?.message || 'Unable to read report' })
    }
  }

  return result
}

function readSourceReviewQueueCsv(csvPath = SOURCE_REVIEW_QUEUE_CSV) {
  const absPath = resolve(process.cwd(), csvPath)
  if (!existsSync(absPath)) {
    return { available: false, path: csvPath, reviewRows: 0, updatedAt: null }
  }

  const text = readFileSync(absPath, 'utf8').trim()
  const lines = text ? text.split(/\r?\n/) : []
  const stat = statSync(absPath)
  return {
    available: true,
    path: csvPath,
    reviewRows: Math.max(0, lines.length - 1),
    updatedAt: stat.mtime.toISOString(),
  }
}

function commandPartsToString(parts) {
  return parts.map(part => {
    const text = String(part)
    return /\s/.test(text) ? JSON.stringify(text) : text
  }).join(' ')
}

function fsqPortalSetupSteps({
  portalInitSqlExists,
  portalPythonDuckdbExists,
  canExportViaPortal,
  portalInitSqlPath,
  portalInitSqlExamplePath,
}) {
  return [
    {
      id: 'copy_portal_sql',
      status: portalInitSqlExists ? 'done' : 'needed',
      title: 'Save the Places Portal DuckDB/Iceberg setup SQL',
      detail: `Copy the Portal-provided setup snippet into ${portalInitSqlPath}; use ${portalInitSqlExamplePath} as the checklist and keep tokens out of git.`,
    },
    {
      id: 'create_python_duckdb_venv',
      status: portalPythonDuckdbExists ? 'done' : 'needed',
      title: 'Create the ignored Python DuckDB environment',
      detail: 'Run the setup command once on the machine that will export the bounded FSQ sample.',
    },
    {
      id: 'run_portal_export',
      status: canExportViaPortal ? 'ready' : 'blocked',
      title: 'Export a bounded sample and run the read-only adapter report',
      detail: 'After the token, SQL setup, and Python environment are present, run the Places Portal export command.',
    },
  ]
}

function readFsqSampleReadiness(entity) {
  const sampleFromEnv = process.env.FSQ_OS_PLACES_SAMPLE || ''
  const defaultSample = entity === 'taco'
    ? 'data/source-samples/fsq-os-places-taco-sample.json'
    : 'data/source-samples/fsq-os-places-pizza-sample.json'
  const samplePath = sampleFromEnv || defaultSample
  const sampleExists = Boolean(samplePath && existsSync(resolve(process.cwd(), samplePath)))
  const portalInitSqlPath = 'scripts/.fsq-portal-init.sql'
  const portalInitSqlExamplePath = 'scripts/ops/fsq-portal-init.example.sql'
  const portalInitSqlExists = existsSync(resolve(process.cwd(), portalInitSqlPath))
  const portalPythonDuckdbExists = existsSync(resolve(process.cwd(), 'scripts/.fsq-venv/bin/python'))
  const tokens = ['FSQ_PLACES_TOKEN', 'HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN'].map(name => ({
    name,
    present: Boolean(process.env[name]),
  }))
  const hasPortalToken = tokens.some(token => token.name === 'FSQ_PLACES_TOKEN' && token.present)
  const hasHfToken = tokens.some(token => ['HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN'].includes(token.name) && token.present)
  const canExportViaPortal = hasPortalToken && portalInitSqlExists && portalPythonDuckdbExists
  const reviewOutput = entity === 'taco'
    ? 'reports/source-review/fsq-os-places-taco-review.json'
    : 'reports/source-review/fsq-os-places-review.json'
  const adapterCommand = [
    'node',
    'scripts/ops/source-input-sample-report.mjs',
    '--source',
    'fsq_os_places',
    '--input',
    samplePath || '<exported-fsq-sample.json>',
    '--entity',
    entity,
    '--max-distance-m',
    '100',
    '--limit',
    '5000',
    '--sample',
    '25',
    '--review-output',
    reviewOutput,
  ]
  const exportCommand = [
    'node',
    'scripts/ops/export-fsq-hf-sample.mjs',
    '--query',
    entity === 'taco' ? 'taco' : 'pizza',
    '--length',
    '100',
    '--pages',
    '1',
    '--output',
    samplePath || defaultSample,
    '--entity',
    entity,
    '--review-output',
    reviewOutput,
    '--run-report',
  ]
  const portalExportCommand = [
    'scripts/.fsq-venv/bin/python',
    'scripts/ops/export-fsq-portal-duckdb-sample.py',
    '--init-sql-file',
    portalInitSqlPath,
    '--query',
    entity === 'taco' ? 'taco' : 'pizza',
    '--limit',
    '100',
    '--output',
    samplePath || defaultSample,
    '--entity',
    entity,
    '--review-output',
    reviewOutput,
    '--run-report',
  ]
  const portalSetupCommand = [
    'sh',
    '-lc',
    'python3 -m venv scripts/.fsq-venv && scripts/.fsq-venv/bin/python -m pip install --upgrade pip duckdb pyiceberg pyarrow',
  ]

  const state = sampleExists
    ? 'sample_ready'
    : hasHfToken
      ? 'hf_export_ready'
      : hasPortalToken
        ? canExportViaPortal
          ? 'portal_export_ready'
          : 'portal_setup_needed'
      : 'blocked_missing_sample_or_token'
  const recommendedAction = sampleExists
    ? 'run_adapter_report'
    : hasHfToken
      ? 'export_hf_sample_and_run_report'
      : hasPortalToken
        ? canExportViaPortal
          ? 'export_places_portal_sample_then_run_report'
          : 'save_places_portal_init_sql_then_export'
        : 'provide_fsq_sample_or_token'
  const missing = []
  if (!sampleExists) missing.push(`FSQ sample file: ${samplePath}`)
  if (!sampleExists && hasPortalToken && !portalPythonDuckdbExists) missing.push('Places Portal Python DuckDB venv: scripts/.fsq-venv/bin/python')
  if (!sampleExists && hasPortalToken && !portalInitSqlExists) missing.push(`Places Portal DuckDB setup SQL: ${portalInitSqlPath}`)
  if (!sampleExists && !hasHfToken && !hasPortalToken) missing.push('FSQ sample file, Hugging Face token, or Places Portal token')

  return {
    source: 'fsq_os_places',
    state,
    recommendedAction,
    samplePath,
    sampleExists,
    portalInitSqlPath,
    portalInitSqlExamplePath,
    portalInitSqlExists,
    portalPythonDuckdbExists,
    canExportViaPortal,
    tokenStatus: tokens,
    missing,
    adapterCommand: commandPartsToString(adapterCommand),
    exportCommand: commandPartsToString(exportCommand),
    portalExportCommand: commandPartsToString(portalExportCommand),
    portalSetupCommand: commandPartsToString(portalSetupCommand),
    portalSetupSteps: fsqPortalSetupSteps({
      portalInitSqlExists,
      portalPythonDuckdbExists,
      canExportViaPortal,
      portalInitSqlPath,
      portalInitSqlExamplePath,
    }),
  }
}

async function readLocalSourceProvenance(entity) {
  const client = new pg.Client(localPostgresConfig())
  try {
    await client.connect()
    const tableName = SOURCE_REVIEW_ENTITY_TABLES[entity] || SOURCE_REVIEW_ENTITY_TABLES.pizza
    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('place_sources', 'source_review_queue')
    `)
    const tables = new Set(tableCheck.rows.map(row => row.table_name))

    if (!tables.has('place_sources')) {
      return {
        available: false,
        reason: 'place_sources table is not present in local Postgres.',
        sourceCounts: [],
        matchMethods: [],
        recentPlaceSources: [],
        reviewQueue: { available: tables.has('source_review_queue'), statusCounts: [], sourceCounts: [], reportCounts: [], readinessCounts: [] },
      }
    }

    const queueQueries = tables.has('source_review_queue')
      ? [
          client.query(`
            SELECT review_kind, status, COUNT(*)::int AS rows
            FROM source_review_queue
            WHERE entity_type = $1
            GROUP BY review_kind, status
            ORDER BY review_kind, status
          `, [entity]),
          client.query(`
            SELECT source, review_kind, status, COUNT(*)::int AS rows
            FROM source_review_queue
            WHERE entity_type = $1
            GROUP BY source, review_kind, status
            ORDER BY source, review_kind, status
          `, [entity]),
          client.query(`
            SELECT
              source,
              report_file,
              review_kind,
              status,
              COUNT(*)::int AS rows,
              MIN(imported_at) AS first_imported_at,
              MAX(updated_at) AS latest_updated_at
            FROM source_review_queue
            WHERE entity_type = $1
            GROUP BY source, report_file, review_kind, status
            ORDER BY
              CASE status WHEN 'pending' THEN 0 ELSE 1 END,
              COUNT(*) DESC,
              source,
              report_file,
              review_kind,
              status
          `, [entity]),
          client.query(`
            SELECT
              review_kind,
              status,
              ${sourceReviewReadinessSql} AS readiness,
              COUNT(*)::int AS rows
            FROM source_review_queue
            WHERE entity_type = $1
            GROUP BY review_kind, status, readiness
            ORDER BY
              CASE status WHEN 'pending' THEN 0 ELSE 1 END,
              review_kind,
              readiness
          `, [entity]),
        ]
      : [Promise.resolve({ rows: [] }), Promise.resolve({ rows: [] }), Promise.resolve({ rows: [] }), Promise.resolve({ rows: [] })]

    const promotionCandidatesCte = `
      WITH promotion_candidates AS (
        SELECT
          'website_url' AS field,
          p.id AS place_id,
          p.name AS place_name,
          p.google_place_id,
          ps.source,
          ps.source_id,
          ps.match_method,
          ps.match_confidence,
          COALESCE(
            NULLIF(ps.data->>'website', ''),
            NULLIF(ps.data->>'website_url', ''),
            NULLIF(ps.data->>'contact:website', ''),
            NULLIF(ps.data->>'url', '')
          ) AS proposed_value
        FROM place_sources ps
        JOIN ${tableName} p ON p.id = ps.place_id
        WHERE ps.entity_type = $1
          AND ps.source = ANY($2::text[])
          AND ps.match_method = ANY($3::text[])
          AND COALESCE(ps.match_confidence, 0) >= $4
          AND NULLIF(p.website_url, '') IS NULL
          AND COALESCE(
            NULLIF(ps.data->>'website', ''),
            NULLIF(ps.data->>'website_url', ''),
            NULLIF(ps.data->>'contact:website', ''),
            NULLIF(ps.data->>'url', '')
          ) ~* '^https?://'
        UNION ALL
        SELECT
          'phone' AS field,
          p.id AS place_id,
          p.name AS place_name,
          p.google_place_id,
          ps.source,
          ps.source_id,
          ps.match_method,
          ps.match_confidence,
          COALESCE(
            NULLIF(ps.data->>'phone', ''),
            NULLIF(ps.data->>'contact:phone', ''),
            NULLIF(ps.data->>'tel', '')
          ) AS proposed_value
        FROM place_sources ps
        JOIN ${tableName} p ON p.id = ps.place_id
        WHERE ps.entity_type = $1
          AND ps.source = ANY($2::text[])
          AND ps.match_method = ANY($3::text[])
          AND COALESCE(ps.match_confidence, 0) >= $4
          AND NULLIF(p.phone, '') IS NULL
          AND LENGTH(REGEXP_REPLACE(COALESCE(
            NULLIF(ps.data->>'phone', ''),
            NULLIF(ps.data->>'contact:phone', ''),
            NULLIF(ps.data->>'tel', '')
          ), '[^0-9]', '', 'g')) >= 7
      )
    `
    const promotionParams = [
      entity,
      SOURCE_CONTACT_PROMOTION_PREVIEW.sources,
      SOURCE_CONTACT_PROMOTION_PREVIEW.matchMethods,
      SOURCE_CONTACT_PROMOTION_PREVIEW.minConfidence,
    ]

    const [sourceCounts, matchMethods, recentPlaceSources, promotionCounts, promotionSample, reviewQueueStatus, reviewQueueSources, reviewQueueReports, reviewQueueReadiness] = await Promise.all([
      client.query(`
        SELECT
          source,
          COUNT(*)::int AS rows,
          COUNT(DISTINCT place_id)::int AS places,
          COUNT(*) FILTER (WHERE ps.retrieved_at >= NOW() - make_interval(days => CASE ps.source ${SOURCE_FRESHNESS_CASE} ELSE 365 END))::int AS fresh_rows,
          COUNT(*) FILTER (WHERE ps.retrieved_at < NOW() - make_interval(days => CASE ps.source ${SOURCE_FRESHNESS_CASE} ELSE 365 END))::int AS stale_rows,
          MAX(retrieved_at) AS latest_retrieved_at,
          MAX(updated_at) AS latest_updated_at
        FROM place_sources ps
        WHERE entity_type = $1
        GROUP BY source
        ORDER BY source
      `, [entity]),
      client.query(`
        SELECT
          source,
          COALESCE(match_method, 'unknown') AS match_method,
          COUNT(*)::int AS rows
        FROM place_sources
        WHERE entity_type = $1
        GROUP BY source, COALESCE(match_method, 'unknown')
        ORDER BY source, rows DESC, match_method
      `, [entity]),
      client.query(`
        SELECT
          ps.place_id,
          p.name AS place_name,
          p.google_place_id,
          ps.source,
          ps.source_id,
          ps.source_url,
          COALESCE(ps.match_method, 'unknown') AS match_method,
          ps.match_confidence,
          ps.retrieved_at,
          ps.updated_at
        FROM place_sources ps
        LEFT JOIN ${tableName} p ON p.id = ps.place_id
        WHERE ps.entity_type = $1
        ORDER BY ps.updated_at DESC NULLS LAST, ps.retrieved_at DESC NULLS LAST, ps.id DESC
        LIMIT 25
      `, [entity]),
      client.query(`
        ${promotionCandidatesCte}
        SELECT field, source, COUNT(*)::int AS rows
        FROM promotion_candidates
        GROUP BY field, source
        ORDER BY field, rows DESC, source
      `, promotionParams),
      client.query(`
        ${promotionCandidatesCte}
        SELECT
          field,
          place_id,
          place_name,
          google_place_id,
          source,
          source_id,
          match_method,
          match_confidence,
          proposed_value
        FROM promotion_candidates
        ORDER BY field, source, place_id
        LIMIT 25
      `, promotionParams),
      ...queueQueries,
    ])

    return {
      available: true,
      database: localPostgresConfig().database,
      localOnly: true,
      sourceCounts: sourceCounts.rows,
      matchMethods: matchMethods.rows,
      recentPlaceSources: recentPlaceSources.rows,
      promotionCandidates: {
        policy: SOURCE_CONTACT_PROMOTION_PREVIEW,
        counts: promotionCounts.rows,
        sample: promotionSample.rows,
      },
      reviewQueue: {
        available: tables.has('source_review_queue'),
        statusCounts: reviewQueueStatus.rows,
        sourceCounts: reviewQueueSources.rows,
        reportCounts: reviewQueueReports.rows,
        readinessCounts: reviewQueueReadiness.rows,
      },
    }
  } catch (error) {
    return {
      available: false,
      reason: error?.message || 'Unable to read local source provenance.',
      sourceCounts: [],
      matchMethods: [],
    }
  } finally {
    try {
      await client.end()
    } catch (error) {
      // Connection may never have opened; nothing to clean up.
    }
  }
}

async function withLocalPostgres(work) {
  const client = new pg.Client(localPostgresConfig())
  try {
    await client.connect()
    return await work(client)
  } finally {
    try {
      await client.end()
    } catch (error) {
      // Connection may never have opened; nothing to clean up.
    }
  }
}

async function sourceReviewQueueExists(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'source_review_queue'
    ) AS exists
  `)
  if (!result.rows[0]?.exists) return false
  if (!sourceReviewDecisionHistorySchemaReady) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS source_review_decision_history (
        id BIGSERIAL PRIMARY KEY,
        review_queue_id BIGINT NOT NULL,
        entity_type TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        previous_review_kind TEXT,
        previous_status TEXT,
        previous_decision TEXT,
        previous_canonical_place_id BIGINT,
        review_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        decision TEXT,
        canonical_place_id BIGINT,
        action TEXT NOT NULL,
        reviewer_notes TEXT,
        reviewed_by TEXT,
        canonical_before JSONB,
        canonical_after JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      ALTER TABLE source_review_decision_history
        ADD COLUMN IF NOT EXISTS canonical_before JSONB,
        ADD COLUMN IF NOT EXISTS canonical_after JSONB
    `)
    sourceReviewDecisionHistorySchemaReady = true
  }
  return true
}

async function recordSourceReviewDecision(client, row, next, action, { canonicalBefore = null, canonicalAfter = null } = {}) {
  await client.query(`
    INSERT INTO source_review_decision_history (
      review_queue_id, entity_type, source, source_id,
      previous_review_kind, previous_status, previous_decision, previous_canonical_place_id,
      review_kind, status, decision, canonical_place_id, action, reviewer_notes, reviewed_by,
      canonical_before, canonical_after
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)
  `, [
    row.id, row.entity_type, row.source, row.source_id,
    row.review_kind || null, row.status || null, row.decision || null, row.canonical_place_id || null,
    next.review_kind || row.review_kind, next.status, next.decision || null,
    next.canonical_place_id || null, action, next.reviewer_notes || null, next.reviewed_by || 'admin',
    canonicalBefore == null ? null : JSON.stringify(canonicalBefore),
    canonicalAfter == null ? null : JSON.stringify(canonicalAfter),
  ])
}

const safeInteger = (value, fallback, { min = 0, max = 1000 } = {}) => {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

const parseReviewIdList = value => {
  const raw = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(raw
    .map(item => Number.parseInt(String(item).trim(), 10))
    .filter(Number.isFinite)
    .filter(id => id > 0))]
}

const allowedSourceReviewStatuses = new Set(['pending', 'accepted', 'linked', 'rejected', 'ignored'])
const allowedSourceReviewKinds = new Set(['ambiguous', 'likely_new'])
const allowedSourceReviewReadiness = new Set(['candidate_ready', 'replacement_candidate_ready', 'nearby_canonical_review', 'duplicate_accepted_source_coordinate', 'missing_required_data', 'link_review'])
const allowedSourceReviewScopes = new Set(['chain', 'independent'])
const SOURCE_CONTACT_PROMOTION_PREVIEW = {
  sources: ['official_website', 'osm', 'fsq_os_places', 'all_the_places', 'overture_places', 'wikidata'],
  fields: ['website_url', 'phone'],
  matchMethods: ['exact_name_nearby', 'strong_spatial_name', 'imported_primary', 'reviewed_link', 'reviewed_new_import', 'scraped_first_party'],
  minConfidence: 0.9,
}
const SOURCE_REVIEW_ENTITY_TABLES = {
  pizza: 'pizza_places',
  taco: 'taco_places',
}
const SOURCE_REVIEW_SOURCE_METADATA = {
  all_the_places: {
    license: 'CC0-1.0',
    attribution: 'All the Places contributors',
  },
  fsq_os_places: {
    license: 'Apache-2.0',
    attribution: 'Copyright Foursquare Labs, Inc.',
  },
  osm: {
    license: 'ODbL-1.0',
    attribution: 'OpenStreetMap contributors',
  },
  overture_places: {
    license: 'see-release-attribution',
    attribution: 'Overture Maps Foundation and source contributors',
  },
  wikidata: {
    license: 'CC0-1.0',
    attribution: 'Wikidata contributors',
  },
  government_open_data: {
    license: 'dataset-specific',
    attribution: 'dataset-specific',
  },
  denue: {
    license: 'verify-before-import',
    attribution: 'INEGI DENUE',
  },
  official_website: {
    license: 'first-party-factual-evidence',
    attribution: 'official restaurant website',
  },
}

const ATP_REPORT_CANONICAL_NAMES = {
  'and_pizza-review.json': '&pizza',
  'bc_pizza-review.json': 'B.C. Pizza',
  'california_pizza_kitchen-review.json': 'California Pizza Kitchen',
  'dominos_pizza_us-review.json': "Domino's Pizza",
  'flippin_pizza_us-review.json': "Flippin' Pizza",
  'foxs_pizza-review.json': "Fox's Pizza",
  'grimaldis_pizzeria-review.json': "Grimaldi's Pizzeria",
  'larosas-review.json': "LaRosa's Pizzeria",
  'little_caesars_us-review.json': 'Little Caesars',
  'marcos-review.json': "Marco's Pizza",
  'mod_pizza-review.json': 'MOD Pizza',
  'monicals_pizza_us-review.json': "Monical's Pizza",
  'mountain_mikes_us-review.json': "Mountain Mike's Pizza",
  'papa_johns-review.json': "Papa John's",
  'papa_murphys-review.json': "Papa Murphy's",
  'pizza_ranch_us-review.json': 'Pizza Ranch',
  'round_table_pizza-review.json': 'Round Table Pizza',
  'sals_pizza_us-review.json': "Sal's Pizza",
  'simple_simons_pizza_us-review.json': "Simple Simon's Pizza",
  'vocelli_pizza_us-review.json': 'Vocelli Pizza',
}

async function placeSourcesExists(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'place_sources'
    ) AS exists
  `)
  return Boolean(result.rows[0]?.exists)
}

const sourceReviewNumber = value => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const sourceReviewCoordinate = (row, keys) => {
  for (const key of keys) {
    const value = sourceReviewNumber(row.source_data?.[key])
    if (value !== null) return value
  }
  return null
}

const canonicalSourceReviewName = row => {
  if (row.source === 'all_the_places' && row.report_file === 'pizza_hut_us-review.json') {
    return /express/i.test(row.source_name || row.source_data?.name || '')
      ? 'Pizza Hut Express'
      : 'Pizza Hut'
  }
  if (row.source === 'all_the_places' && row.report_file === 'mr_gattis_pizza_us-review.json') {
    const rawName = row.source_name || row.source_data?.name || ''
    if (/gattitown/i.test(rawName)) return 'GattiTown'
    if (/gattiland/i.test(rawName)) return 'GattiLand'
    return "Mr Gatti's Pizza"
  }
  if (row.source === 'all_the_places' && ATP_REPORT_CANONICAL_NAMES[row.report_file]) {
    return ATP_REPORT_CANONICAL_NAMES[row.report_file]
  }
  return row.source_name || row.source_data?.name || null
}

const sourceReviewCandidatePayload = row => {
  const source = String(row.source || '').trim()
  const sourceId = String(row.source_id || '').trim()
  return {
    name: canonicalSourceReviewName(row),
    lat: sourceReviewCoordinate(row, ['lat', 'latitude']),
    lng: sourceReviewCoordinate(row, ['lng', 'lon', 'longitude']),
    address: row.source_data?.address || row.source_data?.['addr:full'] || null,
    state: row.source_data?.region || row.source_data?.state || row.source_data?.country || null,
    websiteUrl: row.source_data?.website || row.source_data?.['contact:website'] || null,
    phone: row.source_data?.phone || row.source_data?.['contact:phone'] || null,
    googlePlaceId: source && sourceId ? `${source}:${sourceId}` : null,
  }
}

async function sourceReviewGooglePlaceIdExists(client, tableName, googlePlaceId) {
  if (!googlePlaceId) return false
  const result = await client.query(`
    SELECT id, name, lifecycle_status, lifecycle_replaced_by_id
    FROM ${tableName}
    WHERE google_place_id = $1
    LIMIT 1
  `, [googlePlaceId])
  return result.rows[0] || null
}

async function findNearbySourceReviewPlaces(client, tableName, payload, radiusM) {
  if (payload.lat === null || payload.lng === null) return []
  const result = await client.query(`
    SELECT
      id,
      name,
      state,
      google_place_id,
      ROUND((
        6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(($1 - lat) / 2)), 2) +
          COS(RADIANS(lat)) * COS(RADIANS($1)) *
          POWER(SIN(RADIANS(($2 - lng) / 2)), 2)
        ))
      )::numeric, 2) AS distance_m
    FROM ${tableName}
    WHERE lat BETWEEN $1 - ($3 / 111320.0) AND $1 + ($3 / 111320.0)
      AND lng BETWEEN $2 - ($3 / (111320.0 * GREATEST(COS(RADIANS($1)), 0.01)))
                  AND $2 + ($3 / (111320.0 * GREATEST(COS(RADIANS($1)), 0.01)))
      AND (
        6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(($1 - lat) / 2)), 2) +
          COS(RADIANS(lat)) * COS(RADIANS($1)) *
          POWER(SIN(RADIANS(($2 - lng) / 2)), 2)
        ))
      ) <= $3
    ORDER BY distance_m ASC
    LIMIT 3
  `, [payload.lat, payload.lng, radiusM])
  return result.rows
}

async function loadSourceReviewCanonicalPlaces(client, tableName, payloads, radiusM) {
  const located = payloads.filter(payload => payload.lat !== null && payload.lng !== null)
  if (!located.length) return []

  const lats = located.map(payload => payload.lat)
  const lngs = located.map(payload => payload.lng)
  const latPad = radiusM / 111320
  const minLat = Math.min(...lats) - latPad
  const maxLat = Math.max(...lats) + latPad
  const minLngRaw = Math.min(...lngs)
  const maxLngRaw = Math.max(...lngs)
  const lngPad = radiusM / (111320 * Math.max(Math.cos(((minLat + maxLat) / 2) * Math.PI / 180), 0.01))
  const minLng = minLngRaw - lngPad
  const maxLng = maxLngRaw + lngPad

  const result = await client.query(`
    SELECT
      id,
      name,
      state,
      google_place_id,
      lat::double precision AS lat,
      lng::double precision AS lng
    FROM ${tableName}
    WHERE lat IS NOT NULL
      AND lng IS NOT NULL
      AND lat::double precision BETWEEN $1 AND $2
      AND lng::double precision BETWEEN $3 AND $4
      AND COALESCE(lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
  `, [minLat, maxLat, minLng, maxLng])

  return result.rows
}

const sourceReviewGridKey = (lat, lng, cellDegrees) =>
  `${Math.floor(lat / cellDegrees)}:${Math.floor(lng / cellDegrees)}`

function buildSourceReviewPlaceGrid(places, cellDegrees) {
  const grid = new Map()
  for (const place of places) {
    const key = sourceReviewGridKey(place.lat, place.lng, cellDegrees)
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(place)
  }
  return grid
}

function sourceReviewHaversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = value => value * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

function nearbySourceReviewPlacesFromGrid(grid, payload, { radiusM, cellDegrees }) {
  if (payload.lat === null || payload.lng === null) return []

  const latCell = Math.floor(payload.lat / cellDegrees)
  const lngCell = Math.floor(payload.lng / cellDegrees)
  const cellRadius = Math.max(1, Math.ceil((radiusM / 111320) / cellDegrees) + 1)
  const rows = []

  for (let latOffset = -cellRadius; latOffset <= cellRadius; latOffset++) {
    for (let lngOffset = -cellRadius; lngOffset <= cellRadius; lngOffset++) {
      const places = grid.get(`${latCell + latOffset}:${lngCell + lngOffset}`) || []
      for (const place of places) {
        const distanceM = sourceReviewHaversineMeters(payload.lat, payload.lng, place.lat, place.lng)
        if (distanceM <= radiusM) {
          rows.push({
            ...place,
            distance_m: Number(distanceM.toFixed(2)),
          })
        }
      }
    }
  }

  return rows
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 3)
}

async function allocateNextCanonicalPlaceId(client, tableName) {
  await client.query(`LOCK TABLE ${tableName} IN EXCLUSIVE MODE`)
  const result = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${tableName}`)
  return result.rows[0]?.next_id
}

const reviewedNewImportReadiness = (payload, duplicateBySourceId, nearbyRows) => {
  const missing = []
  if (!payload.name) missing.push('name')
  if (payload.lat === null) missing.push('lat')
  if (payload.lng === null) missing.push('lng')
  if (!payload.googlePlaceId) missing.push('source_id')
  if (missing.length) return `missing_${missing.join('_')}`
  if (duplicateBySourceId && !['closed', 'replaced', 'demolished'].includes(duplicateBySourceId.lifecycle_status)) return 'duplicate_source_id'
  if (duplicateBySourceId) return 'replacement_candidate_ready'
  if (nearbyRows.length) return 'nearby_canonical_review'
  return 'candidate_ready'
}

function sourceCandidateDistanceMeters(a, b) {
  if (a.proposed_lat === null || a.proposed_lng === null || b.proposed_lat === null || b.proposed_lng === null) return null
  const toRad = value => Number(value) * Math.PI / 180
  const lat1 = toRad(a.proposed_lat)
  const lat2 = toRad(b.proposed_lat)
  const deltaLat = toRad(Number(b.proposed_lat) - Number(a.proposed_lat))
  const deltaLng = toRad(Number(b.proposed_lng) - Number(a.proposed_lng))
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function annotateAcceptedSourceCoordinateDuplicates(candidates, duplicateRadiusM = 25) {
  for (const candidate of candidates) {
    if (candidate.readiness !== 'candidate_ready') continue
    const duplicates = candidates
      .filter(other => (
        other !== candidate
        && other.source === candidate.source
        && other.source_id !== candidate.source_id
      ))
      .map(other => ({
        candidate: other,
        distanceM: sourceCandidateDistanceMeters(candidate, other),
      }))
      .filter(item => item.distanceM !== null && item.distanceM <= duplicateRadiusM)
      .sort((a, b) => a.distanceM - b.distanceM)

    const nearest = duplicates[0]
    if (!nearest) continue
    candidate.readiness = 'duplicate_accepted_source_coordinate'
    candidate.nearest_source_review_id = nearest.candidate.review_id
    candidate.nearest_source_name = nearest.candidate.source_name
    candidate.nearest_source_distance_m = Number(nearest.distanceM.toFixed(2))
  }
}

async function buildReviewedNewImportPreflight(client, { entity, source, reportFile, state, reviewIds = [], limit, nearbyRadiusM, candidateSampleLimit = 12 }) {
  const tableName = SOURCE_REVIEW_ENTITY_TABLES[entity]
  if (!tableName) {
    const error = new Error('Unsupported source review entity type.')
    error.status = 400
    throw error
  }

  const filters = [
    `entity_type = $1`,
    `review_kind = 'likely_new'`,
    `status = 'accepted'`,
  ]
  const values = [entity]
  if (source) {
    values.push(source)
    filters.push(`source = $${values.length}`)
  }
  if (reportFile) {
    values.push(reportFile)
    filters.push(`report_file = $${values.length}`)
  }
  if (state) {
    values.push(String(state).trim().toUpperCase())
    filters.push(`UPPER(COALESCE(source_data->>'region', source_data->>'state', source_data->>'country', '')) = $${values.length}`)
  }
  if (reviewIds.length) {
    values.push(reviewIds)
    filters.push(`id = ANY($${values.length}::bigint[])`)
    limit = Math.max(limit, reviewIds.length)
  }
  const where = filters.join(' AND ')
  const totalResult = await client.query(`SELECT COUNT(*)::int AS total FROM source_review_queue WHERE ${where}`, values)

  values.push(limit)
  const rows = await client.query(`
    SELECT
      id,
      entity_type,
      source,
      source_id,
      source_name,
      source_url,
      source_data,
      reviewer_notes,
      reviewed_at,
      reviewed_by,
      report_file
    FROM source_review_queue
    WHERE ${where}
    ORDER BY reviewed_at NULLS LAST, source_name NULLS LAST, id
    LIMIT $${values.length}
  `, values)

  const candidates = []
  const payloads = rows.rows.map(row => sourceReviewCandidatePayload(row))
  const googlePlaceIds = [...new Set(payloads.map(payload => payload.googlePlaceId).filter(Boolean))]
  const existingGooglePlaceIds = googlePlaceIds.length
    ? new Map((await client.query(
      `SELECT google_place_id, id, name, lifecycle_status, lifecycle_replaced_by_id FROM ${tableName} WHERE google_place_id = ANY($1::text[])`,
      [googlePlaceIds],
    )).rows.map(row => [row.google_place_id, row]))
    : new Map()
  const canonicalPlaces = await loadSourceReviewCanonicalPlaces(client, tableName, payloads, nearbyRadiusM)
  const gridCellDegrees = 0.02
  const placeGrid = buildSourceReviewPlaceGrid(canonicalPlaces, gridCellDegrees)

  rows.rows.forEach((row, index) => {
    const payload = payloads[index]
    const duplicateBySourceId = existingGooglePlaceIds.get(payload.googlePlaceId) || null
    const nearbyRows = nearbySourceReviewPlacesFromGrid(placeGrid, payload, {
      radiusM: nearbyRadiusM,
      cellDegrees: gridCellDegrees,
    })
    candidates.push({
      review_id: row.id,
      source: row.source,
      source_id: row.source_id,
      source_name: row.source_name,
      proposed_google_place_id: payload.googlePlaceId,
      proposed_name: payload.name,
      proposed_lat: payload.lat,
      proposed_lng: payload.lng,
      proposed_address: payload.address,
      proposed_state: payload.state,
      proposed_website_url: payload.websiteUrl,
      proposed_phone: payload.phone,
      readiness: reviewedNewImportReadiness(payload, duplicateBySourceId, nearbyRows),
      nearby_count: nearbyRows.length,
      nearest_place_id: nearbyRows[0]?.id || null,
      nearest_place_name: nearbyRows[0]?.name || null,
      nearest_distance_m: nearbyRows[0]?.distance_m || null,
      nearest_source_review_id: null,
      nearest_source_name: null,
      nearest_source_distance_m: null,
      reviewed_at: row.reviewed_at,
      report_file: row.report_file,
    })
  })

  annotateAcceptedSourceCoordinateDuplicates(candidates)

  const readinessCounts = Object.entries(candidates.reduce((acc, candidate) => {
    acc[candidate.readiness] = (acc[candidate.readiness] || 0) + 1
    return acc
  }, {})).map(([readiness, rows]) => ({ readiness, rows }))

  const candidateReady = readinessCounts
    .filter(row => ['candidate_ready', 'replacement_candidate_ready'].includes(row.readiness))
    .reduce((total, row) => total + row.rows, 0)
  return {
    generatedAt: new Date().toISOString(),
    entity,
    source: source || 'all',
    reportFile: reportFile || 'all',
    state: state || 'all',
    reviewIds,
    tableName,
    nearbyRadiusM,
    acceptedTotal: totalResult.rows[0]?.total || 0,
    rowsInspected: candidates.length,
    rowsNotInspected: Math.max(0, (totalResult.rows[0]?.total || 0) - candidates.length),
    canonicalRowsPrefetched: canonicalPlaces.length,
    coordinateGridCellsBuilt: placeGrid.size,
    candidateReady,
    readinessCounts,
    candidates: candidates.slice(0, candidateSampleLimit),
  }
}

function reviewedNewSourceData(row, placeId, payload) {
  return {
    ...(row.source_data || {}),
    source_id: row.source_id,
    name: row.source_name,
    source_url: row.source_url || null,
    imported_place: {
      id: placeId,
      google_place_id: payload.googlePlaceId,
      name: payload.name,
    },
    review: {
      queue_id: row.id,
      review_kind: 'likely_new',
      decision: 'imported_new',
      reviewed_by: row.reviewed_by || 'admin',
      reviewer_notes: row.reviewer_notes || null,
      report_file: row.report_file || null,
    },
  }
}

async function importReviewedNewCandidate(client, tableName, row) {
  const payload = sourceReviewCandidatePayload(row)
  const metadata = SOURCE_REVIEW_SOURCE_METADATA[row.source] || {
    license: 'source-specific',
    attribution: row.source,
  }
  const placeId = await allocateNextCanonicalPlaceId(client, tableName)
  const existingResult = payload.googlePlaceId
    ? await client.query(`
        SELECT id, name, google_place_id, lifecycle_status
        FROM ${tableName}
        WHERE google_place_id = $1
        FOR UPDATE
      `, [payload.googlePlaceId])
    : { rows: [] }
  const historicalPlace = existingResult.rows[0] || null
  if (historicalPlace && !['closed', 'replaced', 'demolished'].includes(historicalPlace.lifecycle_status)) {
    const error = new Error('This source identity already belongs to an active place.')
    error.status = 409
    throw error
  }
  if (historicalPlace) {
    await client.query(`
      UPDATE ${tableName}
      SET google_place_id = $2, updated_at = NOW()
      WHERE id = $1
    `, [historicalPlace.id, `historical:${payload.googlePlaceId}`])
  }

  const insert = await client.query(`
    INSERT INTO ${tableName} (
      id,
      name,
      lat,
      lng,
      address,
      google_place_id,
      state,
      status,
      website_url,
      phone,
      address_source,
      enrichment_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'unvisited', $8, $9, $10, 'pending')
    RETURNING id, name, google_place_id
  `, [
    placeId,
    payload.name,
    payload.lat,
    payload.lng,
    payload.address,
    payload.googlePlaceId,
    payload.state,
    payload.websiteUrl,
    payload.phone,
    row.source === 'osm' ? 'osm' : null,
  ])

  const place = insert.rows[0]

  if (historicalPlace) {
    await client.query(`
      UPDATE ${tableName}
      SET lifecycle_status = 'replaced', lifecycle_replaced_by_id = $2, updated_at = NOW()
      WHERE id = $1
    `, [historicalPlace.id, place.id])
  }

  await client.query(`
    INSERT INTO place_sources (
      entity_type,
      place_id,
      source,
      source_id,
      source_url,
      license,
      attribution,
      data,
      match_confidence,
      match_method,
      retrieved_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 1, 'reviewed_new_import', NOW())
    ON CONFLICT (entity_type, source, source_id) DO UPDATE SET
      place_id = EXCLUDED.place_id,
      source_url = EXCLUDED.source_url,
      license = EXCLUDED.license,
      attribution = EXCLUDED.attribution,
      data = EXCLUDED.data,
      match_confidence = EXCLUDED.match_confidence,
      match_method = EXCLUDED.match_method,
      retrieved_at = EXCLUDED.retrieved_at,
      updated_at = NOW()
  `, [
    row.entity_type,
    place.id,
    row.source,
    row.source_id,
    row.source_url,
    metadata.license,
    metadata.attribution,
    JSON.stringify(reviewedNewSourceData(row, place.id, payload)),
  ])

  await client.query(`
    UPDATE source_review_queue
    SET
      status = 'linked',
      decision = 'imported_new',
      canonical_place_id = $2,
      updated_at = NOW()
    WHERE id = $1
      AND status = 'accepted'
    RETURNING id
  `, [row.id, place.id])

  return {
    review_id: row.id,
    place_id: place.id,
    source_name: row.source_name,
    google_place_id: place.google_place_id,
    replacement_of_place_id: historicalPlace?.id || null,
  }
}

async function applyReviewedNewImports(client, { entity, source, reportFile, state, reviewIds = [], limit, nearbyRadiusM }) {
  const tableName = SOURCE_REVIEW_ENTITY_TABLES[entity]
  if (!tableName) {
    const error = new Error('Unsupported source review entity type.')
    error.status = 400
    throw error
  }
  if (!(await placeSourcesExists(client))) {
    const error = new Error('place_sources is not configured; cannot import reviewed-new source rows.')
    error.status = 503
    throw error
  }

  const preflight = await buildReviewedNewImportPreflight(client, {
    entity,
    source,
    reportFile,
    state,
    reviewIds,
    limit,
    nearbyRadiusM,
    candidateSampleLimit: limit,
  })
  const readyIds = preflight.candidates
    .filter(candidate => ['candidate_ready', 'replacement_candidate_ready'].includes(candidate.readiness))
    .map(candidate => candidate.review_id)

  if (!readyIds.length) {
    return {
      preflight,
      imported: [],
      skipped: preflight.rowsInspected,
      skippedReasons: [{ reason: 'no_candidate_ready_rows', rows: preflight.rowsInspected }],
    }
  }

  const rowsResult = await client.query(`
    SELECT
      id,
      entity_type,
      source,
      source_id,
      source_name,
      source_url,
      source_data,
      reviewer_notes,
      reviewed_by,
      report_file
    FROM source_review_queue
    WHERE id = ANY($1::bigint[])
      AND entity_type = $2
      AND review_kind = 'likely_new'
      AND status = 'accepted'
    ORDER BY reviewed_at NULLS LAST, source_name NULLS LAST, id
  `, [readyIds, entity])

  const imported = []
  const skippedReasons = []
  const acceptedBatchCandidates = []
  const countSkip = reason => {
    const existing = skippedReasons.find(row => row.reason === reason)
    if (existing) existing.rows += 1
    else skippedReasons.push({ reason, rows: 1 })
  }

  await client.query('BEGIN')
  try {
    for (const row of rowsResult.rows) {
      const payload = sourceReviewCandidatePayload(row)
      const coordinates = { proposed_lat: payload.lat, proposed_lng: payload.lng }
      const sameSourceCandidate = acceptedBatchCandidates
        .filter(candidate => candidate.source === row.source)
        .map(candidate => ({
          candidate,
          distanceM: sourceCandidateDistanceMeters(coordinates, candidate.coordinates),
        }))
        .filter(item => item.distanceM !== null && item.distanceM <= 25)
        .sort((a, b) => a.distanceM - b.distanceM)[0]
      if (sameSourceCandidate) {
        countSkip('duplicate_accepted_source_coordinate')
        continue
      }
      acceptedBatchCandidates.push({ source: row.source, coordinates })
      const duplicateBySourceId = await sourceReviewGooglePlaceIdExists(client, tableName, payload.googlePlaceId)
      const nearbyRows = await findNearbySourceReviewPlaces(client, tableName, payload, nearbyRadiusM)
      const readiness = reviewedNewImportReadiness(payload, duplicateBySourceId, nearbyRows)
      if (!['candidate_ready', 'replacement_candidate_ready'].includes(readiness)) {
        countSkip(readiness)
        continue
      }
      imported.push(await importReviewedNewCandidate(client, tableName, row))
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }

  return {
    preflight,
    imported,
    skipped: preflight.rowsInspected - imported.length,
    skippedReasons,
  }
}

function reviewedSourceData(row, canonicalPlaceId, reviewerNotes) {
  return {
    ...(row.source_data || {}),
    review: {
      queue_id: row.id,
      review_kind: row.review_kind,
      decision: 'linked',
      reviewed_by: 'admin',
      reviewer_notes: reviewerNotes || null,
      linked_place_id: canonicalPlaceId,
      nearest_place_id: row.nearest_place_id,
      nearest_place_name: row.nearest_place_name,
      nearest_distance_m: row.nearest_distance_m == null ? null : Number(row.nearest_distance_m),
      nearest_name_score: row.nearest_name_score == null ? null : Number(row.nearest_name_score),
      review_reason: row.review_reason || null,
    },
  }
}

async function upsertReviewedPlaceSource(client, row, canonicalPlaceId, reviewerNotes) {
  if (!(await placeSourcesExists(client))) {
    const error = new Error('place_sources is not configured; cannot link reviewed source evidence.')
    error.status = 503
    throw error
  }

  const metadata = SOURCE_REVIEW_SOURCE_METADATA[row.source] || {
    license: 'source-specific',
    attribution: row.source,
  }

  await client.query(`
    INSERT INTO place_sources (
      entity_type,
      place_id,
      source,
      source_id,
      source_url,
      license,
      attribution,
      data,
      match_confidence,
      match_method,
      retrieved_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, NOW())
    ON CONFLICT (entity_type, source, source_id) DO UPDATE SET
      place_id = EXCLUDED.place_id,
      source_url = EXCLUDED.source_url,
      license = EXCLUDED.license,
      attribution = EXCLUDED.attribution,
      data = EXCLUDED.data,
      match_confidence = EXCLUDED.match_confidence,
      match_method = EXCLUDED.match_method,
      retrieved_at = EXCLUDED.retrieved_at,
      updated_at = NOW()
  `, [
    row.entity_type,
    canonicalPlaceId,
    row.source,
    row.source_id,
    row.source_url,
    metadata.license,
    metadata.attribution,
    JSON.stringify(reviewedSourceData(row, canonicalPlaceId, reviewerNotes)),
    1,
    'reviewed_link',
  ])
}

const sourceReviewText = value => String(value || '').trim()
const sourceReviewComparableText = value => sourceReviewText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ')

const sourceReviewPlaceSnapshot = place => ({
  id: place.id,
  name: place.name,
  lat: place.lat == null ? null : Number(place.lat),
  lng: place.lng == null ? null : Number(place.lng),
  address: place.address || null,
  state: place.state || null,
  status: place.status || null,
  lifecycle_status: place.lifecycle_status || null,
  lifecycle_replaced_by_id: place.lifecycle_replaced_by_id || null,
  website_url: place.website_url || null,
  phone: place.phone || null,
  address_source: place.address_source || null,
  style: place.style || null,
  price_range: place.price_range || null,
  style_confidence: place.style_confidence || null,
  enrichment_status: place.enrichment_status || null,
  last_enriched_at: place.last_enriched_at || null,
  scrape_method: place.scrape_method || null,
  scrape_notes: place.scrape_notes || null,
})

const sourceReviewCanUpdateExistingPlace = (row, place) => {
  const exactOsmIdentity = row.source === 'osm'
    && sourceReviewText(row.source_id)
    && sourceReviewText(row.source_id) === sourceReviewText(place.google_place_id)
  const sourceNameChanged = sourceReviewComparableText(canonicalSourceReviewName(row))
    && sourceReviewComparableText(canonicalSourceReviewName(row)) !== sourceReviewComparableText(place.name)
  const hasPersonalReview = place.status !== 'unvisited'
    || place.rating != null
    || Boolean(sourceReviewText(place.notes))
  const hasHistoricalLifecycle = Boolean(sourceReviewText(place.lifecycle_status))

  return Boolean(
    row.status === 'pending'
    && row.review_kind === 'ambiguous'
    && exactOsmIdentity
    && sourceNameChanged
    && !hasPersonalReview
    && !hasHistoricalLifecycle
  )
}

function refreshedSourceData(row, canonicalPlaceId, reviewerNotes, canonicalBefore) {
  return {
    ...(row.source_data || {}),
    review: {
      queue_id: row.id,
      review_kind: row.review_kind,
      decision: 'updated_existing',
      reviewed_by: 'admin',
      reviewer_notes: reviewerNotes || null,
      linked_place_id: canonicalPlaceId,
      identity_match: 'exact_osm_id',
      canonical_before: canonicalBefore,
    },
  }
}

async function upsertRefreshedPlaceSource(client, row, canonicalPlaceId, reviewerNotes, canonicalBefore) {
  if (!(await placeSourcesExists(client))) {
    const error = new Error('place_sources is not configured; cannot record this place update.')
    error.status = 503
    throw error
  }

  const metadata = SOURCE_REVIEW_SOURCE_METADATA[row.source] || {
    license: 'source-specific',
    attribution: row.source,
  }

  await client.query(`
    INSERT INTO place_sources (
      entity_type, place_id, source, source_id, source_url, license, attribution,
      data, match_confidence, match_method, retrieved_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 1, 'reviewed_identity_refresh', NOW())
    ON CONFLICT (entity_type, source, source_id) DO UPDATE SET
      place_id = EXCLUDED.place_id,
      source_url = EXCLUDED.source_url,
      license = EXCLUDED.license,
      attribution = EXCLUDED.attribution,
      data = EXCLUDED.data,
      match_confidence = EXCLUDED.match_confidence,
      match_method = EXCLUDED.match_method,
      retrieved_at = EXCLUDED.retrieved_at,
      updated_at = NOW()
  `, [
    row.entity_type,
    canonicalPlaceId,
    row.source,
    row.source_id,
    row.source_url,
    metadata.license,
    metadata.attribution,
    JSON.stringify(refreshedSourceData(row, canonicalPlaceId, reviewerNotes, canonicalBefore)),
  ])
}

const getStorageClient = () => {
  if (!serviceClient?.storage) {
    throw new Error('Supabase storage client unavailable')
  }
  return serviceClient.storage.from(REVIEW_PHOTO_BUCKET)
}

async function fetchPhotosForPlace(placeId) {
  if (!reviewPhotosTableAvailable) {
    return []
  }

  try {
    const storage = getStorageClient()
    const { data, error } = await serviceClient
      .from(REVIEW_PHOTO_TABLE)
      .select('id, place_id, storage_path, sort_order')
      .eq('place_id', placeId)
      .order('sort_order', { ascending: true })

    if (error) {
      throw error
    }

    return (data || []).map(photo => {
      const { data: publicData, error: publicError } = storage.getPublicUrl(photo.storage_path)
      if (publicError) {
        console.warn('[admin] Unable to resolve public URL for photo', photo.id, publicError)
      }
      return {
        id: photo.id,
        path: photo.storage_path,
        sortOrder: photo.sort_order,
        publicUrl: publicData?.publicUrl ?? null,
      }
    })
  } catch (error) {
    if (error?.code === 'PGRST205') {
      reviewPhotosTableAvailable = false
      return []
    }
    throw error
  }
}

async function insertReviewPhotoRows(placeId, paths) {
  const { count, error: countError } = await serviceClient
    .from(REVIEW_PHOTO_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('place_id', placeId)

  if (countError) {
    if (countError?.code === 'PGRST205') {
      reviewPhotosTableAvailable = false
      const error = new Error('Review photos table is not available. Create the table to enable uploads.')
      error.status = 503
      throw error
    }
    throw countError
  }

  const baseOrder = typeof count === 'number' ? count : 0
  if (baseOrder + paths.length > MAX_REVIEW_PHOTOS) {
    const error = new Error(`Review photo limit is ${MAX_REVIEW_PHOTOS} per place.`)
    error.status = 400
    throw error
  }

  const inserts = paths.map((path, index) => ({
    place_id: placeId,
    storage_path: path,
    sort_order: baseOrder + index + 1,
  }))

  const { error: insertError } = await serviceClient.from(REVIEW_PHOTO_TABLE).insert(inserts)
  if (insertError) {
    if (insertError?.code === 'PGRST205') {
      reviewPhotosTableAvailable = false
      const error = new Error('Review photos table is not available. Create the table to enable uploads.')
      error.status = 503
      throw error
    }
    throw insertError
  }
}

function isSafeStoragePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 512 &&
    !path.startsWith('/') &&
    !path.includes('..') &&
    /^[A-Za-z0-9/_-]+\.webp$/.test(path)
  )
}

app.post('/api/bug-report', async (req, res) => {
  const result = await handleBugReport({
    body: req.body,
    ip: getClientIp(req),
  })
  return res.status(result.status).json(result.body)
})

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_AUTH_CONFIGURED) {
    return res.status(503).json({ error: 'Admin authentication not configured' })
  }

  const { password } = req.body || {}
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  res.cookie(COOKIE_NAME, createAdminSessionValue(), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: DEFAULT_SESSION_TTL_MS,
  })
  return res.json({ authorized: true })
})

app.get('/api/admin/check', (req, res) => {
  const authorized = ADMIN_AUTH_CONFIGURED
    && validateAdminSessionValue(req.signedCookies?.[COOKIE_NAME]).ok
  if (!authorized) return res.status(401).json({ authorized: false })
  return res.json({ authorized: true })
})

app.post('/api/admin/submitPlace', requireAdminAuth, async (req, res) => {
  const {
    entity,
    name,
    address,
    city,
    url,
    style,
    price,
    status,
    review,
    rating,
    notes,
    lat,
    lng,
  } = req.body || {}

  if (!['pizza', 'taco'].includes(entity)) {
    return res.status(400).json({ error: 'Entity must be pizza or taco' })
  }
  if (!name || !address || typeof lat !== 'number' || typeof lng !== 'number' || !style) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const row = {
    name,
    address,
    city: city || null,
    url: url || null,
    price: price || null,
    status: status || 'unvisited',
    review: review || null,
    notes: notes || null,
    rating: typeof rating === 'number' ? rating : null,
    lat,
    lng,
  }

  if (entity === 'pizza') {
    row.style = style
  } else {
    row.type = style
  }

  const table = getPlaceTable(entity)

  try {
    const { data, error } = await serviceClient.from(table).insert(row).select('*').single()
    if (error) throw error
    return res.json({ data })
  } catch (error) {
    console.error('[admin] submit error', error)
    return res.status(500).json({ error: 'Failed to submit place' })
  }
})

app.get('/api/admin/reviews', requireAdminAuth, async (req, res) => {
  try {
    const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'
    const table = getPlaceTable(entity)
    const reviewFields = 'id, name, notes, rating, status, style, address, state, price, price_range, google_place_id'

    const { data: reviews, error } = await serviceClient
      .from(table)
      .select(reviewFields)
      .or('notes.not.is.null,rating.not.is.null')
      .order('name', { ascending: true })

    if (error) {
      throw error
    }

    const placeIds = (reviews || []).map(row => row.id).filter(Boolean)
    let photosByPlace = {}

    if (placeIds.length > 0 && reviewPhotosTableAvailable) {
      const storage = getStorageClient()
      const { data: photoRows, error: photosError } = await serviceClient
        .from(REVIEW_PHOTO_TABLE)
        .select('id, place_id, storage_path, sort_order')
        .in('place_id', placeIds)
        .order('sort_order', { ascending: true })

      if (photosError) {
        if (photosError?.code === 'PGRST205') {
          reviewPhotosTableAvailable = false
        } else {
          throw photosError
        }
      } else if (Array.isArray(photoRows)) {
        photosByPlace = photoRows.reduce((acc, photo) => {
          const { data: publicData, error: publicError } = storage.getPublicUrl(photo.storage_path)
          if (publicError) {
            console.warn('[admin] Unable to resolve public URL for photo', photo.id, publicError)
          }
          const mapped = {
            id: photo.id,
            path: photo.storage_path,
            sortOrder: photo.sort_order,
            publicUrl: publicData?.publicUrl ?? null,
          }
          if (!acc[photo.place_id]) {
            acc[photo.place_id] = [mapped]
          } else {
            acc[photo.place_id].push(mapped)
          }
          return acc
        }, {})
      }
    }

    const payload = (reviews || []).map(review => ({
      ...review,
      photos: photosByPlace[review.id] || [],
    }))

    return res.json({ data: payload })
  } catch (error) {
    console.error('[admin] reviews fetch error', error)
    return res.status(500).json({ error: 'Failed to load reviews.' })
  }
})

app.post('/api/admin/reviews/:id/photos', requireAdminAuth, async (req, res) => {
  try {
    const placeId = req.params.id
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter(Boolean) : []
    if (!placeId) {
      return res.status(400).json({ error: 'Missing review identifier.' })
    }
    if (paths.length === 0) {
      return res.status(400).json({ error: 'No photo paths provided.' })
    }
    if (!reviewPhotosTableAvailable) {
      return res.status(503).json({ error: 'Review photos table is not configured yet.' })
    }

    await insertReviewPhotoRows(placeId, paths)

    const photos = await fetchPhotosForPlace(placeId)
    return res.json({ data: photos })
  } catch (error) {
    console.error('[admin] create review photo error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to save review photo.' })
  }
})

app.post('/api/admin/reviews/:id/photos/upload', requireAdminAuth, async (req, res) => {
  const placeId = req.params.id
  const files = Array.isArray(req.body?.files) ? req.body.files : []
  const uploadedPaths = []

  try {
    if (!placeId) {
      return res.status(400).json({ error: 'Missing review identifier.' })
    }
    if (files.length === 0) {
      return res.status(400).json({ error: 'No photos provided.' })
    }
    if (!reviewPhotosTableAvailable) {
      return res.status(503).json({ error: 'Review photos table is not configured yet.' })
    }

    const storage = getStorageClient()
    for (const file of files) {
      const storagePath = file?.path
      const encoded = file?.dataBase64
      const mimeType = file?.mimeType || 'image/webp'
      if (!isSafeStoragePath(storagePath)) {
        return res.status(400).json({ error: 'Invalid photo storage path.' })
      }
      if (mimeType !== 'image/webp') {
        return res.status(400).json({ error: 'Review photos must be uploaded as WebP.' })
      }
      if (typeof encoded !== 'string' || encoded.length === 0) {
        return res.status(400).json({ error: 'Photo data is missing.' })
      }

      const buffer = Buffer.from(encoded, 'base64')
      if (buffer.length === 0 || buffer.length > MAX_REVIEW_PHOTO_BYTES) {
        return res.status(413).json({ error: 'Photo is too large after processing.' })
      }

      const { error: uploadError } = await storage.upload(storagePath, buffer, {
        cacheControl: '3600',
        contentType: mimeType,
        upsert: false,
      })
      if (uploadError) {
        throw uploadError
      }
      uploadedPaths.push(storagePath)
    }

    await insertReviewPhotoRows(placeId, uploadedPaths)
    const photos = await fetchPhotosForPlace(placeId)
    return res.json({ data: photos })
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        await getStorageClient().remove(uploadedPaths)
      } catch (cleanupError) {
        console.warn('[admin] failed to clean up uploaded review photos', cleanupError)
      }
    }
    console.error('[admin] upload review photo error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to upload review photo.' })
  }
})

app.patch('/api/admin/reviews/:id/photos/reorder', requireAdminAuth, async (req, res) => {
  try {
    const placeId = req.params.id
    const order = Array.isArray(req.body?.order) ? req.body.order : []
    if (!placeId) {
      return res.status(400).json({ error: 'Missing review identifier.' })
    }
    if (order.length === 0) {
      return res.status(400).json({ error: 'Photo order payload is empty.' })
    }
    if (!reviewPhotosTableAvailable) {
      return res.status(503).json({ error: 'Review photos table is not configured yet.' })
    }

    const updates = order.map((photoId, index) =>
      serviceClient
        .from(REVIEW_PHOTO_TABLE)
        .update({ sort_order: index + 1 })
        .eq('id', photoId)
        .eq('place_id', placeId)
    )

    const results = await Promise.all(updates)
    const failed = results.find(result => result?.error)
    if (failed?.error) {
      if (failed.error?.code === 'PGRST205') {
        reviewPhotosTableAvailable = false
        return res.status(503).json({ error: 'Review photos table is not available. Create the table to enable uploads.' })
      }
      throw failed.error
    }

    const photos = await fetchPhotosForPlace(placeId)
    return res.json({ data: photos })
  } catch (error) {
    console.error('[admin] reorder review photos error', error)
    return res.status(500).json({ error: 'Failed to update photo order.' })
  }
})

app.delete('/api/admin/review-photos/:photoId', requireAdminAuth, async (req, res) => {
  const photoId = req.params.photoId
  if (!photoId) {
    return res.status(400).json({ error: 'Photo id required' })
  }
  if (!reviewPhotosTableAvailable) {
    return res.status(503).json({ error: 'Review photos table is not configured yet.' })
  }

  try {
    const { data: photo, error } = await serviceClient
      .from(REVIEW_PHOTO_TABLE)
      .select('id, place_id, storage_path')
      .eq('id', photoId)
      .single()

    if (error) {
      const notFound =
        error?.code === 'PGRST116' ||
        error?.message?.toLowerCase().includes('no rows') ||
        error?.message?.toLowerCase().includes('not found')
      if (error?.code === 'PGRST205') {
        reviewPhotosTableAvailable = false
        return res.status(503).json({ error: 'Review photos table is not available. Create the table to enable uploads.' })
      }
      if (notFound) {
        return res.status(404).json({ error: 'Photo not found' })
      }
      throw error
    }

    const storage = getStorageClient()
    const { error: storageError } = await storage.remove([photo.storage_path])
    if (storageError && storageError?.message !== 'not found') {
      console.warn('[admin] failed to remove storage object', photo.storage_path, storageError)
    }

    const { error: deleteError } = await serviceClient.from(REVIEW_PHOTO_TABLE).delete().eq('id', photoId)
    if (deleteError) {
      throw deleteError
    }

    const photos = await fetchPhotosForPlace(photo.place_id)
    return res.json({ data: photos })
  } catch (error) {
    console.error('[admin] delete review photo error', error)
    return res.status(500).json({ error: 'Failed to delete review photo.' })
  }
})

app.get('/api/admin/source-provenance', requireAdminAuth, async (req, res) => {
  const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'

  try {
    const [database, reviewArtifacts, reviewQueueCsv, fsqSample] = await Promise.all([
      readLocalSourceProvenance(entity),
      Promise.resolve(readSourceReviewReports(entity)),
      Promise.resolve(readSourceReviewQueueCsv()),
      Promise.resolve(readFsqSampleReadiness(entity)),
    ])

    return res.json({
      data: {
        entity,
        generatedAt: new Date().toISOString(),
        localOnly: true,
        syncPolicy: 'Source evidence stays local until a public/admin provenance feature requires a Supabase table.',
        database,
        reviewArtifacts,
        reviewQueueCsv,
        fsqSample,
      },
    })
  } catch (error) {
    console.error('[admin] source provenance error', error)
    return res.status(500).json({ error: 'Failed to load source provenance.' })
  }
})

app.get('/api/admin/source-review-summary', requireAdminAuth, async (req, res) => {
  const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'
  const reviewRegions = sourceReviewRegions(entity, req.query?.state)

  try {
    const payload = await withLocalPostgres(async client => {
      const tableCheck = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('place_sources', 'source_review_queue')
      `)
      const tables = new Set(tableCheck.rows.map(row => row.table_name))
      const placeTable = getPlaceTable(entity)
      const placeColumnResult = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [placeTable])
      const placeColumns = new Set(placeColumnResult.rows.map(row => row.column_name))
      const coverageExpression = field => placeColumns.has(field)
        ? `COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(${field}::text, '')), '') IS NULL)::int AS missing_${field}`
        : `0::int AS missing_${field}`
      const missingCoverageCondition = ['address', 'website_url', 'phone', 'style', 'price_range']
        .filter(field => placeColumns.has(field))
        .map(field => `NULLIF(BTRIM(COALESCE(${field}::text, '')), '') IS NULL`)
        .join(' OR ') || 'FALSE'
      const coverageStateExpression = placeColumns.has('state') ? 'state' : "''"
      const coverageRegions = configuredCoverageRegions(entity)
      const coverageRegionPredicate = placeColumns.has('state')
        ? `UPPER(COALESCE(${coverageStateExpression}, '')) = ANY($1::text[])`
        : 'FALSE'
      const activeLifecyclePredicate = alias => placeColumns.has('lifecycle_status')
        ? `COALESCE(${alias ? `${alias}.` : ''}lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')`
        : 'TRUE'
      const coverageResult = await client.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE ${missingCoverageCondition})::int AS needs_attention,
          ${coverageExpression('address')},
          ${coverageExpression('website_url')},
          ${coverageExpression('phone')},
          ${coverageExpression('style')},
          ${coverageExpression('price_range')}
        FROM ${placeTable}
        WHERE ${coverageRegionPredicate}
          AND lower(COALESCE(status, '')) NOT LIKE 'closed%'
          AND ${activeLifecyclePredicate()}
      `, [coverageRegions])
      const coverageByStateResult = await client.query(`
        SELECT
          ${coverageStateExpression} AS state,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE ${missingCoverageCondition})::int AS needs_attention,
          ${coverageExpression('address')},
          ${coverageExpression('website_url')},
          ${coverageExpression('phone')},
          ${coverageExpression('style')},
          ${coverageExpression('price_range')}
        FROM ${placeTable}
        WHERE ${coverageRegionPredicate}
          AND lower(COALESCE(status, '')) NOT LIKE 'closed%'
          AND ${activeLifecyclePredicate()}
        GROUP BY ${coverageStateExpression}
        ORDER BY ${coverageStateExpression}
      `, [coverageRegions])
      if (!tables.has('source_review_queue')) {
        return {
          available: false,
          reason: 'Source review queue is not configured.',
          entity,
          generatedAt: new Date().toISOString(),
          queues: {
            matchExisting: 0,
            checkDuplicates: 0,
            approveNew: 0,
            incomplete: 0,
            approvedForImport: 0,
            lifecycle: 0,
          },
          lifecycle: { replacements: 0, staleEvidence: 0, stalePlaces: 0, closedSignals: 0 },
          sourceQuality: { acceptedCoordinateConflicts: 0 },
          sourceRows: 0,
          linkedPlaces: 0,
          latestSourceUpdate: null,
          basicFieldCoverage: buildBasicFieldCoverage(coverageResult.rows[0], coverageByStateResult.rows, coverageRegions),
        }
      }

      const queueRegionFilter = reviewRegions ? `AND ${sourceReviewRegionSql('srq', 'review_place', 2)}` : ''
      const queueQueryValues = reviewRegions ? [entity, reviewRegions] : [entity]
      const queueResult = await client.query(`
        SELECT
          srq.review_kind,
          srq.status,
          ${sourceReviewReadinessSqlForAlias} AS readiness,
          COUNT(*)::int AS rows
        FROM source_review_queue srq
        LEFT JOIN ${getPlaceTable(entity)} review_place ON review_place.id = srq.nearest_place_id
        WHERE srq.entity_type = $1
          ${queueRegionFilter}
        GROUP BY srq.review_kind, srq.status, readiness
      `, queueQueryValues)
      const sourceResult = tables.has('place_sources')
        ? await client.query(`
            SELECT
              COUNT(*)::int AS source_rows,
              COUNT(DISTINCT place_id)::int AS linked_places,
              MAX(updated_at) AS latest_source_update
            FROM place_sources
            WHERE entity_type = $1
          `, [entity])
        : { rows: [{ source_rows: 0, linked_places: 0, latest_source_update: null }] }
      const lifecycleRegionFilter = reviewRegions ? `AND ${sourceReviewRegionSql('srq', 'p', 2)}` : ''
      const lifecycleQueryValues = reviewRegions ? [entity, reviewRegions] : [entity]
      const lifecycleResult = await client.query(`
          SELECT COUNT(*) FILTER (
            WHERE srq.source_id = p.google_place_id
              AND lower(regexp_replace(coalesce(srq.source_name, ''), '[^a-z0-9]+', ' ', 'g'))
                <> lower(regexp_replace(coalesce(p.name, ''), '[^a-z0-9]+', ' ', 'g'))
          )::int AS replacements,
          ${tables.has('place_sources') ? `(
            SELECT COUNT(*)::int
            FROM (
              SELECT DISTINCT ON (ps.place_id, ps.source)
                     ps.place_id, ps.source, ps.retrieved_at
              FROM place_sources ps
              WHERE ps.entity_type = $1
              ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
            ) latest_source
            JOIN ${getPlaceTable(entity)} stale_place ON stale_place.id = latest_source.place_id
            WHERE latest_source.retrieved_at < NOW() - make_interval(days => CASE latest_source.source
                WHEN 'osm' THEN 30
                WHEN 'official_website' THEN 30
                WHEN 'all_the_places' THEN 90
                WHEN 'fsq_os_places' THEN 180
                WHEN 'overture_places' THEN 365
                WHEN 'wikidata' THEN 365
                ELSE 180 END)
              AND lower(coalesce(stale_place.status, '')) NOT LIKE 'closed%'
              AND ${activeLifecyclePredicate('stale_place')}
          )` : '0'}::int AS stale_evidence,
          ${tables.has('place_sources') ? `(
            SELECT COUNT(DISTINCT stale_place.id)::int
            FROM (
              SELECT DISTINCT ON (ps.place_id, ps.source)
                     ps.place_id, ps.source, ps.retrieved_at
              FROM place_sources ps
              WHERE ps.entity_type = $1
              ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
            ) latest_source
            JOIN ${getPlaceTable(entity)} stale_place ON stale_place.id = latest_source.place_id
            WHERE latest_source.retrieved_at < NOW() - make_interval(days => CASE latest_source.source
                WHEN 'osm' THEN 30
                WHEN 'official_website' THEN 30
                WHEN 'all_the_places' THEN 90
                WHEN 'fsq_os_places' THEN 180
                WHEN 'overture_places' THEN 365
                WHEN 'wikidata' THEN 365
                ELSE 180 END)
              AND lower(coalesce(stale_place.status, '')) NOT LIKE 'closed%'
              AND ${activeLifecyclePredicate('stale_place')}
          )` : '0'}::int AS stale_places
          , ${tables.has('place_sources') ? `(
            SELECT COUNT(*)::int
            FROM (
              SELECT DISTINCT ON (ps.place_id, ps.source)
                     ps.place_id, ps.source, ps.retrieved_at, ps.data
              FROM place_sources ps
              WHERE ps.entity_type = $1
              ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
            ) latest_closed_source
            JOIN ${getPlaceTable(entity)} closed_place ON closed_place.id = latest_closed_source.place_id
            WHERE lower(coalesce(closed_place.status, '')) NOT LIKE 'closed%'
              AND ${activeLifecyclePredicate('closed_place')}
              AND latest_closed_source.data->>'is_closed' = 'true'
          )` : '0'}::int AS closed_signals
          FROM source_review_queue srq
          JOIN ${getPlaceTable(entity)} p ON p.id = srq.nearest_place_id
          WHERE srq.entity_type = $1
            AND srq.status = 'pending'
            AND srq.review_kind = 'ambiguous'
            AND srq.source = 'osm'
            ${lifecycleRegionFilter}
      `, lifecycleQueryValues)

      const countQueue = (reviewKind, status, readiness = null) => queueResult.rows
        .filter(row =>
          row.review_kind === reviewKind
          && row.status === status
          && (readiness == null || row.readiness === readiness)
        )
        .reduce((sum, row) => sum + normalizeCount(row.rows), 0)
      const sourceTotals = sourceResult.rows[0] || {}
      const lifecycleTotals = lifecycleResult.rows[0] || {}
      const lifecycle = {
        replacements: normalizeCount(lifecycleTotals.replacements),
        staleEvidence: tables.has('place_sources') ? normalizeCount(lifecycleTotals.stale_evidence) : 0,
        stalePlaces: tables.has('place_sources') ? normalizeCount(lifecycleTotals.stale_places) : 0,
        closedSignals: tables.has('place_sources') ? normalizeCount(lifecycleTotals.closed_signals) : 0,
      }
      const sourceQualityResult = tables.has('source_review_queue') ? await client.query(`
        WITH accepted AS (
          SELECT id, source, source_name,
                 COALESCE(NULLIF(source_data->>'lat', ''), NULLIF(source_data->>'latitude', ''))::double precision AS lat,
                 COALESCE(NULLIF(source_data->>'lng', ''), NULLIF(source_data->>'lon', ''), NULLIF(source_data->>'longitude', ''))::double precision AS lng
          FROM source_review_queue
          WHERE entity_type = $1
            AND review_kind = 'likely_new'
            AND status = 'accepted'
            AND COALESCE(NULLIF(source_data->>'lat', ''), NULLIF(source_data->>'latitude', '')) IS NOT NULL
            AND COALESCE(NULLIF(source_data->>'lng', ''), NULLIF(source_data->>'lon', ''), NULLIF(source_data->>'longitude', '')) IS NOT NULL
        ), pairs AS (
          SELECT a.id, b.id
          FROM accepted a
          JOIN accepted b ON a.source = b.source AND a.id < b.id
          WHERE abs(a.lat - b.lat) <= 0.003
            AND abs(a.lng - b.lng) <= 0.003
            AND (111320 * sqrt(
              power(a.lat - b.lat, 2)
              + power((a.lng - b.lng) * cos(radians(a.lat)), 2)
            )) <= 150
            AND lower(regexp_replace(coalesce(a.source_name, ''), '[^a-z0-9]+', '', 'g'))
              <> lower(regexp_replace(coalesce(b.source_name, ''), '[^a-z0-9]+', '', 'g'))
        )
        SELECT COUNT(*)::int AS conflicts FROM pairs
      `, [entity]) : { rows: [{ conflicts: 0 }] }
      const sourceQuality = {
        acceptedCoordinateConflicts: normalizeCount(sourceQualityResult.rows[0]?.conflicts),
      }

      return {
        available: true,
        entity,
        generatedAt: new Date().toISOString(),
        queues: {
          matchExisting: countQueue('ambiguous', 'pending', 'link_review'),
          checkDuplicates: countQueue('likely_new', 'pending', 'nearby_canonical_review'),
          approveNew: countQueue('likely_new', 'pending', 'candidate_ready'),
          incomplete: countQueue('likely_new', 'pending', 'missing_required_data'),
          approvedForImport: countQueue('likely_new', 'accepted'),
          lifecycle: lifecycle.replacements,
        },
        lifecycle,
        sourceQuality,
        sourceRows: normalizeCount(sourceTotals.source_rows),
        linkedPlaces: normalizeCount(sourceTotals.linked_places),
        latestSourceUpdate: sourceTotals.latest_source_update || null,
        basicFieldCoverage: buildBasicFieldCoverage(coverageResult.rows[0], coverageByStateResult.rows, coverageRegions),
        reviewScope: reviewRegions ? { regions: reviewRegions } : { regions: 'all' },
      }
    })

    return res.json({ data: payload })
  } catch (error) {
    console.error('[admin] source review summary error', error)
    return res.status(503).json({
      error: error?.message || 'Failed to load source review summary.',
      data: {
        available: false,
        entity,
        generatedAt: new Date().toISOString(),
        queues: {
          matchExisting: 0,
          checkDuplicates: 0,
          approveNew: 0,
          incomplete: 0,
          approvedForImport: 0,
          lifecycle: 0,
        },
        lifecycle: { replacements: 0, staleEvidence: 0, stalePlaces: 0, closedSignals: 0 },
        sourceQuality: { acceptedCoordinateConflicts: 0 },
        sourceRows: 0,
        linkedPlaces: 0,
        latestSourceUpdate: null,
        basicFieldCoverage: buildBasicFieldCoverage(),
      },
    })
  }
})

app.get('/api/admin/supabase-sync-readiness', requireAdminAuth, async (req, res) => {
  const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'
  if (entity === 'taco') {
    return res.json({
      data: {
        available: true,
        state: 'not_configured',
        label: 'Not configured for tacos',
        detail: 'The current guarded publisher is configured for pizza_places only.',
        generatedAt: new Date().toISOString(),
      },
    })
  }

  try {
    const script = resolve(__dirname, '..', 'scripts/ops/supabase-sync-status-report.mjs')
    const { stdout } = await execFileAsync(process.execPath, [script, '--json', '--hours', '24', '--batch', '50', '--sample', '1'], {
      cwd: resolve(__dirname, '..'),
      env: process.env,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const report = JSON.parse(stdout)
    const bulkRpc = report.bulkRpc || {}
    const pending = Number(report.summary?.pending_after_checkpoint) || 0
    const wouldUpdate = Number(report.nextBatch?.wouldUpdate) || 0
    const protectedFieldConflicts = Number(report.nextBatch?.protectedFieldConflicts) || 0
    const hasPendingChanges = Boolean(pending || wouldUpdate)
    const publishingReady = bulkRpc.state === 'ready'
    const state = hasPendingChanges
      ? (publishingReady ? 'ready' : 'blocked')
      : 'nothing_waiting'
    const detail = state === 'ready'
      ? `${pending || wouldUpdate} local change${(pending || wouldUpdate) === 1 ? '' : 's'} eligible for the guarded publisher.`
      : state === 'nothing_waiting'
        ? publishingReady
          ? 'Local and public data are caught up for the current checkpoint.'
          : 'No local changes are waiting today. Future publishing still needs the Supabase migration.'
        : bulkRpc.detail || 'Apply and verify the production Supabase migration before enabling bulk sync.'

    return res.json({
      data: {
        available: true,
        state,
        label: state === 'ready' ? 'Ready to publish'
          : state === 'nothing_waiting' ? 'Nothing waiting'
            : 'Blocked by Supabase setup',
        detail,
        pendingAfterCheckpoint: pending,
        wouldUpdate,
        protectedFieldConflicts,
        bulkRpcState: bulkRpc.state || 'unknown',
        publishingReady,
        lastRun: report.lastRun || null,
        generatedAt: report.generatedAt || new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('[admin] Supabase sync readiness error', error)
    return res.json({
      data: {
        available: false,
        state: 'unavailable',
        label: 'Sync status unavailable',
        detail: 'The read-only sync check could not complete. No sync was started.',
        generatedAt: new Date().toISOString(),
      },
    })
  }
})

app.get('/api/admin/pipeline-status', requireSignedAdminSession, (req, res) => {
  res.set('Cache-Control', 'no-store')
  const entity = String(req.query?.entity || '').trim().toLowerCase()
  if (!Object.hasOwn(PIPELINE_BOUNDARY.status.targets || {}, entity)) {
    return res.status(400).json({ error: 'Pipeline status entity must be pizza or taco' })
  }

  try {
    const selection = resolveStatusSelection(
      PIPELINE_BOUNDARY,
      entity,
      process.env,
      resolve(__dirname, '..'),
    )
    if (!selection.enabled) {
      return res.json({
        data: {
          available: false,
          entity,
          state: 'disabled',
          label: 'Pipeline status disabled',
          detail: selection.reason === 'external_apply_disabled'
            ? 'External apply remains disabled; an apply-lane status cannot be authoritative.'
            : selection.reason === 'pipeline_lane_unregistered'
              ? 'This pipeline lane has not been registered with the application.'
            : `Pipeline status has not been enabled for ${entity}.`,
          checkedAt: null,
        },
      })
    }

    const targetConfig = PIPELINE_BOUNDARY.status.targets[entity]
    const contractBytes = readFileSync(resolve(__dirname, '..', targetConfig.contract.file))
    const contract = JSON.parse(contractBytes.toString('utf8'))
    if (
      contract.name !== targetConfig.contract.name
      || contract.version !== targetConfig.contract.version
      || contract.profile !== targetConfig.profile
      || contract.entity !== entity
    ) {
      throw new Error('Selected pipeline target contract does not match the app registry')
    }
    const targetContract = {
      name: contract.name,
      version: contract.version,
      digest: `sha256:${createHash('sha256').update(contractBytes).digest('hex')}`,
    }
    const snapshot = readPipelineStatusSnapshot(selection.path, {
      maxBytes: PIPELINE_BOUNDARY.status.maxBytes,
    })
    if (snapshot.state === 'missing') {
      return res.json({
        data: {
          available: false,
          entity,
          state: 'missing',
          label: 'No recent pipeline check',
          detail: `The selected ${selection.lane} lane has not published a ${entity} status snapshot.`,
          checkedAt: null,
        },
      })
    }

    let document
    try {
      document = JSON.parse(snapshot.text)
    } catch {
      throw new Error('Pipeline status snapshot is not valid JSON')
    }
    const configuredMaxAge = Number.parseInt(process.env.PIPELINE_STATUS_MAX_AGE_MINUTES || '', 10)
    const result = presentPipelineStatus(
      document,
      { ...selection, targetContract },
      {
        maxAgeMinutes: Number.isInteger(configuredMaxAge) && configuredMaxAge > 0
          ? configuredMaxAge
          : PIPELINE_BOUNDARY.status.maxAgeMinutes,
        futureToleranceMinutes: PIPELINE_BOUNDARY.status.futureToleranceMinutes,
      },
    )
    if (!result.ok) console.warn('[admin] Pipeline status contract rejected:', result.errors.join('; '))
    return res.json({ data: result.data })
  } catch (error) {
    console.error('[admin] Pipeline status error', error?.message || error)
    return res.json({
      data: {
        available: false,
        entity,
        state: 'invalid',
        label: 'Pipeline status unavailable',
        detail: 'The latest pipeline snapshot could not be safely read. No pipeline work was started.',
        checkedAt: null,
      },
    })
  }
})

app.get('/api/admin/source-review-queue/import-preflight', requireAdminAuth, async (req, res) => {
  const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'
  const source = (req.query?.source || '').toString().trim().slice(0, 80)
  const reportFile = (req.query?.reportFile || '').toString().trim().slice(0, 160)
  const state = (req.query?.state || '').toString().trim().slice(0, 16)
  const reviewIds = parseReviewIdList(req.query?.ids).slice(0, 100)
  const limit = safeInteger(req.query?.limit, 100, { min: 1, max: 250 })
  const nearbyRadiusM = Number.parseFloat(req.query?.nearbyRadiusM || '150')

  if (!Number.isFinite(nearbyRadiusM) || nearbyRadiusM <= 0 || nearbyRadiusM > 1000) {
    return res.status(400).json({ error: 'Invalid nearby duplicate radius.' })
  }

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }
      return buildReviewedNewImportPreflight(client, {
        entity,
        source,
        reportFile,
        state,
        reviewIds,
        limit,
        nearbyRadiusM,
      })
    })

    return res.json({ data: payload })
  } catch (error) {
    console.error('[admin] source review import preflight error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to load reviewed-new import preflight.' })
  }
})

app.post('/api/admin/source-review-queue/import-reviewed-new', requireAdminAuth, async (req, res) => {
  const entity = req.body?.entity === 'taco' ? 'taco' : 'pizza'
  const source = (req.body?.source || '').toString().trim().slice(0, 80)
  const reportFile = (req.body?.reportFile || '').toString().trim().slice(0, 160)
  const state = (req.body?.state || '').toString().trim().slice(0, 16)
  const reviewIds = parseReviewIdList(req.body?.ids).slice(0, 100)
  const limit = safeInteger(req.body?.limit, 25, { min: 1, max: 100 })
  const nearbyRadiusM = Number.parseFloat(req.body?.nearbyRadiusM || '150')
  const confirmed = req.body?.confirmed === true

  if (!confirmed) {
    return res.status(400).json({ error: 'Import requires explicit confirmation.' })
  }
  if (!Number.isFinite(nearbyRadiusM) || nearbyRadiusM <= 0 || nearbyRadiusM > 1000) {
    return res.status(400).json({ error: 'Invalid nearby duplicate radius.' })
  }

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }

      return applyReviewedNewImports(client, {
        entity,
        source,
        reportFile,
        state,
        reviewIds,
        limit,
        nearbyRadiusM,
      })
    })

    return res.json({ data: payload })
  } catch (error) {
    console.error('[admin] source review import reviewed-new error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to import reviewed-new source rows.' })
  }
})

app.get('/api/admin/source-review-queue', requireAdminAuth, async (req, res) => {
  const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'
  const status = (req.query?.status || 'pending').toString()
  const kind = (req.query?.kind || '').toString()
  const source = (req.query?.source || '').toString().trim().slice(0, 80)
  const reportFile = (req.query?.reportFile || '').toString().trim().slice(0, 160)
  const readiness = (req.query?.readiness || '').toString().trim().slice(0, 80)
  const scope = (req.query?.scope || '').toString().trim().slice(0, 20)
  const state = (req.query?.state || '').toString().trim().slice(0, 40)
  const search = (req.query?.search || '').toString().trim().slice(0, 120)
  const focus = (req.query?.focus || 'weekly').toString().trim().toLowerCase()
  const reviewRegions = sourceReviewRegions(entity, state)
  const limit = safeInteger(req.query?.limit, 50, { min: 1, max: 100 })
  const offset = safeInteger(req.query?.offset, 0, { min: 0, max: 1000000 })

  if (!['weekly', 'all'].includes(focus)) {
    return res.status(400).json({ error: 'Invalid source review focus.' })
  }

  if (!allowedSourceReviewStatuses.has(status)) {
    return res.status(400).json({ error: 'Invalid source review status.' })
  }
  if (kind && !allowedSourceReviewKinds.has(kind)) {
    return res.status(400).json({ error: 'Invalid source review kind.' })
  }
  if (readiness && !allowedSourceReviewReadiness.has(readiness)) {
    return res.status(400).json({ error: 'Invalid source review readiness.' })
  }
  if (scope && !allowedSourceReviewScopes.has(scope)) {
    return res.status(400).json({ error: 'Invalid source review scope.' })
  }

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        return { available: false, data: [], total: 0 }
      }
      const tableName = SOURCE_REVIEW_ENTITY_TABLES[entity] || SOURCE_REVIEW_ENTITY_TABLES.pizza

      const filters = ['srq.entity_type = $1', 'srq.status = $2']
      const values = [entity, status]
      if (kind) {
        values.push(kind)
        filters.push(`srq.review_kind = $${values.length}`)
      }
      if (source) {
        values.push(source)
        filters.push(`srq.source = $${values.length}`)
      }
      if (reportFile) {
        values.push(reportFile)
        filters.push(`srq.report_file = $${values.length}`)
      }
      if (readiness) {
        values.push(readiness)
        filters.push(`${sourceReviewReadinessSqlForAlias} = $${values.length}`)
      }
      if (scope === 'chain') {
        filters.push("srq.source = 'all_the_places'")
      } else if (scope === 'independent') {
        filters.push("srq.source IN ('osm', 'fsq_os_places', 'overture_places')")
      }
      if (reviewRegions) {
        values.push(reviewRegions)
        filters.push(`(
          UPPER(COALESCE(srq.source_data->>'region', srq.source_data->>'state', srq.source_data->>'country', '')) = ANY($${values.length}::text[])
          OR UPPER(COALESCE(nearest.state, '')) = ANY($${values.length}::text[])
          OR UPPER(COALESCE(decision_place.state, '')) = ANY($${values.length}::text[])
        )`)
      }
      if (search) {
        values.push(`%${search.toLowerCase()}%`)
        filters.push(`(
          lower(COALESCE(source_name, '')) LIKE $${values.length}
          OR lower(COALESCE(source_id, '')) LIKE $${values.length}
          OR lower(COALESCE(source_url, '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'address', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'addr:full', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'website', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'phone', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'locality', '')) LIKE $${values.length}
          OR lower(COALESCE(source_data->>'region', '')) LIKE $${values.length}
          OR lower(COALESCE(nearest_place_name, '')) LIKE $${values.length}
          OR lower(COALESCE(nearest_google_place_id, '')) LIKE $${values.length}
          OR lower(COALESCE(nearest.address, '')) LIKE $${values.length}
          OR lower(COALESCE(nearest.website_url, '')) LIKE $${values.length}
          OR lower(COALESCE(nearest.phone, '')) LIKE $${values.length}
          OR lower(COALESCE(decision_place.name, '')) LIKE $${values.length}
          OR lower(COALESCE(decision_place.address, '')) LIKE $${values.length}
          OR lower(COALESCE(decision_place.google_place_id, '')) LIKE $${values.length}
          OR lower(COALESCE(review_reason, '')) LIKE $${values.length}
          OR lower(COALESCE(report_file, '')) LIKE $${values.length}
        )`)
      }
      const where = filters.join(' AND ')
      const countResult = await client.query(`
        SELECT COUNT(*)::int AS total
        FROM source_review_queue srq
        LEFT JOIN ${tableName} nearest ON nearest.id = srq.nearest_place_id
        LEFT JOIN ${tableName} decision_place ON decision_place.id = srq.canonical_place_id
        WHERE ${where}
      `, values)
      const fullTotal = countResult.rows[0]?.total || 0
      const total = focus === 'weekly' ? Math.min(fullTotal, 50) : fullTotal
      const remaining = Math.max(0, total - offset)
      const effectiveLimit = Math.min(limit, remaining)
      values.push(effectiveLimit, offset)
      const rows = await client.query(`
        SELECT
          srq.id,
          srq.entity_type,
          srq.review_kind,
          srq.source,
          srq.source_id,
          srq.source_name,
          srq.source_url,
          srq.source_data,
          srq.nearest_place_id,
          srq.nearest_google_place_id,
          srq.nearest_place_name,
          srq.nearest_distance_m,
          srq.nearest_name_score,
          nearest.address AS nearest_address,
          nearest.state AS nearest_state,
          nearest.google_place_id AS nearest_current_google_place_id,
          nearest.lat AS nearest_lat,
          nearest.lng AS nearest_lng,
            nearest.status AS nearest_status,
          nearest.lifecycle_status AS nearest_lifecycle_status,
          nearest.lifecycle_replaced_by_id AS nearest_lifecycle_replaced_by_id,
          nearest.rating AS nearest_rating,
          nearest.notes AS nearest_notes,
          nearest.website_url AS nearest_website_url,
          nearest.phone AS nearest_phone,
          decision_place.name AS decision_canonical_name,
          decision_place.address AS decision_canonical_address,
          decision_place.state AS decision_canonical_state,
          decision_place.google_place_id AS decision_canonical_google_place_id,
          decision_place.lat AS decision_canonical_lat,
          decision_place.lng AS decision_canonical_lng,
          decision_place.status AS decision_canonical_status,
          decision_place.website_url AS decision_canonical_website_url,
          decision_place.phone AS decision_canonical_phone,
          ${sourceReviewSignalCountSql}::int AS source_signal_count,
          ${sourceReviewEvidenceCountSql}::int AS review_evidence_count,
          ${sourceReviewReadinessSqlForAlias} AS review_readiness,
          srq.review_reason,
          srq.status,
          srq.decision,
          srq.canonical_place_id,
          srq.reviewer_notes,
          srq.reviewed_at,
          srq.reviewed_by,
          srq.report_file,
          srq.report_generated_at,
          srq.imported_at,
          srq.updated_at
        FROM source_review_queue srq
        LEFT JOIN ${tableName} nearest ON nearest.id = srq.nearest_place_id
        LEFT JOIN ${tableName} decision_place ON decision_place.id = srq.canonical_place_id
        WHERE ${where}
        ORDER BY
          CASE srq.review_kind WHEN 'ambiguous' THEN 0 ELSE 1 END,
          -- Put the easiest, highest-confidence identity checks first. This
          -- only changes review order; it never links or promotes a row.
          CASE WHEN srq.review_kind = 'ambiguous' THEN ${sourceReviewEvidenceCountSql} END DESC,
          CASE WHEN srq.review_kind = 'ambiguous' THEN srq.nearest_distance_m END ASC NULLS LAST,
          CASE
            WHEN srq.review_kind = 'likely_new' AND ${sourceReviewReadinessSqlForAlias} = 'candidate_ready' THEN 0
            WHEN srq.review_kind = 'likely_new' AND ${sourceReviewReadinessSqlForAlias} = 'nearby_canonical_review' THEN 1
            WHEN srq.review_kind = 'likely_new' AND ${sourceReviewReadinessSqlForAlias} = 'missing_required_data' THEN 2
            ELSE 3
          END,
          CASE WHEN srq.review_kind = 'likely_new' THEN ${sourceReviewSignalCountSql} END DESC,
          CASE WHEN srq.review_kind = 'likely_new' THEN srq.nearest_distance_m END DESC NULLS LAST,
          CASE WHEN srq.review_kind = 'ambiguous' THEN srq.nearest_distance_m END ASC NULLS LAST,
          srq.source_name NULLS LAST,
          srq.id
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `, values)

      return { available: true, data: rows.rows, total, focus }
    })

    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review queue fetch error', error)
    return res.status(500).json({ error: 'Failed to load source review queue.' })
  }
})

app.get('/api/admin/source-review-conflicts', requireAdminAuth, async (req, res) => {
  const entity = req.query?.entity === 'taco' ? 'taco' : 'pizza'
  const limit = safeInteger(req.query?.limit, 20, { min: 1, max: 50 })

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) return { available: false, data: [], total: 0 }
      const result = await client.query(`
        SELECT
          srq.id,
          srq.source,
          srq.source_id,
          srq.source_name,
          srq.source_url,
          peer.id AS conflict_id,
          peer.source_id AS conflict_source_id,
          peer.source_name AS conflict_source_name,
          peer.source_url AS conflict_source_url,
          ROUND((111320 * sqrt(
            power(COALESCE(NULLIF(peer.source_data->>'lat', ''), NULLIF(peer.source_data->>'latitude', ''))::double precision - COALESCE(NULLIF(srq.source_data->>'lat', ''), NULLIF(srq.source_data->>'latitude', ''))::double precision, 2)
            + power((COALESCE(NULLIF(peer.source_data->>'lng', ''), NULLIF(peer.source_data->>'lon', ''), NULLIF(peer.source_data->>'longitude', ''))::double precision - COALESCE(NULLIF(srq.source_data->>'lng', ''), NULLIF(srq.source_data->>'lon', ''), NULLIF(srq.source_data->>'longitude', ''))::double precision) * cos(radians(COALESCE(NULLIF(srq.source_data->>'lat', ''), NULLIF(srq.source_data->>'latitude', ''))::double precision)), 2)
          )))::int AS conflict_distance_m
        FROM source_review_queue srq
        LEFT JOIN LATERAL (
          SELECT peer.*
          FROM source_review_queue peer
          WHERE peer.entity_type = srq.entity_type
            AND peer.source = srq.source
            AND peer.review_kind = 'likely_new'
            AND peer.status = 'accepted'
            AND peer.id <> srq.id
            AND (NULLIF(peer.source_data->>'lat', '') IS NOT NULL OR NULLIF(peer.source_data->>'latitude', '') IS NOT NULL)
            AND (NULLIF(peer.source_data->>'lng', '') IS NOT NULL OR NULLIF(peer.source_data->>'lon', '') IS NOT NULL OR NULLIF(peer.source_data->>'longitude', '') IS NOT NULL)
            AND (NULLIF(srq.source_data->>'lat', '') IS NOT NULL OR NULLIF(srq.source_data->>'latitude', '') IS NOT NULL)
            AND (NULLIF(srq.source_data->>'lng', '') IS NOT NULL OR NULLIF(srq.source_data->>'lon', '') IS NOT NULL OR NULLIF(srq.source_data->>'longitude', '') IS NOT NULL)
            AND (111320 * sqrt(
              power(COALESCE(NULLIF(peer.source_data->>'lat', ''), NULLIF(peer.source_data->>'latitude', ''))::double precision - COALESCE(NULLIF(srq.source_data->>'lat', ''), NULLIF(srq.source_data->>'latitude', ''))::double precision, 2)
              + power((COALESCE(NULLIF(peer.source_data->>'lng', ''), NULLIF(peer.source_data->>'lon', ''), NULLIF(peer.source_data->>'longitude', ''))::double precision - COALESCE(NULLIF(srq.source_data->>'lng', ''), NULLIF(srq.source_data->>'lon', ''), NULLIF(srq.source_data->>'longitude', ''))::double precision) * cos(radians(COALESCE(NULLIF(srq.source_data->>'lat', ''), NULLIF(srq.source_data->>'latitude', ''))::double precision)), 2)
            )) <= 150
          ORDER BY (111320 * sqrt(
            power(COALESCE(NULLIF(peer.source_data->>'lat', ''), NULLIF(peer.source_data->>'latitude', ''))::double precision - COALESCE(NULLIF(srq.source_data->>'lat', ''), NULLIF(srq.source_data->>'latitude', ''))::double precision, 2)
            + power((COALESCE(NULLIF(peer.source_data->>'lng', ''), NULLIF(peer.source_data->>'lon', ''), NULLIF(peer.source_data->>'longitude', ''))::double precision - COALESCE(NULLIF(srq.source_data->>'lng', ''), NULLIF(srq.source_data->>'lon', ''), NULLIF(srq.source_data->>'longitude', ''))::double precision) * cos(radians(COALESCE(NULLIF(srq.source_data->>'lat', ''), NULLIF(srq.source_data->>'latitude', ''))::double precision)), 2)
          ))
          LIMIT 1
        ) peer ON true
        WHERE srq.entity_type = $1
          AND srq.status = 'accepted'
          AND srq.review_kind = 'likely_new'
          AND ${sourceReviewReadinessSqlForAlias} = 'duplicate_accepted_source_coordinate'
        ORDER BY srq.id
        LIMIT $2
      `, [entity, limit])
      const count = await client.query(`
        SELECT COUNT(*)::int AS total
        FROM source_review_queue srq
        WHERE srq.entity_type = $1
          AND srq.status = 'accepted'
          AND srq.review_kind = 'likely_new'
          AND ${sourceReviewReadinessSqlForAlias} = 'duplicate_accepted_source_coordinate'
      `, [entity])
      return { available: true, data: result.rows, total: count.rows[0]?.total || 0 }
    })
    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review conflict fetch error', error)
    return res.status(500).json({ error: 'Failed to load source review conflicts.' })
  }
})

app.patch('/api/admin/source-review-queue/bulk', requireAdminAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(value => safeInteger(value, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })).filter(Boolean))]
    : []
  const status = (req.body?.status || '').toString()
  const reviewerNotes = typeof req.body?.reviewerNotes === 'string'
    ? req.body.reviewerNotes.trim().slice(0, 1000)
    : null
  const dryRun = req.body?.dryRun === true

  if (!ids.length) {
    return res.status(400).json({ error: 'Select at least one source review row.' })
  }
  if (ids.length > 100) {
    return res.status(400).json({ error: 'Bulk source review updates are limited to 100 rows.' })
  }
  if (!['accepted', 'rejected', 'ignored', 'linked'].includes(status)) {
    return res.status(400).json({ error: 'Bulk source review updates only support accepted, rejected, ignored, or linked decisions.' })
  }

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }

      if (status !== 'linked') {
        if (dryRun) {
          const preview = await client.query(`
            SELECT id, source_name, source_id, review_kind, status
            FROM source_review_queue
            WHERE id = ANY($1::bigint[])
              AND status = 'pending'
              ${status === 'accepted' ? "AND review_kind = 'likely_new'" : ''}
          `, [ids])

          return {
            data: preview.rows,
            requested: ids.length,
            updated: preview.rowCount,
            skipped: ids.length - preview.rowCount,
            dryRun: true,
          }
        }

        const previous = await client.query(`
          SELECT id, entity_type, source, source_id, review_kind, status, decision, canonical_place_id
          FROM source_review_queue
          WHERE id = ANY($1::bigint[])
            AND status = 'pending'
            ${status === 'accepted' ? "AND review_kind = 'likely_new'" : ''}
        `, [ids])
        const result = await client.query(`
          UPDATE source_review_queue
          SET
            status = $2,
            decision = $2,
            reviewer_notes = COALESCE(NULLIF($3, ''), reviewer_notes),
            reviewed_at = NOW(),
            reviewed_by = 'admin',
            updated_at = NOW()
          WHERE id = ANY($1::bigint[])
            AND status = 'pending'
            ${status === 'accepted' ? "AND review_kind = 'likely_new'" : ''}
          RETURNING id, source_name, source_id, status
        `, [ids, status, reviewerNotes])
        for (const updated of result.rows) {
          const prior = previous.rows.find(row => String(row.id) === String(updated.id))
          if (prior) await recordSourceReviewDecision(client, prior, { status, decision: status, reviewer_notes: reviewerNotes, reviewed_by: 'admin' }, `bulk_${status}`)
        }

        return {
          data: result.rows,
          requested: ids.length,
          updated: result.rowCount,
          skipped: ids.length - result.rowCount,
        }
      }

      const current = await client.query(`
        SELECT
          id,
          entity_type,
          review_kind,
          source,
          source_id,
          source_name,
          source_url,
          source_data,
          nearest_place_id,
          nearest_place_name,
          nearest_distance_m,
          nearest_name_score,
          review_reason
        FROM source_review_queue
        WHERE id = ANY($1::bigint[])
          AND status = 'pending'
          AND review_kind = 'ambiguous'
          AND nearest_place_id IS NOT NULL
      `, [ids])

      const eligibleRows = []
      for (const row of current.rows) {
        const tableName = SOURCE_REVIEW_ENTITY_TABLES[row.entity_type]
        if (!tableName) continue

        const canonical = await client.query(`SELECT id FROM ${tableName} WHERE id = $1 LIMIT 1`, [row.nearest_place_id])
        if (!canonical.rows[0]) continue
        eligibleRows.push(row)
      }

      if (dryRun) {
        return {
          data: eligibleRows.map(row => ({
            id: row.id,
            source_name: row.source_name,
            source_id: row.source_id,
            status: 'pending',
            canonical_place_id: row.nearest_place_id,
            nearest_place_name: row.nearest_place_name,
            nearest_distance_m: row.nearest_distance_m,
          })),
          requested: ids.length,
          updated: eligibleRows.length,
          skipped: ids.length - eligibleRows.length,
          dryRun: true,
        }
      }

      await client.query('BEGIN')
      const linkedRows = []
      try {
        for (const row of eligibleRows) {
          await upsertReviewedPlaceSource(client, row, row.nearest_place_id, reviewerNotes)
          const result = await client.query(`
            UPDATE source_review_queue
            SET
              status = 'linked',
              decision = 'linked',
              canonical_place_id = $2,
              reviewer_notes = COALESCE(NULLIF($3, ''), reviewer_notes),
              reviewed_at = NOW(),
              reviewed_by = 'admin',
              updated_at = NOW()
            WHERE id = $1
              AND status = 'pending'
            RETURNING id, source_name, source_id, status, canonical_place_id
          `, [row.id, row.nearest_place_id, reviewerNotes])
          if (result.rows[0]) linkedRows.push(result.rows[0])
          if (result.rows[0]) {
            await recordSourceReviewDecision(client, row, {
              status: 'linked', decision: 'linked', canonical_place_id: row.nearest_place_id,
              reviewer_notes: reviewerNotes, reviewed_by: 'admin',
            }, 'bulk_linked')
          }
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      }

      return {
        data: linkedRows,
        requested: ids.length,
        updated: linkedRows.length,
        skipped: ids.length - linkedRows.length,
      }
    })

    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review queue bulk update error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to update source review rows.' })
  }
})

app.patch('/api/admin/source-review-queue/:id/reclassify-likely-new', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  const reviewerNotes = typeof req.body?.reviewerNotes === 'string'
    ? req.body.reviewerNotes.trim().slice(0, 1000)
    : null

  if (!id) {
    return res.status(400).json({ error: 'Invalid source review queue id.' })
  }

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }

      const current = await client.query(`
        SELECT id, entity_type, source, source_id, source_name, review_kind, status
        FROM source_review_queue
        WHERE id = $1
      `, [id])

      const row = current.rows[0]
      if (!row) {
        const error = new Error('Source review queue row not found.')
        error.status = 404
        throw error
      }
      if (row.status !== 'pending' || row.review_kind !== 'ambiguous') {
        const error = new Error('Only pending ambiguous source rows can be reclassified as likely-new candidates.')
        error.status = 400
        throw error
      }

      const duplicate = await client.query(`
        SELECT id
        FROM source_review_queue
        WHERE entity_type = $1
          AND source = $2
          AND source_id = $3
          AND review_kind = 'likely_new'
          AND id <> $4
        LIMIT 1
      `, [row.entity_type, row.source, row.source_id, id])

      if (duplicate.rows[0]) {
        const error = new Error(`A likely-new review row already exists for ${row.source}:${row.source_id}.`)
        error.status = 409
        throw error
      }

      const result = await client.query(`
        UPDATE source_review_queue
        SET
          review_kind = 'likely_new',
          decision = NULL,
          canonical_place_id = NULL,
          reviewer_notes = COALESCE(NULLIF($2, ''), reviewer_notes),
          reviewed_at = NULL,
          reviewed_by = 'admin:reclassified-likely-new',
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, reviewerNotes])

      await recordSourceReviewDecision(client, row, {
        review_kind: 'likely_new',
        status: 'pending',
        decision: null,
        canonical_place_id: null,
        reviewer_notes: reviewerNotes,
        reviewed_by: 'admin:reclassified-likely-new',
      }, 'reclassify_likely_new')

      return { data: result.rows[0] }
    })

    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review queue reclassify error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to reclassify source review row.' })
  }
})

app.patch('/api/admin/source-review-queue/:id/reclassify-replacement', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  const reviewerNotes = typeof req.body?.reviewerNotes === 'string'
    ? req.body.reviewerNotes.trim().slice(0, 1000)
    : null

  if (!id) return res.status(400).json({ error: 'Invalid source review queue id.' })

  try {
    const payload = await withLocalPostgres(async client => {
      await client.query('BEGIN')
      try {
        const current = await client.query(`
          SELECT *
          FROM source_review_queue
          WHERE id = $1
          FOR UPDATE
        `, [id])
        const row = current.rows[0]
        if (!row) {
          const error = new Error('Source review queue row not found.')
          error.status = 404
          throw error
        }
        if (row.status !== 'pending' || row.review_kind !== 'ambiguous' || row.source !== 'osm' || !row.nearest_place_id) {
          const error = new Error('Only pending exact OpenStreetMap matches can be recorded as business replacements.')
          error.status = 400
          throw error
        }

        const canonicalResult = await client.query(`
          SELECT id, name, google_place_id, status, rating, notes, lifecycle_status
          FROM ${SOURCE_REVIEW_ENTITY_TABLES[row.entity_type]}
          WHERE id = $1
          FOR UPDATE
        `, [row.nearest_place_id])
        const canonical = canonicalResult.rows[0]
        const exactIdentity = canonical
          && sourceReviewText(row.source_id) === sourceReviewText(canonical.google_place_id)
        const changedName = canonical
          && sourceReviewComparableText(canonicalSourceReviewName(row)) !== sourceReviewComparableText(canonical.name)
        if (!canonical || !exactIdentity || !changedName) {
          const error = new Error('This row is not an exact OpenStreetMap identity change.')
          error.status = 409
          throw error
        }
        if (canonical.lifecycle_status) {
          const error = new Error('This place already has a lifecycle decision.')
          error.status = 409
          throw error
        }

        await client.query(`
          UPDATE ${SOURCE_REVIEW_ENTITY_TABLES[row.entity_type]}
          SET lifecycle_status = 'closed', updated_at = NOW()
          WHERE id = $1
        `, [canonical.id])
        const updated = await client.query(`
          UPDATE source_review_queue
          SET
            review_kind = 'likely_new',
            decision = NULL,
            canonical_place_id = NULL,
            reviewer_notes = COALESCE(NULLIF($2, ''), reviewer_notes),
            reviewed_at = NULL,
            reviewed_by = 'admin:reclassified-replacement',
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `, [id, reviewerNotes])

        await recordSourceReviewDecision(client, row, {
          review_kind: 'likely_new',
          status: 'pending',
          decision: 'business_replacement',
          canonical_place_id: canonical.id,
          reviewer_notes: reviewerNotes,
          reviewed_by: 'admin:reclassified-replacement',
        }, 'reclassify_business_replacement', {
          canonicalBefore: sourceReviewPlaceSnapshot(canonical),
          canonicalAfter: { ...sourceReviewPlaceSnapshot(canonical), lifecycle_status: 'closed' },
        })

        await client.query('COMMIT')
        return { data: updated.rows[0], closedPlaceId: canonical.id }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      }
    })
    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review replacement reclassify error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to record the business replacement.' })
  }
})

app.get('/api/admin/source-review-queue/:id/history', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  if (!id) return res.status(400).json({ error: 'Invalid source review queue id.' })
  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }
      const result = await client.query(`
        SELECT id, review_queue_id, previous_review_kind, previous_status,
          previous_decision, previous_canonical_place_id, review_kind, status,
          decision, canonical_place_id, action, reviewer_notes, reviewed_by, created_at
        FROM source_review_decision_history
        WHERE review_queue_id = $1
        ORDER BY created_at DESC, id DESC
      `, [id])
      return { data: result.rows }
    })
    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review history fetch error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to load source review history.' })
  }
})

app.get('/api/admin/source-review-queue/:id/ai-assessment', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  if (!id) return res.status(400).json({ error: 'Invalid source review queue id.' })
  try {
    const payload = await withLocalPostgres(async client => {
      const table = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'source_review_ai_assessments'
        ) AS exists
      `)
      let assessment = null
      if (table.rows[0]?.exists) {
        const result = await client.query(`
          SELECT assessment.review_queue_id, assessment.entity_type, assessment.model,
            assessment.decision, assessment.confidence, assessment.reason,
            assessment.supporting_evidence, assessment.needs_human_review,
            assessment.decision_origin, assessment.created_at,
            (assessment.created_at < queue.updated_at) AS stale
          FROM source_review_ai_assessments assessment
          JOIN source_review_queue queue ON queue.id = assessment.review_queue_id
          WHERE assessment.review_queue_id = $1
          ORDER BY assessment.created_at DESC, assessment.id DESC
          LIMIT 1
        `, [id])
        assessment = result.rows[0] || null
      }

      if (assessment && !assessment.stale) {
        return { available: true, data: assessment, stale: false }
      }

      // Deterministic identity guidance is cheap and read-only. Make it
      // available immediately even when the optional Ollama triage cache has
      // not been populated yet; the UI still keeps the human decision gate.
      const queueResult = await client.query(`
        SELECT *
        FROM source_review_queue
        WHERE id = $1
      `, [id])
      const queueRow = queueResult.rows[0]
      if (!queueRow) return { available: true, data: null, stale: Boolean(assessment?.stale) }

      const entity = queueRow.entity_type === 'taco' ? 'taco' : 'pizza'
      const placeTable = `${entity}_places`
      const placeResult = queueRow.nearest_place_id
        ? await client.query(`
          SELECT id, google_place_id, address, phone, website_url, status, rating, notes,
            brand_wikidata, operator_wikidata, osm_tags
          FROM ${placeTable}
          WHERE id = $1
        `, [queueRow.nearest_place_id])
        : { rows: [] }
      const nearest = placeResult.rows[0] || {}
      const reviewRow = {
        ...queueRow,
        nearest_current_google_place_id: nearest.google_place_id,
        nearest_address: nearest.address,
        nearest_phone: nearest.phone,
        nearest_website_url: nearest.website_url,
        nearest_status: nearest.status,
        nearest_rating: nearest.rating,
        nearest_notes: nearest.notes,
        nearest_brand_wikidata: nearest.brand_wikidata,
        nearest_operator_wikidata: nearest.operator_wikidata,
        nearest_osm_tags: nearest.osm_tags,
      }
      const identity = await import('../scripts/lib/source-review-identity.mjs')
      const evidence = identity.evidenceFor(reviewRow)
      const deterministic = identity.deterministicDecision(reviewRow, evidence)
      return {
        available: true,
        data: deterministic ? {
          review_queue_id: id,
          entity_type: entity,
          model: 'deterministic-identity',
          ...deterministic,
          created_at: new Date().toISOString(),
        } : null,
        stale: Boolean(assessment?.stale),
      }
    })
    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review AI assessment error', error)
    return res.status(503).json({ error: error?.message || 'AI assessment is unavailable.' })
  }
})

app.patch('/api/admin/source-review-queue/:id/reopen', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  const reviewerNotes = typeof req.body?.reviewerNotes === 'string'
    ? req.body.reviewerNotes.trim().slice(0, 1000)
    : null

  if (!id) return res.status(400).json({ error: 'Invalid source review queue id.' })

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }

      const current = await client.query(`
        SELECT *
        FROM source_review_queue
        WHERE id = $1
      `, [id])
      const row = current.rows[0]
      if (!row) {
        const error = new Error('Source review queue row not found.')
        error.status = 404
        throw error
      }
      if (row.status === 'pending') {
        const error = new Error('Source review row is already pending.')
        error.status = 400
        throw error
      }
      if (row.status === 'linked') {
        const error = new Error('Linked source rows require a separate unlink review so provenance is not removed accidentally.')
        error.status = 400
        throw error
      }

      const result = await client.query(`
        UPDATE source_review_queue
        SET
          status = 'pending',
          decision = NULL,
          canonical_place_id = NULL,
          reviewer_notes = COALESCE(NULLIF($2, ''), reviewer_notes),
          reviewed_at = NULL,
          reviewed_by = 'admin:reopened',
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, reviewerNotes])

      await recordSourceReviewDecision(client, row, {
        review_kind: row.review_kind,
        status: 'pending',
        decision: null,
        canonical_place_id: null,
        reviewer_notes: reviewerNotes,
        reviewed_by: 'admin:reopened',
      }, 'reopen')

      return { data: result.rows[0] }
    })
    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review reopen error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to reopen source review row.' })
  }
})

app.patch('/api/admin/source-review-queue/:id/update-existing', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  const reviewerNotes = typeof req.body?.reviewerNotes === 'string'
    ? req.body.reviewerNotes.trim().slice(0, 1000)
    : null

  if (!id) return res.status(400).json({ error: 'Invalid source review queue id.' })

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }

      await client.query('BEGIN')
      try {
        const current = await client.query(`
          SELECT *
          FROM source_review_queue
          WHERE id = $1
          FOR UPDATE
        `, [id])
        const row = current.rows[0]
        if (!row) {
          const error = new Error('Source review queue row not found.')
          error.status = 404
          throw error
        }

        const tableName = SOURCE_REVIEW_ENTITY_TABLES[row.entity_type]
        if (!tableName || !row.nearest_place_id) {
          const error = new Error('This source record does not have an existing place that can be updated.')
          error.status = 400
          throw error
        }

        const canonicalResult = await client.query(`
          SELECT
            id, name, lat, lng, address, state, status, rating, notes,
            lifecycle_status, lifecycle_replaced_by_id,
            website_url, phone, address_source,
            style, price_range, style_confidence,
            enrichment_status, last_enriched_at, scrape_method, scrape_notes,
            google_place_id
          FROM ${tableName}
          WHERE id = $1
          FOR UPDATE
        `, [row.nearest_place_id])
        const canonical = canonicalResult.rows[0]
        if (!canonical) {
          const error = new Error('The existing map record is no longer available.')
          error.status = 404
          throw error
        }
        if (!sourceReviewCanUpdateExistingPlace(row, canonical)) {
          const error = new Error('Only an unreviewed place with the exact same OpenStreetMap ID can be updated in place. Keep historical or personally reviewed places separate.')
          error.status = 409
          throw error
        }

        const source = sourceReviewCandidatePayload(row)
        if (!sourceReviewText(source.name)) {
          const error = new Error('The source record has no usable name to apply.')
          error.status = 400
          throw error
        }

        const canonicalBefore = sourceReviewPlaceSnapshot(canonical)
        const update = await client.query(`
          UPDATE ${tableName}
          SET
            name = $2,
            lat = COALESCE($3, lat),
            lng = COALESCE($4, lng),
            address = COALESCE(NULLIF($5, ''), address),
            website_url = COALESCE(NULLIF($6, ''), website_url),
            phone = COALESCE(NULLIF($7, ''), phone),
            address_source = CASE WHEN NULLIF($5, '') IS NOT NULL THEN 'osm' ELSE address_source END,
            style = NULL,
            price_range = NULL,
            style_confidence = NULL,
            scrape_method = NULL,
            scrape_notes = NULL,
            enrichment_status = 'pending',
            last_enriched_at = NULL,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id, name, lat, lng, address, state, status, rating, notes,
            lifecycle_status, lifecycle_replaced_by_id,
            website_url, phone, address_source,
            style, price_range, style_confidence,
            enrichment_status, last_enriched_at, scrape_method, scrape_notes,
            google_place_id
        `, [
          canonical.id,
          sourceReviewText(source.name),
          source.lat,
          source.lng,
          sourceReviewText(source.address),
          sourceReviewText(source.websiteUrl),
          sourceReviewText(source.phone),
        ])
        const updatedPlace = update.rows[0]
        const canonicalAfter = sourceReviewPlaceSnapshot(updatedPlace)

        await upsertRefreshedPlaceSource(client, row, canonical.id, reviewerNotes, canonicalBefore)

        const updatedReview = await client.query(`
          UPDATE source_review_queue
          SET
            status = 'linked',
            decision = 'updated_existing',
            canonical_place_id = $2,
            reviewer_notes = $3,
            reviewed_at = NOW(),
            reviewed_by = 'admin',
            updated_at = NOW()
          WHERE id = $1
            AND status = 'pending'
          RETURNING *
        `, [row.id, canonical.id, reviewerNotes])
        if (!updatedReview.rows[0]) {
          const error = new Error('The source review record changed before the update could be saved.')
          error.status = 409
          throw error
        }

        await recordSourceReviewDecision(client, row, {
          review_kind: row.review_kind,
          status: 'linked',
          decision: 'updated_existing',
          canonical_place_id: canonical.id,
          reviewer_notes: reviewerNotes,
          reviewed_by: 'admin',
        }, 'update_existing_place', { canonicalBefore, canonicalAfter })

        await client.query('COMMIT')
        return { data: updatedReview.rows[0], place: updatedPlace }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      }
    })

    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review update existing place error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to update the existing place.' })
  }
})

app.get('/api/admin/lifecycle-candidates', requireAdminAuth, async (req, res) => {
  const entity = req.query.entity === 'taco' ? 'taco' : 'pizza'
  const kind = String(req.query.kind || 'replacements').trim().toLowerCase()
  const limit = safeInteger(req.query.limit, 50, { min: 1, max: 100 })
  const tableName = SOURCE_REVIEW_ENTITY_TABLES[entity]
  const allowedKinds = new Set(['replacements', 'stale', 'closed', 'conflicts'])

  if (!allowedKinds.has(kind)) return res.status(400).json({ error: 'Invalid lifecycle candidate kind.' })

  try {
    const payload = await withLocalPostgres(async client => {
      const tables = await client.query(`
        SELECT to_regclass('public.place_sources') IS NOT NULL AS place_sources,
               to_regclass('public.source_review_queue') IS NOT NULL AS review_queue
      `)
      const available = tables.rows[0] || {}
      if (kind === 'replacements' && !available.review_queue) {
        return { entity, kind, available: false, total: 0, rows: [] }
      }
      if (kind !== 'replacements' && !available.place_sources) {
        return { entity, kind, available: false, total: 0, rows: [] }
      }

      if (kind === 'replacements') {
        const where = `
          srq.entity_type = $1
          AND srq.status = 'pending'
          AND srq.review_kind = 'ambiguous'
          AND srq.source = 'osm'
          AND srq.source_id = p.google_place_id
          AND lower(regexp_replace(coalesce(srq.source_name, ''), '[^a-z0-9]+', ' ', 'g'))
            <> lower(regexp_replace(coalesce(p.name, ''), '[^a-z0-9]+', ' ', 'g'))
        `
        const [total, rows] = await Promise.all([
          client.query(`SELECT COUNT(*)::int AS total FROM source_review_queue srq JOIN ${tableName} p ON p.id = srq.nearest_place_id WHERE ${where}`, [entity]),
          client.query(`
            SELECT srq.id AS review_id, srq.source, srq.source_name, srq.source_id,
                   p.id AS place_id, p.name AS current_name, p.address,
                   p.status, p.rating, p.lifecycle_status,
                   CASE WHEN p.status <> 'unvisited' OR p.rating IS NOT NULL
                          OR NULLIF(btrim(p.notes), '') IS NOT NULL
                        THEN 'history_requires_review'
                        ELSE 'safe_unreviewed_update'
                   END AS handling
            FROM source_review_queue srq
            JOIN ${tableName} p ON p.id = srq.nearest_place_id
            WHERE ${where}
            ORDER BY srq.id
            LIMIT $2
          `, [entity, limit]),
        ])
        return { entity, kind, available: true, total: Number(total.rows[0]?.total || 0), rows: rows.rows }
      }

      const latestSourceSql = `
        WITH latest_source AS (
          SELECT DISTINCT ON (ps.place_id, ps.source)
                 ps.entity_type, ps.place_id, ps.source, ps.source_id, ps.source_url, ps.retrieved_at
          FROM place_sources ps
          WHERE ps.entity_type = $1
          ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
        )
      `
      if (kind === 'stale') {
        const latestOsmInputs = latestOsmInputIds(entity)
        const where = `
          latest_source.retrieved_at < NOW() - make_interval(days => CASE latest_source.source
            WHEN 'osm' THEN 30 WHEN 'official_website' THEN 30 WHEN 'all_the_places' THEN 90
            WHEN 'fsq_os_places' THEN 180 WHEN 'overture_places' THEN 365 WHEN 'wikidata' THEN 365 ELSE 180 END)
          AND lower(coalesce(p.status, '')) NOT LIKE 'closed%'
          AND COALESCE(p.lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
        `
        const [total, rows, observationRows] = await Promise.all([
          client.query(`${latestSourceSql} SELECT COUNT(*)::int AS total FROM latest_source JOIN ${tableName} p ON p.id = latest_source.place_id WHERE latest_source.entity_type = $1 AND ${where}`, [entity]),
          client.query(`${latestSourceSql}
            SELECT p.id AS place_id, p.name, p.state, p.status, latest_source.source,
                   latest_source.source_id, latest_source.source_url, latest_source.retrieved_at,
                   CASE latest_source.source WHEN 'osm' THEN 30 WHEN 'official_website' THEN 30 WHEN 'all_the_places' THEN 90
                     WHEN 'fsq_os_places' THEN 180 WHEN 'overture_places' THEN 365 WHEN 'wikidata' THEN 365 ELSE 180 END AS freshness_days
            FROM latest_source JOIN ${tableName} p ON p.id = latest_source.place_id
            WHERE latest_source.entity_type = $1 AND ${where}
            ORDER BY latest_source.retrieved_at NULLS FIRST
            LIMIT $2
          `, [entity, limit]),
          client.query(`${latestSourceSql}
            SELECT latest_source.source, latest_source.source_id
            FROM latest_source JOIN ${tableName} p ON p.id = latest_source.place_id
            WHERE latest_source.entity_type = $1 AND ${where}
          `, [entity]),
        ])
        const observationCounts = { observed: 0, unobserved: 0, unavailable: 0 }
        for (const row of observationRows.rows) {
          if (row.source !== 'osm' || !latestOsmInputs.files.length) observationCounts.unavailable += 1
          else if (latestOsmInputs.ids.has(normalizedSourceId(row.source_id))) observationCounts.observed += 1
          else observationCounts.unobserved += 1
        }
        const enrichedRows = rows.rows.map(row => {
          if (row.source !== 'osm' || !latestOsmInputs.files.length) {
            return { ...row, latest_input_observation: 'not_available' }
          }
          return {
            ...row,
            latest_input_observation: latestOsmInputs.ids.has(normalizedSourceId(row.source_id))
              ? 'observed_in_latest_input'
              : 'unobserved_in_latest_input',
          }
        })
        return {
          entity,
          kind,
          available: true,
          total: Number(total.rows[0]?.total || 0),
          latest_input_files: latestOsmInputs.files.map(file => file.replace(`${resolve(__dirname, '..')}/`, '')),
          latest_input_observation_counts: observationCounts,
          rows: enrichedRows,
        }
      }

      if (kind === 'closed') {
        const latestClosedSourceSql = `
          WITH latest_closed_source AS (
            SELECT DISTINCT ON (ps.place_id, ps.source)
                   ps.entity_type, ps.place_id, ps.source, ps.source_id,
                   ps.source_url, ps.retrieved_at, ps.match_method, ps.data
            FROM place_sources ps
            WHERE ps.entity_type = $1
            ORDER BY ps.place_id, ps.source, ps.retrieved_at DESC NULLS LAST
          )
        `
        const where = `
          lower(coalesce(p.status, '')) NOT LIKE 'closed%'
          AND COALESCE(p.lifecycle_status, '') NOT IN ('closed', 'replaced', 'demolished')
          AND latest_closed_source.data->>'is_closed' = 'true'
        `
        const [total, rows] = await Promise.all([
          client.query(`${latestClosedSourceSql} SELECT COUNT(*)::int AS total FROM latest_closed_source JOIN ${tableName} p ON p.id = latest_closed_source.place_id WHERE ${where}`, [entity]),
          client.query(`${latestClosedSourceSql}
            SELECT p.id AS place_id, p.name, p.state, p.status,
                   latest_closed_source.source, latest_closed_source.source_id,
                   latest_closed_source.source_url, latest_closed_source.retrieved_at,
                   latest_closed_source.match_method
            FROM latest_closed_source JOIN ${tableName} p ON p.id = latest_closed_source.place_id
            WHERE ${where}
            ORDER BY latest_closed_source.retrieved_at DESC NULLS LAST
            LIMIT $2
          `, [entity, limit]),
        ])
        return { entity, kind, available: true, total: Number(total.rows[0]?.total || 0), rows: rows.rows }
      }

      const candidates = `
        WITH candidates AS (
          SELECT id, name, state, lat, lng,
                 ROUND(lat::numeric, 4) AS lat_bucket,
                 ROUND(lng::numeric, 4) AS lng_bucket,
                 lower(regexp_replace(coalesce(name, ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_name
          FROM ${tableName}
          WHERE lat IS NOT NULL AND lng IS NOT NULL
        )
      `
      const where = `
        b.id > a.id AND b.lat_bucket = a.lat_bucket AND b.lng_bucket = a.lng_bucket
        AND COALESCE(a.state, '') = COALESCE(b.state, '')
        AND ABS(a.lat - b.lat) < 0.00015 AND ABS(a.lng - b.lng) < 0.00015
        AND a.normalized_name <> b.normalized_name
      `
      const [total, rows] = await Promise.all([
        client.query(`${candidates} SELECT COUNT(*)::int AS total FROM candidates a JOIN candidates b ON ${where}`, []),
        client.query(`${candidates}
          SELECT a.id AS first_place_id, a.name AS first_name, b.id AS second_place_id, b.name AS second_name, a.state,
                 ROUND((ABS(a.lat - b.lat) * 111000)::numeric, 1) AS latitude_gap_m,
                 ROUND((ABS(a.lng - b.lng) * 111000 * COS(RADIANS(a.lat)))::numeric, 1) AS longitude_gap_m
          FROM candidates a JOIN candidates b ON ${where}
          ORDER BY a.id, b.id
          LIMIT $1
        `, [limit]),
      ])
      return { entity, kind, available: true, total: Number(total.rows[0]?.total || 0), rows: rows.rows }
    })
    return res.json({ data: payload })
  } catch (error) {
    console.error('[admin] lifecycle candidates error', error)
    return res.status(error.status || 503).json({ error: error.message || 'Lifecycle candidates are unavailable.' })
  }
})

app.patch('/api/admin/places/:id/lifecycle', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  const entity = req.body?.entity === 'taco' ? 'taco' : 'pizza'

  try {
    const input = normalizeLifecycleChange({
      entity,
      placeId: id,
      lifecycleStatus: req.body?.lifecycleStatus,
      replacementId: req.body?.replacedByPlaceId,
      reason: req.body?.reason,
    })
    const payload = await withLocalPostgres(async client => {
      const updated = await applyLifecycleChange(client, input, { changedBy: 'admin:portal' })
      return { data: updated }
    })
    return res.json(payload)
  } catch (error) {
    console.error('[admin] lifecycle update error', error)
    return res.status(error.status || 503).json({ error: error.message || 'Failed to update place lifecycle.' })
  }
})

app.patch('/api/admin/source-review-queue/:id', requireAdminAuth, async (req, res) => {
  const id = safeInteger(req.params.id, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })
  const status = (req.body?.status || '').toString()
  const reviewerNotes = typeof req.body?.reviewerNotes === 'string'
    ? req.body.reviewerNotes.trim().slice(0, 1000)
    : null
  const canonicalPlaceId = req.body?.canonicalPlaceId == null || req.body?.canonicalPlaceId === ''
    ? null
    : safeInteger(req.body.canonicalPlaceId, 0, { min: 1, max: Number.MAX_SAFE_INTEGER })

  if (!id) {
    return res.status(400).json({ error: 'Invalid source review queue id.' })
  }
  if (!allowedSourceReviewStatuses.has(status) || status === 'pending') {
    return res.status(400).json({ error: 'Invalid source review decision status.' })
  }
  if (status === 'linked' && !canonicalPlaceId) {
    return res.status(400).json({ error: 'Link decisions require a canonical place id.' })
  }

  try {
    const payload = await withLocalPostgres(async client => {
      if (!(await sourceReviewQueueExists(client))) {
        const error = new Error('source_review_queue is not configured.')
        error.status = 503
        throw error
      }

      const current = await client.query(`
        SELECT
          id,
          entity_type,
          review_kind,
          source,
          source_id,
          source_name,
          source_url,
          source_data,
          nearest_place_id,
          nearest_place_name,
          nearest_distance_m,
          nearest_name_score,
          review_reason
        FROM source_review_queue
        WHERE id = $1
      `, [id])

      const row = current.rows[0]
      if (!row) {
        const error = new Error('Source review queue row not found.')
        error.status = 404
        throw error
      }

      if (status === 'accepted' && row.review_kind !== 'likely_new') {
        const error = new Error('Accept new is only valid for likely-new source rows. Link, reject, or ignore ambiguous rows.')
        error.status = 400
        throw error
      }

      if (status === 'linked') {
        const tableName = SOURCE_REVIEW_ENTITY_TABLES[row.entity_type]
        if (!tableName) {
          const error = new Error('Unsupported source review entity type.')
          error.status = 400
          throw error
        }
        const canonical = await client.query(`SELECT id FROM ${tableName} WHERE id = $1 LIMIT 1`, [canonicalPlaceId])
        if (!canonical.rows[0]) {
          const error = new Error(`Canonical ${row.entity_type} place id ${canonicalPlaceId} was not found.`)
          error.status = 400
          throw error
        }
      }

      await client.query('BEGIN')
      let result
      try {
        if (status === 'linked') {
          await upsertReviewedPlaceSource(client, row, canonicalPlaceId, reviewerNotes)
        }

        result = await client.query(`
          UPDATE source_review_queue
          SET
            status = $2,
            decision = $2,
            canonical_place_id = $3,
            reviewer_notes = $4,
            reviewed_at = NOW(),
            reviewed_by = 'admin',
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `, [id, status, canonicalPlaceId, reviewerNotes])

        await recordSourceReviewDecision(client, row, {
          review_kind: row.review_kind,
          status,
          decision: status,
          canonical_place_id: canonicalPlaceId,
          reviewer_notes: reviewerNotes,
          reviewed_by: 'admin',
        }, status === 'linked' ? 'linked' : `set_${status}`)

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      }

      return { data: result.rows[0] }
    })

    return res.json(payload)
  } catch (error) {
    console.error('[admin] source review queue update error', error)
    return res.status(error.status || 500).json({ error: error.message || 'Failed to update source review row.' })
  }
})

app.get('/api/admin/suggestions', requireAdminAuth, async (req, res) => {
  try {
    const statusParam = (req.query?.status || 'pending').toString()
    const statusFilters = statusParam
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)

    const entityParam = (req.query?.entity || '').toString().trim()
    const countOnly = req.query?.count === 'only'

    let query = serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .select(countOnly ? 'id' : '*', countOnly ? { count: 'exact', head: true } : undefined)

    if (!countOnly) query = query.order('created_at', { ascending: false })

    if (statusFilters.length > 0) {
      query = query.in('status', statusFilters)
    }
    if (entityParam) {
      query = query.eq('entity', entityParam)
    }

    const { data, error, count } = await query
    if (error) {
      if (error.code === 'PGRST205') {
        // Unified suggestions table not present; return empty to avoid 500s.
        return res.json(countOnly ? { data: [], count: 0 } : { data: [] })
      }
      throw error
    }

    return res.json(countOnly ? { data: [], count: Number(count) || 0 } : { data })
  } catch (error) {
    console.error('[admin] suggestions fetch error', error)
    return res.status(500).json({ error: 'Failed to load suggestions.' })
  }
})

app.post('/api/admin/suggestions/:id/approve', requireAdminAuth, async (req, res) => {
  const suggestionId = req.params.id
  if (!suggestionId) {
    return res.status(400).json({ error: 'Suggestion id required' })
  }

  try {
    const { data: suggestion, error } = await serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .select('*')
      .eq('id', suggestionId)
      .single()

    if (error) {
      if (error?.code === 'PGRST116') {
        return res.status(404).json({ error: 'Suggestion not found' })
      }
      throw error
    }

    if (suggestion.status === 'approved') {
      return res.status(400).json({ error: 'Suggestion already approved' })
    }

    const locationPayload = {
      entity: suggestion.entity,
      name: suggestion.name,
      formatted_address: suggestion.formatted_address || suggestion.location_text || null,
      lat: suggestion.lat,
      lng: suggestion.lng,
      google_place_id: suggestion.google_place_id,
      source: 'user-suggestion',
      status: 'pending',
      recommendation: suggestion.recommendation || null,
    }

    const { data: location, error: insertError } = await serviceClient
      .from(LOCATIONS_TABLE)
      .insert(locationPayload)
      .select('*')
      .single()

    if (insertError) {
      throw insertError
    }

    const { data: updatedSuggestion, error: updateError } = await serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        location_id: location?.id ?? null,
      })
      .eq('id', suggestionId)
      .select('*')
      .single()

    if (updateError) {
      throw updateError
    }

    return res.json({ data: updatedSuggestion, location })
  } catch (error) {
    console.error('[admin] approve suggestion error', error)
    return res.status(500).json({ error: 'Failed to approve suggestion.' })
  }
})

app.post('/api/admin/suggestions/:id/reject', requireAdminAuth, async (req, res) => {
  const suggestionId = req.params.id
  if (!suggestionId) {
    return res.status(400).json({ error: 'Suggestion id required' })
  }

  const reason =
    req.body && typeof req.body.reason === 'string'
      ? req.body.reason.trim().slice(0, 500)
      : null

  try {
    const { data: suggestion, error } = await serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .select('id, status')
      .eq('id', suggestionId)
      .single()

    if (error) {
      if (error?.code === 'PGRST116') {
        return res.status(404).json({ error: 'Suggestion not found' })
      }
      throw error
    }

    if (suggestion.status === 'rejected') {
      return res.status(400).json({ error: 'Suggestion already rejected' })
    }

    const { data: updatedSuggestion, error: updateError } = await serviceClient
      .from(SUGGESTED_PLACES_TABLE)
      .update({
        status: 'rejected',
        rejection_reason: reason,
        rejected_at: new Date().toISOString(),
      })
      .eq('id', suggestionId)
      .select('*')
      .single()

    if (updateError) {
      throw updateError
    }

    return res.json({ data: updatedSuggestion })
  } catch (error) {
    console.error('[admin] reject suggestion error', error)
    return res.status(500).json({ error: 'Failed to reject suggestion.' })
  }
})

app.get('/api/places/autocomplete', async (req, res) => {
  const result = await handleAutocomplete({
    input: (req.query?.input || '').toString(),
    sessionToken: (req.query?.sessiontoken || '').toString(),
    ip: getClientIp(req),
  })
  return res.status(result.status).json(result.body)
})

app.get('/api/places/details', async (req, res) => {
  const result = await handlePlaceDetails({
    placeId: (req.query?.place_id || '').toString(),
    sessionToken: (req.query?.sessiontoken || '').toString(),
    ip: getClientIp(req),
  })
  return res.status(result.status).json(result.body)
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Admin server listening on port ${PORT}`)
  })
}

module.exports = app
