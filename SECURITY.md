# Security policy

Do not include credentials, private business data, or production database
extracts in a public issue. While this repository remains private, invited
collaborators should contact the owner through an existing private channel.
A verified private reporting address or GitHub private-vulnerability-reporting
flow must be added before repository visibility changes.

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
