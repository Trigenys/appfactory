# GitHub Actions database lease for Trigenys SEO Monitor

## Why

Product Identity's Node-free Cloudflare Worker uses the AppFactory-managed
Hyperdrive profile; the SEO Monitor scheduled Node.js job instead runs in
GitHub Actions. Cloudflare Hyperdrive bindings cannot directly be accessed
from the GitHub runner, and a GitHub `GITHUB_TOKEN` cannot write repository
Actions secrets.

Instead, AppFactory now issues a tightly scoped **ephemeral delivery** of the
Neon database connection to the trusted GitHub Actions job. No PostgreSQL
password is stored in GitHub, checked into source, or exposed to the landing.

## Trust boundaries

1. The job uses GitHub OIDC (`core.getIDToken("appfactory-api")`) and HTTPS
   `POST /infrastructure/database-lease`. Its request body contains only
   `{"repository":"Trigenys/trigenys-seo-monitor"}`.
2. AppFactory validates GitHub's signed OIDC identity with its existing JWT
   verifier. Only `Trigenys/trigenys-seo-monitor`, workflow
   `.github/workflows/seo-monitor.yml` on `refs/heads/main`, for
   `schedule` or `workflow_dispatch`, is authorized.
3. AppFactory reads the dedicated secret
   `APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL` from its **own Cloudflare
   Worker runtime environment**. It does not accept any caller-supplied
   database name, connection URL, or profile identifier.
4. The lease requires a PostgreSQL connection for `seo_monitor`, owner
   `seo_monitor_owner`, and a `*.neon.tech` database host. It is delivered
   over HTTPS with `Cache-Control: no-store`.
5. The GitHub job masks the URL with `core.setSecret` and makes it available
   only within the short-lived job. The collector itself explicitly enforces
   PostgreSQL TLS certificate verification.
6. Failures return only named error codes. **The URL and credentials must
   never appear in AppFactory logs, GitHub logs, PRs, or issue bodies.**

This new secret is independent of `HYPERDRIVE_DATABASE_PROFILES` used by
Product Identity. Updating the SEO Monitor secret therefore cannot overwrite
Product Identity's or Editorial OS's existing database connection profiles.

## Automated Neon → Cloudflare bootstrap

AppFactory can now populate its own private database secret using the
existing Worker secret helpers `listSecretNames` / `putSecret`. A
one-time `NEON_API_KEY` is required as a **private Worker Secret** in
`appfactory-api`. The ChatGPT Neon connector is not automatically
delegated to the Cloudflare account.

A manually dispatched SEO Monitor `full` workflow calls the protected
`POST /infrastructure/neon` endpoint, which verifies the existing Neon
role/database and stores `APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL`
**only if missing**. Product Identity's Hyperdrive profile is untouched.

No manual PostgreSQL URL copy into Cloudflare or GitHub is necessary.
See [managed Neon provisioning](neon-managed-provisioning.md) for security,
allowlisting and future project patterns.

## Operational smoke test

1. In SEO Monitor GitHub Actions, dispatch `verify`. It should still succeed
   even if the Neon lease secret is missing (Google-only verification).
2. Add the `NEON_API_KEY` Worker secret once, then dispatch `full`; the target DB connection secret is populated automatically.
3. The full job requests its OIDC-scoped connection at runtime, writes
   Search Console and sitemap observations into `seo_monitor`, then exits.
4. Query the dedicated Neon database for the `seo_monitor_runs` table and a
   nonempty most recent payload. No real SEO run is claimed before this check.
5. Scheduled job runs at 06:30 UTC (07:30 Cameroon time) and uses the same
   source and identity. The Monday report remains part of the collector.

## Limitations

The database URL is a credential in transit in the **trusted** GitHub runner.
AppFactory does not magically turn PostgreSQL passwords into passwordless
tokens, and the Workload Identity Federation set up for Google only authorizes
Google APIs. This design avoids long-lived GitHub copies but requires the Neon API key
as one initial private Cloudflare Worker secret. Restrict repository write/Actions permissions and
rotate the Neon role password if authorization boundaries are compromised.

The current lease is scoped to SEO Monitor. Generalizing to other repositories
requires explicit security review and separate repo-specific secrets, not
broadening this endpoint to arbitrary names.
