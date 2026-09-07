import { Buffer } from 'node:buffer'

const forbiddenExactPaths = new Set([
  '.status_safeguards.md',
  'conversation.md',
  'scripts/pizza-metadata-review.json',
  'scripts/taco-metadata-review.json',
])

// These files are still authoritative resume state for legacy write-capable
// scripts. They may remain only while the app repository is private. Removing
// them before a verified host migration would silently restart work.
const legacyRuntimePaths = new Set([
  '.taco-metadata-progress.json',
  'scripts/.address-enrichment-pizza_places.json',
  'scripts/.address-enrichment-taco_places.json',
  'scripts/.pizza-metadata-progress.json',
  'scripts/.state-import-progress.json',
  'scripts/.taco-state-import-progress.json',
])

const releaseDataReviewPaths = new Set([
  'scripts/osm-pizza-import.sql',
  'src/data.js',
  'src/data/frozenTacos.js',
  'src/data/tacoPlaces.js',
])

const legacyPrivateTopologyPaths = new Set([
  'docs/HOME_SERVER_OPS.md',
  'docs/IMAC_PIPELINE_RUNBOOK.md',
  'docs/SAFEGUARDS.md',
  'docs/SYSTEM_DIAGRAM.md',
  'scripts/enrichment/archive/watchdog-keepalive.mjs',
  'scripts/enrichment/keepalive.mjs',
  'scripts/ops/classifier-health-report.mjs',
  'scripts/ops/project-readiness-report.test.mjs',
])

const anonJwtAllowlist = new Set([
  'src/supabaseClient.js',
  'scripts/migrate-add-state-column.mjs',
])

const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const credentialNamePattern = '[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|API_KEY|ACCESS_KEY)[A-Z0-9_]*'
const credentialAssignmentPatterns = [
  {
    kind: 'shell',
    pattern: new RegExp(`^(?:[ \\t]*export[ \\t]+)?[ \\t]*(${credentialNamePattern})[ \\t]*=[ \\t]*([^#\\r\\n]*)`, 'gm'),
  },
  {
    kind: 'javascript',
    pattern: new RegExp(`^[ \\t]*(?:const|let|var)[ \\t]+(${credentialNamePattern})[ \\t]*=[ \\t]*([^\\r\\n]*)`, 'gm'),
  },
  {
    kind: 'mapping',
    pattern: new RegExp(`^[ \\t]*["']?(${credentialNamePattern})["']?[ \\t]*:[ \\t]*([^#\\r\\n]*)`, 'gm'),
  },
]
const passwordBearingPostgresUri = /postgres(?:ql)?:\/\/[^\s:/@]+:[^\s/@]+@/i
const signedUrlPattern = /(?:x-amz-signature|x-goog-signature|signature|sig)=[A-Za-z0-9%_-]{12,}/i
const privateKeyPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
const pipelineStatusSchemaMarker = /"name"\s*:\s*"map-data-pipeline\.status"/
const pipelineStatusPurposeMarker = /"purpose"\s*:\s*"operations-display-only"/

const releaseOnlyTextPatterns = [
  [new RegExp(['/(?:', 'Users|home', ')/[A-Za-z0-9._-]+/'].join(''), 'i'), 'contains an absolute home-directory path'],
  [new RegExp(['^(?:[ \\t]*\\$[ \\t]+)?[ \\t]*', 'ssh', '[ \\t]+', '(?!example(?:[.-]|\\b)|localhost\\b)', '[A-Za-z0-9][A-Za-z0-9._-]*'].join(''), 'im'), 'contains a concrete SSH host'],
  [/(?:\bssh[ \t]+|https?:\/\/|\bHostName[ \t]+)[A-Za-z0-9][A-Za-z0-9._-]*\.local\b/i, 'contains a local host name'],
  [/\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/, 'contains a private-network address'],
]

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function isPlaceholder(value, { allowIdentifierReference = false } = {}) {
  const trimmed = value.trim().replace(/\\$/, '').trim().replace(/[,;]$/, '').trim()
  const isQuoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
  const unquoted = isQuoted ? trimmed.slice(1, -1) : trimmed
  return unquoted === ''
    || unquoted === '...'
    || unquoted === 'null'
    || unquoted === 'undefined'
    || /^<[^>\r\n]+>$/.test(unquoted)
    || /^\$\{?[A-Z0-9_]+\}?$/.test(unquoted)
    || /^(?:process\.env|import\.meta\.env)\./.test(unquoted)
    || (allowIdentifierReference && !isQuoted && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(unquoted))
}

