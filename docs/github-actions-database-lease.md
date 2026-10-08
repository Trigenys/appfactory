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

## One-time secret setup in Cloudflare

The `seo_monitor` database and role already exist in the Neon Free project
`little-frog-93793324`, branch `br-twilight-star-b2orr8hw`.

In Cloudflare, open Workers & Pages → `appfactory-api` → Settings →
**Variables and Secrets** and add a **new Secret**:

- Name: `APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL`
- Value: the Neon connection string from the `seo_monitor` database,
  `seo_monitor_owner` role, `production` branch.
- Do not modify `HYPERDRIVE_DATABASE_PROFILES` or commit the value to source.
- Ensure the Worker deployment is active before running SEO Monitor `full`.

The Neon connection includes a password; do not send it in a chat message or
screenshot. After initial setup, rotation is performed by replacing only this
Cloudflare secret. If you have no Cloudflare admin/browser access, provisioning
stops cleanly with `DATABASE_LEASE_NOT_CONFIGURED`.

## Operational smoke test

1. In SEO Monitor GitHub Actions, dispatch `verify`. It should still succeed
   even if the Neon lease secret is missing (Google-only verification).
2. Dispatch `full` only after the AppFactory secret exists.
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
Google APIs. This design avoids long-lived GitHub copies but still requires one
Cloudflare Worker secret. Restrict repository write/Actions permissions and
rotate the Neon role password if authorization boundaries are compromised.

The current lease is scoped to SEO Monitor. Generalizing to other repositories
requires explicit security review and separate repo-specific secrets, not
broadening this endpoint to arbitrary names.
