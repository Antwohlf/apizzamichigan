import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

// Vercel skips a build on exit 0; exit 1 means the build should proceed.
for (const [branch, expectedStatus] of [
  ['gh-pages', 0],
  ['main', 1],
  ['codex/release-cleanup', 1],
  ['gh-pages-fix', 1],
  ['', 1],
  [undefined, 1],
  ['$(exit 0)', 1],
]) {
  test(`Vercel build policy for ${JSON.stringify(branch) ?? 'missing branch'}`, () => {
    const env = { ...process.env };
    delete env.VERCEL_GIT_COMMIT_REF;
    if (branch !== undefined) env.VERCEL_GIT_COMMIT_REF = branch;
    const result = spawnSync('/bin/sh', ['-c', config.ignoreCommand], { env });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, expectedStatus);
  });
}
