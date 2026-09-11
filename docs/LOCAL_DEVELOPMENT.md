# Local Development Workflow

This project can be developed and tested without the home-server iMac.

## Run the website

Use Node.js 22 or newer:

```sh
npm ci
npm start
```

The React development server serves the public app at `http://localhost:3000`.
Use `.env.example` as a reference for an untracked `.env.local`; keep private
provider and database credentials out of browser-prefixed variables.

The public maps do not need a locally running pipeline. Administration and
server-backed features require the separately configured Express server. Supply
its settings in the process environment or an untracked `.env` and start it in
a second terminal with `npm run start:server` (port 5050). The React development
proxy forwards API requests there. Do not point local write-capable tools at
production data as part of UI development.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full test and audit checklist.

## Safe checks

```bash
npm run local:pipeline-report
npm run local:fixture-pipeline
npm run test:ops
```

The fixture pipeline uses checked-in sample source rows and is read-only. It
does not connect to Postgres, write the enrichment queue, promote fields, or
sync Supabase.

## Local model roles

The matching design uses three routes:

- **Fast model:** normalize names and assess straightforward candidates.
- **Judge model:** inspect borderline candidates where evidence is mixed.
- **Human:** decide replacements, identity conflicts, and cases with missing
  evidence.

`scripts/lib/local-llm-router.mjs` contains the side-effect-free routing rule.
The LLM demo remains opt-in and uses Ollama only; it does not mutate project
data.

## Production boundary

The local workflow is for UI development, contract tests, and model demos.
Canonical Postgres changes and Supabase publication remain separate guarded
operations on the home-server pipeline.
