# Home Server Ops Handoff

Use one pinned GitHub issue as the shared ops thread between Codex, the home-server agent, and the project owner. The issue is the control plane; Discord should only be used for human notifications.

## Roles

- Codex writes bounded command blocks, reviews reports, opens PRs, and decides the next safe step.
- The home-server agent runs machine-local commands and posts the generated Markdown reports back to the ops issue.
- The owner approves higher-risk actions such as long unattended runs, Supabase sync, credential changes, or service restarts.

## Standard Reports

Read-only system status:

```bash
node scripts/ops/home-status-report.mjs
```

Bounded classifier batch:

```bash
node scripts/ops/classifier-batch-report.mjs \
  --max-jobs 25 \
  --timeout-ms 240000 \
  --num-predict 80 \
  --temperature 0
```

The batch report runs only the classifier. It does not start scraper, sync, cron, keepalive, or coordinator.

## Report Posting Format

Post the script output as a comment on the pinned GitHub issue. Start comments with a short heading:

```md
## Home-server report: YYYY-MM-DD HH:MM UTC

<paste script output>
```

## Safety Rules

- Keep `main` clean and fast-forwarded before local operations.
- Prefer bounded `--max-jobs` classifier runs until the queue is proven stable.
- Do not run Supabase sync until Codex has reviewed recent local classification quality.
- Do not reset or delete queue state without an explicit command block.
- Do not commit runtime DBs, logs, token caches, `.env*`, or progress artifacts.

## Canonical Pull Step

```bash
cd /Users/ant/clawd/projects/apizzamichigan
git switch main
git pull --ff-only origin main
git status --short --branch
```
