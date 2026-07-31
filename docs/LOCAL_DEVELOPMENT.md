# Local Development Workflow

This project can be developed and tested without the home-server iMac.

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
