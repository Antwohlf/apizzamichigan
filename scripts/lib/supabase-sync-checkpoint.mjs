import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function readSyncCheckpoint(path) {
  if (!path || !existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed?.last_enriched_at || !Number.isFinite(Number(parsed.id))) {
    throw new Error(`Invalid sync checkpoint: ${path}`);
  }
  return {
    lastEnrichedAt: new Date(parsed.last_enriched_at).toISOString(),
    id: Number(parsed.id),
    source: path,
  };
}

export function checkpointFromRow(row) {
  if (!row?.last_enriched_at || !Number.isFinite(Number(row.id))) return null;
  return {
    last_enriched_at: new Date(row.last_enriched_at).toISOString(),
    id: Number(row.id),
    saved_at: new Date().toISOString(),
  };
}

export function writeSyncCheckpoint(path, checkpoint) {
  if (!path || !checkpoint) return;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(checkpoint, null, 2)}\n`);
  renameSync(tmp, path);
}
