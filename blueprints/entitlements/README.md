# __SERVICE_NAME__

Central licensing and entitlement boundary for Trigenys products.

The service keeps product plans and feature access on trusted infrastructure so a modified desktop or web client cannot grant itself server-side capabilities simply by changing local UI state.

## Capabilities

- product plan and feature catalog;
- user or organization subscriptions;
- online feature checks;
- device activation records;
- short-lived Ed25519-signed offline grants;
- audit events for entitlement-changing operations;
- AppFactory Project Automation lifecycle and reusable release workflow.

## API

Public:

- `GET /health`
- `GET /.well-known/entitlement-public-key`

Server-to-server (`Authorization: Bearer $SERVICE_API_KEY`):

- `POST /v1/entitlements/check`
- `POST /v1/offline-grants/issue`

Admin automation (`Authorization: Bearer $ADMIN_API_KEY`):

- `PUT /v1/admin/catalog`
- `PUT /v1/admin/subscriptions`

## Bootstrap

1. Install dependencies with `npm install`.
2. Create the database: `npx wrangler d1 create __DATABASE_NAME__`.
3. Replace `REPLACE_AFTER_WRANGLER_D1_CREATE` in `wrangler.jsonc` with the returned database id.
4. Apply migrations: `npm run d1:migrate:remote`.
5. Configure Worker secrets: `ADMIN_API_KEY`, `SERVICE_API_KEY`, `LICENSE_PRIVATE_KEY_PKCS8_B64`, `LICENSE_PUBLIC_KEY_SPKI_B64`.
6. Run `npm run typecheck`, then deploy with `npm run deploy`.
7. Add the repository secret `PROJECT_TOKEN` and manually run `Project automation` once with an empty issue number to bootstrap the GitHub Project.

## Offline licensing rule

The desktop client gets only the Ed25519 public key. The private signing key remains a Worker secret. Offline grants expire after at most seven days and can be renewed only through trusted server infrastructure.

## Non-goals for v1

Billing-provider integration, direct end-user authentication, generic RBAC/ABAC and automatic deployment on merge are intentionally outside the first blueprint.
