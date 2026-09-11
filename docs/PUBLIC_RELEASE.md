# Public repository release

The GitHub repository remains private while the following release gates are
completed. Passing normal CI is necessary but does not make the repository safe
to publish.

## Completed cleanup

- Generated metadata-review outputs and stale status/conversation artifacts are
  removed from the current tree and ignored. Six authoritative legacy resume
  files are preserved in private local and host storage with matching SHA-256
  checksums and removed from this tree. The unused generated OSM SQL import is
  also privately backed up and removed.
- Local browser automation, editor settings, outputs, backups, and runtime
  artifacts are ignored.
- The public project overview, security policy, contribution rules, data
  boundary, environment template, and current-tree audit are present.
- The existing modified development checkout is preserved separately.
- The app/pipeline interface is explicit: entity-specific target inventories
  are inert, external write allowlists are empty, and administrator status is a
  bounded display-only contract. Pizza and Taco production jobs now run from
  the separate pipeline repository, with successful source and publication
  cycles verified for both products.
- The live queue's entity-identity migration completed offline with a verified
  backup, preserving all jobs and retry history. The old worker schedules and
  duplicate active worker implementations have been removed from this tree.
- Concrete host runbooks were preserved in private operational storage and
  replaced by handoffs to the external runtime. The remaining read-only health
  template now uses explicit placeholders, not a real host path.
- Boundary documentation distinguishes the live trusted-host publishers from
  the older inert artifact/apply inventories. Taco's disabled legacy status lane
  does not mean its scheduled pipeline is disabled.
- Legacy manual tools require `PRIVATE_PIPELINE_STATE_DIR` to name an existing
  absolute directory outside the checkout. Missing, corrupt, or symlinked
  checkpoints abort; trackers cannot save before a successful load. Restore the
  six original checkpoint basenames into that directory, not the source tree.
  These guards do not change the separate live pipeline's state or schedules.
- The admin form's Pizza/Taco/frozen writes use the authenticated Express API,
  not public Supabase mutations. Pizza/Taco photo metadata is entity-scoped.
  The current frozen schema does not support photos; its UI says so explicitly.
  As before, administration requires the separately running Express server;
  static hosting alone does not supply admin API routes.
- The public-client grant migration was applied and verified on September 10.
  Anonymous API reads of the canonical public columns still return rows; full
  rows, internal columns, backup rows, and suggestion reads are denied. Core
  tables have no anonymous/authenticated write grants; the existing three-field
  Pizza suggestion insert remains. Trusted publisher permissions are unchanged.

## Database verification

`supabase/migrations/20260910165538_harden_public_client_grants.sql` hardens the
existing schema; it is not a complete fresh-database bootstrap. Run the
review-photo schema prerequisite when provisioning that metadata table. The
migration preserves existing RLS policies and enables RLS on each affected table.

Run `node scripts/ops/verify-public-client.mjs` with `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_ANON_KEY` supplied privately. It rejects privileged keys, never
prints records, and performs only reads. Database catalog checks separately
verify write grants and service-role-only synchronization RPC execution.

The security advisor still reports a Postgres patch upgrade and `pg_trgm` in
the public schema. These require a planned maintenance review, not an automatic
database upgrade during repository publication. Two no-policy informational
findings correspond to deliberately closed tables. Table/sequence defaults
are narrowed for future objects created by `postgres`; other owners' defaults
and each new function's EXECUTE grants still require explicit review.

## Audit snapshot — September 11, 2026

The repository is still private. The ordinary current-tree audit passes with
documented legacy exceptions; the release audit fails. Known remaining files:

- Record-level data: `src/data.js`,
  `src/data/frozenTacos.js`, and `src/data/tacoPlaces.js`.
- The application's `LICENSE` is missing.

After compatible locked dependency updates, the production-dependency scan
(`npm audit --omit=dev`) reports five affected packages: zero high, three
moderate, two low, and no critical findings. The remaining packages are
`express`, `body-parser`, `qs`, `@supabase/supabase-js`, and `@supabase/auth-js`. This is
a dependency advisory inventory, not proof that each issue is reachable in the
deployed app. Review and test updates separately; do not force major upgrades
as part of documentation cleanup.

The existing repository's 18 branches were sanitized in place after a verified
private mirror backup. Eleven identified operational artifact paths were removed
throughout history, and known personal machine references were replaced with
neutral examples. No branches were deleted. Commit authors, timestamps, and
topology were preserved; commit IDs changed. Application code and assets were
preserved. A separate CI fix handles unavailable pre-rewrite comparison commits
without fetching removed history.

Gitleaks 8.30.1 scanned the locally rewritten refs and reported 12 occurrences
of one reviewed public Supabase `anon` key, not a privileged credential. A fresh
GitHub clone verified the selected private paths and machine references were
absent from branch history. This is not a full privacy clearance: GitHub still
retains 46 original pull-request head refs, and issue #8 contains private
operational material. A GitHub Support assessment request is drafted but has not
been submitted. No issue bodies or comments have been changed.

Use a fresh clone for further work; never merge or force-push the old history
back into the cleaned repository. Do not delete fallback data merely to make an
audit pass. Website deployment is described in [DEPLOYMENT.md](DEPLOYMENT.md).

## Remaining gates

- Choose and add the application's software license.
- Enable and verify a private vulnerability-reporting route, then update
  `SECURITY.md` with that exact route.
- Remove, synthesize, or explicitly license the remaining first-party fallback,
  personal-review record files.
- Resolve the retained original pull-request refs and cached historical views
  with GitHub Support; a branch rewrite cannot remove these owner-read-only refs.
- Redact or remove private operational material in issue #8 and its comments,
  including any retained edit history. Private backups are already preserved.
- Keep artifact-executor apply lanes separate from trusted-host production
  authority; do not enable an inert lane merely because host jobs have moved.
- Complete the final privacy review and repeat secret scanning on the actual
  publication candidate after the history/content decision.
- Decide whether the historical non-noreply author email may remain public.

The visibility change happens only after a fresh clone passes both the normal
CI suite and the release-mode public audit.

Run `npm run audit:public:release` for the stronger current-tree gate. Neither
mode scans commits, remote branches, live database grants, or dependency
advisories. A clean result does not replace those separate release checks.
