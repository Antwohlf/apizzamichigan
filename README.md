# APizzaMichigan and TacoBoutMichigan

[APizzaMichigan](https://www.apizzamichigan.com) is a personal map and
directory for tracking pizza places, reviews, and recommendations. The same
application powers [TacoBoutMichigan](https://www.apizzamichigan.com/tacos)
with separate data, filters, classification policy, and visual design.

## What is here

- Interactive pizza and taco maps with search and filters.
- Place details, personal ratings and notes, lifecycle status, and photos.
- Public place suggestions and an authenticated editorial review portal.
- Product-owned PostgreSQL/Supabase schemas, migrations, read views, and
  guarded publication contracts.
- Product-owned pipeline contracts and temporary compatibility files still
  used by the administrator server and release verification.

## Data pipeline boundary

Reusable data-pipeline infrastructure lives in the public
[Map Data Aggregation and Enhancement Pipeline](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline).
That repository owns reusable execution, adapter, state, artifact, and receipt
mechanics. This repository retains APizza/Taco business policy, canonical
schema, human review, and final publication authority.

The scheduled Pizza/Taco compatibility jobs now run from
`packages/food-runtime` in the external repository. That package preserves the
existing database and review behavior while the reusable executor is adopted
incrementally. This runtime relocation does not grant write authority to the
generalized shadow executor: external apply remains disabled there, and the
application still owns every database write contract and publication decision.

The administrator server reads external publication-status files; it does not
execute pipeline workers or publication commands. Operator handoffs explicitly
target the private external runtime workspace. Some historical manual tools and
shared product-policy helpers remain during cleanup, but they are not the
production scheduler owner. See [the pipeline
boundary](docs/PIPELINE_BOUNDARY.md) for the exact ownership, remaining
coupling, and activation rules.

## Local development

Use Node.js 22 or newer:

```sh
npm ci
npm start
```

The development server runs at `http://localhost:3000`:

- `/` — APizzaMichigan
- `/tacos` — TacoBoutMichigan
- `/admin/reviews` — authenticated editorial review portal

To run the local admin API in a second terminal:

```sh
cp .env.example .env
chmod 600 .env
# Fill only the server-side values needed for local administration.
npm run start:server
```

Only public or publishable credentials belong in browser-exposed variables.
Supabase secret/service-role keys, database passwords, administrator secrets,
and provider secrets are server- or host-only. Frontend-only development may
instead copy the public section of [.env.example](.env.example) to `.env.local`.
See [the security policy](SECURITY.md).

## Verification

```sh
npm run verify:release
npm run test:ops
npm run typecheck
npm run lint -- --quiet
CI=true npm test -- --watchAll=false --runInBand
npm run audit:public
```

The normal application build uses the committed aggregate dashboard snapshot
and does not query the production database. Refresh that snapshot deliberately
with `npm run build:refresh-stats`.

## Data and licensing

Do not add production extracts, provider downloads, review exports, photos,
logs, queue databases, checkpoints, or host deployment files. The private
repository still contains a small set of legacy record-level data files whose
removal or explicit licensing is a gate before public visibility. New tests
must use fabricated fixtures. See [DATA-LICENSE.md](DATA-LICENSE.md) and
[the public-release checklist](docs/PUBLIC_RELEASE.md).

A software license for this application repository has not yet been selected.
The separate pipeline repository is Apache-2.0 licensed.
