import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';

const root = process.cwd();

test('migrated publisher implementations are absent from the app checkout', () => {
  for (const path of [
    'scripts/ops/guarded-supabase-sync.mjs',
    'scripts/ops/auto-guarded-supabase-sync.mjs',
    'scripts/sync-local-to-supabase.mjs',
  ]) {
    assert.equal(existsSync(path), false, path);
  }
});

test('retired sync agent fails closed with external-runtime guidance', () => {
  const result = spawnSync(process.execPath, ['scripts/enrichment/agents/sync-agent.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /packages\/food-runtime/);
  assert.match(result.stderr, /external runtime on the pipeline host/);
});

test('reviewed-new apply fails before database access and points to the external host', () => {
  const result = spawnSync(process.execPath, [
    'scripts/ops/reconcile-reviewed-new-supabase.mjs',
    '--limit', '7',
    '--apply',
    '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      NODE_ENV: 'test',
      DOTENV_CONFIG_PATH: '/dev/null',
      DOTENV_CONFIG_QUIET: 'true',
      PGHOST: 'must-not-be-contacted.invalid',
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Reviewed-new publication is externally owned/);
  assert.match(result.stderr, /FOOD_PIPELINE_WORKSPACE/);
  assert.match(result.stderr, /reconcile-reviewed-new-supabase\.mjs --limit 7 --apply --json/);
});
