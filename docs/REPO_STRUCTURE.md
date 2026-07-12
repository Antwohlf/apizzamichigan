# Repository Structure Plan

This repo should stay a monorepo for now. The app, enrichment pipeline, sync
logic, schemas, and docs share one domain model, and splitting them before the
local recovery work is stable would add coordination cost without enough
benefit.

The goal is not to move everything at once. The goal is to make ownership
boundaries explicit, then migrate low-risk areas first.

## Current Shape

```text
apizzamichigan/
  src/                         React app
  public/                      CRA public assets and generated dashboard JSON
  api/                         serverless-style API handlers
  server/                      local Express API/server
  scripts/                     imports, enrichment, sync, one-off tools
  scripts/enrichment/          local enrichment pipeline
  docs/                        project and data pipeline docs
  __mocks__/                   Jest mocks
```

This works, but it mixes several concerns:

- public app code
- admin/API code
- local enrichment pipeline code
- local machine operations
- one-off import scripts
- generated/runtime state

## Target Shape

```text
apizzamichigan/
  apps/
    web/                       React app, public assets, app tests

  services/
    api/                       Express/API handlers used by app/admin flows

  packages/
    pipeline/                  local enrichment pipeline and sync tooling
    shared/                    shared taxonomies, schemas, types, constants

  infra/
    local/                     launchd/cron/docker/service definitions
    hosting/                   static hosting/deploy config, if needed

  docs/                        architecture, operations, data contracts
```

This layout makes future multi-repo extraction possible, but does not require
it. If the pipeline ever needs to become private, separately deployed, or owned
by a different workflow, `packages/pipeline/` can be split later with less
untangling.

## Ownership Boundaries

### `apps/web`

Owns the user-facing app:

- routes `/`, `/tacos`, `/data`, `/admin/submit`, `/admin/reviews`
- React components
- CSS
- public assets
- frontend tests

Should not own:

- local enrichment workers
- cron/keepalive scripts
- local Postgres schema migrations
- SQLite queue internals

### `services/api`

Owns request/response API behavior:

- admin auth
- admin submit/reviews/suggestions
- bug reports
- Google Places proxy endpoints
- reusable request/rate-limit helpers

The existing `api/` and `server/` split can be preserved during migration, but
the long-term goal is for API code to live under one service boundary.

### `packages/pipeline`

Owns local enrichment:

- local Postgres schemas
- SQLite queue
- coordinator/workers/watchdogs
- sync down from Supabase
- sync up to Supabase
- scrape/classify/menu-parse tooling
- local dashboard/status tooling

Pipeline code should treat the public Supabase database as an external target,
not as its internal job store.

### `packages/shared`

Owns shared domain contracts:

- pizza styles
- taco types
- place type definitions
- Supabase/local enrichment column allowlists
- shared TypeScript/JSDoc types
- validation helpers

Shared code should stay small and boring. Do not move code here just because two
files import it once.

### `infra/local`

Owns machine process management:

- `launchd` plist files
- cron examples
- Docker Compose files, if introduced
- local service health checks
- restart scripts that do not depend on Codex/OpenClaw auth

Secrets, tokens, runtime logs, queues, status JSON, and caches should remain
untracked.

## Migration Order

### Phase 0: Canonical Recovery

Goal: get all agents on the same branch and preserve home-server-only recovery
files.

Status:

- PR #1 adds the current recovery files and missing pipeline runtime
  dependencies.

Do not move folders in this phase.

### Phase 1: Document Boundaries

Goal: merge this document and agree on the intended layout.

No runtime behavior should change in this phase.

### Phase 2: Move Pipeline First

The pipeline is the best first move because it is mostly outside the CRA build.

Candidate moves:

```text
scripts/enrichment/                  -> packages/pipeline/
scripts/sync-local-to-supabase.mjs   -> packages/pipeline/sync-local-to-supabase.mjs
```

Required updates:

- update relative imports inside moved scripts
- update docs references
- update any cron/keepalive command examples
- run `node --check` across moved `.mjs` files
- do not run write syncs as part of the move

### Phase 3: Extract Shared Contracts

Move only stable, shared domain definitions:

```text
src/data/pizzaStyles.js              -> packages/shared/pizzaStyles.js
src/data/tacoTypes.js                -> packages/shared/tacoTypes.js
src/types/                           -> packages/shared/types/ or keep in app until needed
```

Required updates:

- app imports
- pipeline imports, if any
- tests

Avoid moving UI-specific app data into shared.

### Phase 4: Move API Boundary

Candidate moves:

```text
api/                                 -> services/api/api/
server/                              -> services/api/server/
```

This phase needs more care because local dev proxying, deployment routing, and
serverless paths may depend on existing locations.

### Phase 5: Move CRA App Last

Candidate moves:

```text
src/                                 -> apps/web/src/
public/                              -> apps/web/public/
```

This is the riskiest move because Create React App assumes root-level paths.
Only do this if either:

- the app migrates to Vite/Next/etc., or
- CRA scripts are wrapped/configured to run from `apps/web`.

Until then, keeping `src/` and `public/` at root is acceptable.

## Guardrails

- Keep file moves in separate commits from behavioral edits.
- Do not move generated/runtime artifacts.
- Do not stage `.env`, logs, queue DBs, progress JSON, status JSON, caches, or
  auth files.
- Run syntax checks for moved scripts before committing:

```bash
find packages/pipeline -name '*.mjs' -print0 | xargs -0 -n1 node --check
```

- Run app verification after any import path change:

```bash
npm run typecheck
npm run lint
CI=true npm test -- --watchAll=false
```

- For sync scripts, dry-run before any write:

```bash
node packages/pipeline/sync-local-to-supabase.mjs --dry-run --batch 25 --max-batches 1
```

## Decision Points

Before moving files, decide:

- Should runtime service management be `launchd`, Docker Compose, or both?
- Should SQLite queue remain, or should job state move into local Postgres?
- Which fields are officially safe for local-to-Supabase sync overwrite?
- Should pipeline-only code eventually be private?
- Should the app stay on CRA or migrate before moving `src/`/`public/`?

## Recommendation

Keep the monorepo. Merge recovery first. Then move `scripts/enrichment/` into
`packages/pipeline/` as the first structural change. Leave the React app at the
root until the build tool decision is explicit.
