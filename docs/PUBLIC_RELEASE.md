# Public repository release

The GitHub repository remains private while the following release gates are
completed. Passing normal CI is necessary but does not make the repository safe
to publish.

## Completed in the cleanup branch

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
  bounded display-only contract. This is a code boundary, not a production
  cutover.

## Remaining gates

- Choose and add the application's software license.
- Enable and verify a private vulnerability-reporting route, then update
  `SECURITY.md` with that exact route.
- Preserve, checksum, and move the six legacy resume files to private host
  state; make their consumers use the migrated location or fail closed before
  removing the tracked copies.
- Remove, synthesize, or explicitly license the remaining first-party fallback,
  personal-review, and OSM-derived record files.
- Copy concrete iMac runbooks and service definitions to private host storage,
  verify them against the live host, then sanitize their checked-in examples.
- Reconcile the live Taco authority and every active legacy writer before
  selecting any external status or apply lane.
- Stop every legacy queue consumer, back up the SQLite queue, and complete its
  entity-identity schema migration offline; ordinary worker startup must never
  rewrite the live queue under old binaries.
- Make Supabase grants and row-level security reproducible from migrations and
  verify the public client with `anon` integration tests.
- Remove or server-route the legacy browser-side administrator writes.
- Resolve high-severity production dependency advisories.
- Run an authoritative secret and privacy scan against a fresh mirror clone.
- Rewrite retained Git history to remove generated data and private operations
  details; prune obsolete remote branches before changing visibility.
- Decide whether the historical non-noreply author email may remain public.

The visibility change happens only after a fresh clone passes both the normal
CI suite and the release-mode public audit.
