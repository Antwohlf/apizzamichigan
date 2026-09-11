# Public repository maintenance

The existing APizzaMichigan repository became public on September 11, 2026.
Private vulnerability reporting is enabled; use the route in [SECURITY.md](../SECURITY.md).
The owner approved publication of the committed website content. See
[NOTICE](../NOTICE) and [DATA-LICENSE.md](../DATA-LICENSE.md) for reuse boundaries.

## Repository hygiene

Run `npm run audit:public:release` before publishing changes. It checks tracked
files for credentials, private host details, and operational artifacts. Keep
environment files, database extracts, queues, checkpoints, reports, and host
deployment inventories outside the repository. Tests use fabricated fixtures.
Do not remove authored website data merely to make an audit pass.

The audit does not inspect Git history, live database permissions, or dependency
advisories. Those require separate, appropriately scoped checks. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the normal verification commands.

## September 2026 history cleanup

The existing branches were sanitized after a verified private backup. Identified
operational artifacts and personal machine references were removed from branch
history; authors, timestamps, and commit relationships were preserved. Commit
IDs changed. Use a fresh clone for development, and transfer reviewed patches
instead of merging an old checkout back into `main`.

GitHub may still serve older commits through retained pull-request references
or caches. The owner accepted that residual historical exposure and closed the
support request. No complete server-side purge is claimed or required for the
current public status. Do not reopen that request or contact support without
explicit owner approval.

## Database boundary

`supabase/migrations/20260910165538_harden_public_client_grants.sql` hardens the
existing schema; it is not a fresh-database bootstrap. Preserve the app-owned
schema, grants, RLS policies, and guarded publication RPCs when cleaning code.
See [the database migration runbook](SUPABASE_PUBLIC_MIGRATION_RUNBOOK.md).

For a separately authorized read-only public-client check, run
`node scripts/ops/verify-public-client.mjs` with `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_ANON_KEY` supplied privately. It rejects privileged keys and
does not print records. Repository cleanup must not run apply-mode database
commands or alter the separately deployed pipeline.

Website deployment is documented in [DEPLOYMENT.md](DEPLOYMENT.md).
