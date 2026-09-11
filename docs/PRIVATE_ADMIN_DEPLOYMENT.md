# Private Pizza/Taco administration

The public Vercel website does not host the local-database administrator API.
Run the existing admin UI and API together on the trusted iMac, privately over
Tailscale with HTTPS. Do not expose the service using Tailscale Funnel or public port
forwarding. The existing admin password is still required on the private network.

## Release and configuration

Use a clean, pinned release of this repository with `npm ci` and `npm run build`.
Do not update or merge an old checkout containing pre-cleanup history. Keep the
prior release for rollback. Keep private runtime state and the mode-0600 `.env`
outside the release checkout, in a mode-0700 directory.

The service working directory owns that `.env`. It supplies the existing admin
password, a separate session signing secret, existing Supabase admin credentials,
and the dedicated local PostgreSQL login. Never copy a pipeline worker's complete
environment. No source-provider tokens or worker queue files are needed.

Set `NODE_ENV=production`, `ADMIN_PUBLIC_ORIGIN` to the private HTTPS origin,
`ADMIN_WEB_ROOT` to the release's `build` directory, and `APP_RELEASE` to its commit.
Set `FOOD_PIPELINE_REPORT_ROOT` to the external runtime's real `reports` directory
and `FOOD_PIPELINE_STATUS_ROOT` to its `scripts` directory. These are read-only
inputs; old or rejected artifacts are not current queue counts.

Start the pinned release's `server/private-host.cjs` from the private working
directory under the host's process supervisor. Its HTTP listener binds only to `127.0.0.1:5050`.
Configure a private HTTPS reverse proxy to that port, preserving the host and
forwarded protocol. The server trusts only loopback proxies and rejects
cross-origin state-changing requests. Keep both frontend and API on that origin.
The UI entrypoint is `/admin/reviews`; `/healthz` identifies the running release.

### Direct private HTTPS alternative

Some macOS Tailscale installations cannot persist Serve configuration because of
[a Keychain storage error](https://github.com/tailscale/tailscale/issues/19933).
Do not disable state encryption or reset Tailscale to work around this.
Instead, obtain a certificate using `tailscale cert` into the private runtime
directory, with the key mode 0600. Set all four `ADMIN_TLS_*` settings: the host's
Tailscale IPv4 address, an unprivileged port such as 8443, and absolute certificate
and key paths. Include the same port in `ADMIN_PUBLIC_ORIGIN`.

This adds HTTPS bound only to the specified tailnet address, never a wildcard or
LAN interface. The server validates the hostname, validity dates, key pair, and
key permissions. Run `tailscale cert` daily under the host supervisor with
`--min-validity=720h` and explicit output paths. The service reloads valid renewed
certificates every minute without restarting the API. Verify expiry and renewal
output during host maintenance; issuance failures must not be ignored.

## Database permissions

Before startup, verify the existing app schema, including
`scripts/enrichment/source-review-decision-history-schema.sql` and
`scripts/enrichment/local-lifecycle-history-migration.sql`. Apply missing schema
with the database owner during a separate migration, never from an HTTP request.

Create a dedicated login without superuser, database creation, role creation,
replication, bypass-RLS, object ownership, or inherited worker roles. Apply
`infra/admin/local-role.sql` with psql's `admin_role` and `admin_database` variables.
Use bounded connection, statement, idle-transaction, and lock timeouts.
Scope host authentication for that login to the product database, rejecting
other databases before generic rules. Preserve existing roles' rules and verify
wrong-password and wrong-database connections fail after reload. CONNECT grants
alone do not override a database's default PUBLIC access.

The role can read and edit the two products' canonical places and review evidence,
and append audit records. It cannot delete/truncate tables, change schemas, or
read processing caches/queues. UPDATE permission permits the existing import
table lock; ownership is unnecessary. See PostgreSQL's
[LOCK permissions](https://www.postgresql.org/docs/16/sql-lock.html).
Supabase-backed editorial and photo operations retain the existing server-only
service credential and application validation; this deployment does not change
those grants or public views.

## Verification and rollback

Verify the supervisor PID and release health, anonymous rejection, invalid-login
rejection, valid login with secure cookies, both entity-specific queues, source
provenance, and external review/publication status. Verify the private UI in a
browser. Confirm that the public website still works and that no pipeline worker
was restarted. Do not create a real review decision merely to test deployment.

For rollback, stop only the admin service, select the previous release and saved
configuration, and restart it. Keep the existing database and current pipeline
state; do not restore stale data. A first deployment can be rolled back by
unloading only the admin supervisor entry and removing its private proxy route.
For direct HTTPS, also unload its certificate-renewal job. Do not disable the
host's Tailscale connection or remove another service's configuration.
Store host paths, credentials, and deployment evidence privately, not in Git.
