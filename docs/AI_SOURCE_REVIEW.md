# AI-Assisted Source Review

The source-review queue can use a local LLM to assist with multilingual names,
transliterations, abbreviations, and brand aliases. The first implementation is
strictly read-only.

## Decision contract

The model returns one of:

- `same_place`: likely safe to link, subject to a later approval policy
- `different_place`: likely not the same business
- `business_replacement`: same location may now contain a different business; always human review
- `uncertain`: insufficient or conflicting evidence; human review

The model also returns confidence, a short explanation, supporting evidence, and
whether human review is required. The runner always forces human review for
anything other than `same_place` and never changes personal history.

Structured identity evidence is evaluated before Ollama:

- A matching Wikidata **brand** ID plus coincident location becomes a high-confidence same-place suggestion, but remains human-gated.
- A matching Wikidata **operator** ID is only an uncertain suggestion because an operator can run multiple businesses.
- A matching brand ID with conflicting Latin names is treated as uncertain because it may indicate stale data or a replacement.
- Translated or alternate-script names without structured identity evidence remain human review.

## Dry-run command

Run locally with the same database tunnel used by the admin server:

```bash
LOCAL_DB_HOST=127.0.0.1 LOCAL_DB_PORT=15432 \
LOCAL_DB_NAME=pizza_enrichment LOCAL_DB_USER=ant \
OLLAMA_HOST=http://127.0.0.1:11434 \
OLLAMA_MODEL=llama3.2:latest \
node scripts/ops/ai-source-review-triage.mjs --entity pizza --limit 10 --json
```

This reads pending ambiguous rows and asks Ollama for a judgment. It does not
write to PostgreSQL, SQLite, provenance, the review queue, or Supabase.

After reviewing a dry-run, `--cache` stores only the advisory assessment in the
local `source_review_ai_assessments` table so the admin page can display it. It
does not change the queue decision or canonical place:

```bash
node scripts/ops/ai-source-review-triage.mjs \
  --entity pizza --limit 10 --cache --json
```

To inspect one known row without scanning the queue:

```bash
node scripts/ops/ai-source-review-triage.mjs \
  --entity pizza --ids 64163 --json
```

## Why this stays separate from automatic linking

LLMs are useful for language and context, but they can be wrong about business
replacements and nearby businesses. Any future apply mode must require:

1. deterministic evidence thresholds,
2. a confidence threshold,
3. an audit record containing the prompt model and evidence,
4. a sample review before bulk application, and
5. an absolute human gate for replacements or personal-history records.

## Verified Behavior

The iMac dry-run was verified against real pending rows:

- `Royal Host` / `ロイヤルホスト`: high-confidence same-place suggestion from matching brand Wikidata ID and coincident coordinates; still human-gated.
- `Silks Hotel Group` / `達美樂披薩`: operator-only identity; uncertain and human-gated.
- `The Coffee Bean & Tea Leaf` / `Pizza Hut Ristorante`: conflicting Latin names despite a brand-ID collision; uncertain and human-gated.
- When Ollama returned malformed output or timed out, the runner returned `uncertain` and made no write.

The current local models are therefore suitable for review assistance and
prioritization, not unattended bulk decisions.
