# Repository structure

This is the product application repository for APizzaMichigan and
TacoBoutMichigan. Reusable data-pipeline infrastructure is developed in the
separate
[Map Data Aggregation and Enhancement Pipeline](https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline).

## Application-owned areas

```text
src/                 public and administrator React interfaces
public/              browser assets and aggregate dashboard snapshot
api/                 serverless-style public API handlers
server/              authenticated editorial API, product policy, input adapters
config/              product profiles, taxonomies, and data authority policy
scripts/enrichment/  product schema plus compatibility code still used by app checks
scripts/ops/         product verification and app/server compatibility reports
docs/                public architecture and contributor documentation
```

The application owns its canonical schema, public views, guarded write RPCs,
APizza/Taco business policy, human review decisions, and publication authority.

## External pipeline-owned areas

The external repository owns reusable adapters, execution, admission, retry,
checkpoint, artifact, receipt, and profile-isolation mechanics. It also owns
the extracted `packages/food-runtime` compatibility runtime used by the current
scheduled Pizza/Taco jobs. Product source selection and transformations remain
separate profile components even when they share an adapter implementation.

The application must integrate with that runtime only through versioned
database, status, and receipt contracts. Browser and server code must not
import pipeline runtime packages directly.

## Residual compatibility code

The website and administrator server do not import `scripts/` or pipeline
runtime packages. Editorial lifecycle rules and human-gated identity guidance
live in `server/product/`; optional manual review CLIs depend on those product
rules, not the other way around.

The admin app reads canonical review tables and explicitly configured external
status/report inputs. The report adapter lives in `server/integrations/`, with
its compatibility interface in `contracts/food-review-artifacts.v1.json`.
It does not inspect worker queues, provider credentials, Python environments,
or raw OSM inputs. See [the boundary](PIPELINE_BOUNDARY.md) for configuration.

Some manual compatibility utilities and their checks remain in `scripts/`.
They are not dependencies of the running website/admin API, and do not own
production schedules. Their presence does not require installing the pipeline
repository alongside the website.

The retired bulk import scripts and archived worker framework have been removed.
Historical implementations remain recoverable in Git history; they are not
installation instructions. Do not restore them as website-owned jobs.

## Guardrails

- Do not commit environment files, logs, queue databases, source extracts,
  progress files, reports, checkpoints, photos, or host deployment manifests.
- Keep `package.json` marked private to prevent accidental npm publication.
- Never run an apply-mode data command as part of a repository refactor.
- Keep product policy and database contracts here; put generic runtime behavior
  in the external pipeline repository.
- Move one writer scope at a time and never permit legacy and replacement
  writers to overlap.

See [PIPELINE_BOUNDARY.md](PIPELINE_BOUNDARY.md) for the full ownership contract.
