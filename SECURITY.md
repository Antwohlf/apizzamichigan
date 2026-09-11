# Security policy

Do not include credentials, private business data, or production database
extracts in a public issue. While this repository remains private, invited
collaborators should contact the owner through an existing private channel.
When switching the repository to public, enable GitHub private vulnerability
reporting and verify the **Security → Advisories → Report a vulnerability**
route. GitHub does not currently expose that setting for this private repository;
it is part of the visibility transition, not a separate licensing prerequisite.

## Credential boundary

- Browser bundles may contain only credentials explicitly intended for public
  clients, such as a Supabase publishable key or legacy `anon` key protected by
  grants and row-level security.
- Supabase secret/service-role keys, database passwords, administrator secrets,
  provider API secrets, and SMTP credentials are server- or host-only.
- Never place a private value in a `REACT_APP_*`, `VITE_*`, or `NEXT_PUBLIC_*`
  variable.
- Local environment files, pipeline state, source extracts, reports, and
  deployment manifests must not be committed.

## Supported code

Security fixes are applied to the default branch. This project does not yet
publish versioned software releases.
