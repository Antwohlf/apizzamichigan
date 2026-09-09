# Public repository release

The GitHub repository remains private while the following release gates are
completed. Passing normal CI is necessary but does not make the repository safe
to publish.

## Completed cleanup

- Generated metadata-review outputs and stale status/conversation artifacts are
  removed from the current tree and ignored. Six authoritative legacy resume
  files remain temporarily because deleting them before host migration would
  restart write-capable jobs; the release audit rejects them.
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

## Audit snapshot — September 9, 2026

The repository is still private. The ordinary current-tree audit passes with
documented legacy exceptions; the release audit fails. Known remaining files:

- Six tracked resume files: `.taco-metadata-progress.json`,
  `scripts/.pizza-metadata-progress.json`, `scripts/.state-import-progress.json`,
  `scripts/.taco-state-import-progress.json`, and
  `scripts/.address-enrichment-{pizza_places,taco_places}.json`.
- Record-level data: `scripts/osm-pizza-import.sql`, `src/data.js`,
  `src/data/frozenTacos.js`, and `src/data/tacoPlaces.js`.
- The application's `LICENSE` is missing.

The production-dependency scan (`npm audit --omit=dev`) reports 13 affected
packages: seven high, four moderate, two low, and no critical findings. This is
a dependency advisory inventory, not proof that each issue is reachable in the
deployed app. Review and test updates separately; do not force major upgrades
as part of documentation cleanup.

Runtime queue cutover does not by itself prove that these six separate legacy
manual-tool checkpoints can be discarded. Preserve and reconcile each consumer
before removal. Do not delete fallback data merely to make an audit pass.

## Remaining gates

- Choose and add the application's software license.
- Enable and verify a private vulnerability-reporting route, then update
  `SECURITY.md` with that exact route.
- Preserve, checksum, and move the six legacy resume files to private host
  state; make their consumers use the migrated location or fail closed before
  removing the tracked copies.
- Remove, synthesize, or explicitly license the remaining first-party fallback,
  personal-review, and OSM-derived record files.
- Finish sanitizing archived operator code, and confirm no additional topology
  or record-level files exist outside the audit's known-path inventory.
- Keep artifact-executor apply lanes separate from trusted-host production
  authority; do not enable an inert lane merely because host jobs have moved.
- Make Supabase grants and row-level security reproducible from migrations and
  verify the public client with `anon` integration tests.
- Remove or server-route the legacy browser-side administrator writes.
- Resolve high-severity production dependency advisories.
- Run an authoritative secret and privacy scan against a fresh mirror clone.
- Review retained history and remote branches for generated data and private
  operations details. Obtain explicit approval and a backup/clone-transition
  plan before rewriting history or deleting remote branches.
- Decide whether the historical non-noreply author email may remain public.

The visibility change happens only after a fresh clone passes both the normal
CI suite and the release-mode public audit.

Run `npm run audit:public:release` for the stronger current-tree gate. Neither
mode scans commits, remote branches, live database grants, or dependency
advisories. A clean result does not replace those separate release checks.
