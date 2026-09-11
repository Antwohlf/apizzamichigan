# Public repository release

The owner has approved making the existing GitHub repository public, including
its committed website reviews and fallback content. Selecting a software reuse
license is not a publication prerequisite. Only concrete privacy/security
cleanup remains relevant; passing CI alone does not scan GitHub-retained history.

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

The ordinary current-tree audit passes with documented legacy exceptions.
The owner-approved review/fallback files (`src/data.js`, `src/data/frozenTacos.js`,
and `src/data/tacoPlaces.js`) no longer fail release checks solely because they
contain place records. They still receive all credential/private-topology checks.
A missing software `LICENSE` is no longer treated as a security failure.

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
retains 46 original pull-request head refs. The Home Server Ops issue #8 and its
five comments were deleted after exact private-backup verification. GitHub
confirms the issue is deleted and its comments are no longer available. The
retained PR refs/cached commits require a separate GitHub Support purge. The
request was submitted and acknowledged on September 11, 2026; GitHub's cleanup
is pending. The repository remains private until that retained material is
resolved. There is no remaining owner licensing decision blocking publication.

Use a fresh clone for further work; never merge or force-push the old history
back into the cleaned repository. Do not delete fallback data merely to make an
audit pass. Website deployment is described in [DEPLOYMENT.md](DEPLOYMENT.md).

## Remaining gates

- As part of switching visibility, enable and verify GitHub private vulnerability
  reporting, then update `SECURITY.md` with the active route. Its API currently
  returns 404 while this repository is private.
- Resolve the retained original pull-request refs and cached historical views
  with GitHub Support; a branch rewrite cannot remove these owner-read-only refs.
- Keep artifact-executor apply lanes separate from trusted-host production
  authority; do not enable an inert lane merely because host jobs have moved.
- Complete the final privacy review and repeat secret scanning on the actual
  publication candidate after the history/content decision.

Existing Git author identity is preserved as approved by the owner.

The visibility change happens only after a fresh clone passes both the normal
CI suite and the release-mode public audit.

Run `npm run audit:public:release` for the stronger current-tree gate. Neither
mode scans commits, remote branches, live database grants, or dependency
advisories. A clean result does not replace those separate release checks.