export function pathViolations(path, { release = false } = {}) {
  const violations = []
  const grandfatheredRuntimePath = legacyRuntimePaths.has(path)
  if (forbiddenExactPaths.has(path)) violations.push('generated, operational, or conversation artifact')
  if (release && grandfatheredRuntimePath) violations.push('legacy tracked runtime state requires verified host migration')
  if (release && releaseDataReviewPaths.has(path)) violations.push('record-level data requires an explicit public licensing decision')
  if (/^(?:reports|backups|output|assets|\.playwright-cli|\.vscode)(?:\/|$)/.test(path)) {
    violations.push('host-local output directory')
  }
  if (!grandfatheredRuntimePath && /^scripts\/\..*-progress\.json(?:\..*)?$/.test(path)) violations.push('runtime progress file')
  if (!grandfatheredRuntimePath && /^scripts\/\.address-enrichment-.*\.json$/.test(path)) violations.push('address-enrichment result')
  if (/^scripts\/.*-metadata-review\.json$/.test(path)) violations.push('metadata review result')
  if (/^scripts\/\.pipeline-status(?:\/|$)/.test(path)) violations.push('pipeline status runtime snapshot')
  if (/(?:^|\/)\.env(?:\..*)?$/.test(path) && path !== '.env.example') violations.push('environment file')
  if (/\.(?:db|db-shm|db-wal|sqlite|sqlite3|sqlite-shm|sqlite-wal|log|parquet|ndjson)$/i.test(path)) {
    violations.push('runtime, database, log, or source-data extension')
  }
  if (/\.bak$/i.test(path)) violations.push('backup file')
  return violations
}

export function textViolations(path, text, { release = false } = {}) {
  const violations = []

  for (const token of text.match(jwtPattern) || []) {
    const payload = decodeJwtPayload(token)
    if (!payload || payload.role !== 'anon' || !anonJwtAllowlist.has(path)) {
      violations.push('contains a JWT outside the reviewed anon-key allowlist')
    }
  }

  const javascriptPath = /\.(?:[cm]?[jt]sx?)$/i.test(path)
  for (const { kind, pattern } of credentialAssignmentPatterns) {
    for (const match of text.matchAll(pattern)) {
      const allowIdentifierReference = kind === 'javascript' || (kind === 'mapping' && javascriptPath)
      if (!isPlaceholder(match[2] || '', { allowIdentifierReference })) {
        violations.push('contains a non-placeholder private credential assignment')
      }
    }
  }

  if (passwordBearingPostgresUri.test(text)) violations.push('contains a password-bearing PostgreSQL URI')
  if (signedUrlPattern.test(text)) violations.push('contains a signed URL')
  if (privateKeyPattern.test(text)) violations.push('contains a private key')
  if (pipelineStatusSchemaMarker.test(text) && pipelineStatusPurposeMarker.test(text)) {
    violations.push('contains a pipeline status runtime snapshot')
  }

  const topologyGrandfathered = !release && (
    legacyPrivateTopologyPaths.has(path)
    || path.startsWith('infra/local/launchd/')
  )
  if (!topologyGrandfathered) {
    for (const [pattern, message] of releaseOnlyTextPatterns) {
      if (pattern.test(text)) violations.push(message)
    }
  }

  return [...new Set(violations)]
}
