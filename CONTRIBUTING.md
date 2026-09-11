# Contributing

Thank you for helping improve APizzaMichigan and TacoBoutMichigan.

## Development

Use Node.js 22 or newer, install the locked dependencies, and run the complete
local verification before opening a pull request:

```sh
npm ci
npm run verify:release
npm run test:ops
npm run typecheck
npm run lint -- --quiet
CI=true npm test -- --watchAll=false --runInBand
npm run audit:public:release
```

The repository is public. Both audit commands reject private runtime state and
host details; release mode also rejects unapproved record-level extracts.
See [public repository maintenance](docs/PUBLIC_RELEASE.md) for audit scope and
the history-cleanup notice.

## Data and operations safety

- Use fabricated fixtures in tests. Do not contribute production database rows,
  source downloads, review exports, photos, logs, checkpoints, or queue files.
- Do not commit hostnames, home-directory paths, schedules, credentials, or
  installed service definitions.
- Commands that can mutate canonical or public data must remain dry-run by
  default and require an explicit apply flag.
- Product policy belongs in this repository. Reusable execution, adapter, and
  state-management changes belong in the external pipeline repository.

See [the pipeline boundary](docs/PIPELINE_BOUNDARY.md) before changing data
ingestion, review, enrichment, or publication code.
