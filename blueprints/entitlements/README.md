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

AppFactory provisions the D1 database, writes the real database UUID into `wrangler.jsonc`, connects this repository to native Cloudflare Workers Builds and triggers the first production build. The production build runs remote D1 migrations before `wrangler deploy`.

Remaining operator-owned configuration:

1. Configure Worker secrets: `ADMIN_API_KEY`, `SERVICE_API_KEY`, `LICENSE_PRIVATE_KEY_PKCS8_B64`, `LICENSE_PUBLIC_KEY_SPKI_B64`.
2. Reuse an existing project-capable `PROJECT_TOKEN` if one is already available to this repository, then manually run `Project automation` once with an empty issue number to bootstrap the GitHub Project.
3. For local development only, run `npm install`, `npm run d1:migrate:local` and `npm run dev`.

Do not create a second Cloudflare deployment token in this repository. Cloudflare delivery is owned by the Workers Builds connection provisioned by AppFactory.

## Offline licensing rule

The desktop client gets only the Ed25519 public key. The private signing key remains a Worker secret. Offline grants expire after at most seven days and can be renewed only through trusted server infrastructure.

## Non-goals for v1

Billing-provider integration, direct end-user authentication and generic RBAC/ABAC are intentionally outside the first blueprint.
