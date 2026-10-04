# Service project blueprints

AppFactory can provision backend service repositories in addition to landing projects.

## Generic TypeScript API service

Use `preset: "typescript-api"` for backend/API products that need AppFactory repository governance without inheriting a product-specific cloud, database or domain model.

```http
POST /projects
Content-Type: application/json

{
  "name": "Payment Orchestrator",
  "slug": "payment-orchestrator",
  "projectType": "service",
  "preset": "typescript-api",
  "private": false
}
```

The generated repository includes Node.js 24, TypeScript, a minimal health endpoint, tests, CI, AppFactory Project Automation, manual release automation and RAIDER engineering guidance. Automatic semantic releases remain opt-in so a bootstrap commit cannot imply product release readiness. AppFactory deliberately leaves hosting, persistence, queues and runtime secrets unprovisioned for this preset so those choices can follow the product workload rather than the generator.

Repeated requests reconcile against the AppFactory service marker and return the existing managed repository instead of creating a duplicate.

The first supported service preset is `entitlements`, a central licensing and feature-entitlement boundary for Trigenys products.

## Provision an entitlement service

```http
POST /projects
Content-Type: application/json

{
  "name": "Trigenys Entitlement Service",
  "slug": "entitlement-service",
  "projectType": "service",
  "preset": "entitlements",
  "private": true
}
```

AppFactory creates the repository idempotently and materializes the versioned blueprint from `blueprints/entitlements/`. Service repositories do **not** use Cloudflare Pages: AppFactory provisions a D1 database and a Cloudflare Worker, connects the repository to native Workers Builds, applies D1 migrations through Wrangler in the production build, and triggers the first deployment.

The generated repository contains:

- a Cloudflare Worker API;
- a D1 migration for plan entitlements, subscriptions, device activations and audit events;
- online entitlement checks;
- Ed25519-signed short-lived offline grants;
- CI;
- AppFactory Project Automation configuration and zero-PAT OIDC broker workflow;
- the shared AppFactory release workflow;
- RAIDER agent instructions and failure-memory documentation.

## Responsibility split

```text
AppFactory
  -> creates/reconciles repository
  -> materializes service blueprint
  -> creates/reuses D1
  -> writes the D1 UUID into wrangler.jsonc
  -> creates/reuses the Worker
  -> connects native Workers Builds
  -> triggers the first production build

AppFactory Project Automation
  -> bootstraps/reconciles GitHub Project
  -> keeps Issue/PR lifecycle synchronized
  -> supplies reusable release workflow

Generated entitlement service
  -> owns entitlement evaluation
  -> owns catalog/subscription state
  -> issues signed offline grants
```

This split is intentional: repository provisioning stays in AppFactory while lifecycle governance stays in the reusable Marketplace Action.

Project Automation does not require a generated repository secret. The workflow exchanges GitHub Actions OIDC through the hosted AppFactory broker and never receives a long-lived `PROJECT_TOKEN`. Private Trigenys repositories use the broker owner's one-time private-repository OAuth authorization; that authorization is account-level broker state, not a credential copied into each service repository.

## Idempotency and brownfield safety

A repository with a valid `.appfactory/service.json` marker is treated as an existing managed service and a repeated provisioning request becomes a replay.

An unrelated repository with the requested slug is never overwritten. A temporary `.appfactory/service-provisioning.json` marker permits safe recovery if provisioning stopped after repository bootstrap but before the service blueprint commit. Cloudflare provisioning uses `.appfactory/cloudflare-provisioning.json` during reconciliation and writes `.appfactory/cloudflare.json` once the D1 identity is known. Existing Workers without that marker are not silently adopted.

## Blueprint source

The default source is the current AppFactory repository. Advanced deployments can override:

- `GITHUB_SERVICE_BLUEPRINT_OWNER`
- `GITHUB_SERVICE_BLUEPRINT_REPO`
- `GITHUB_SERVICE_BLUEPRINT_REF`

These settings allow service blueprints to move to a dedicated repository later without changing the public `POST /projects` contract.


## Cloudflare service provisioning

The `entitlements` preset uses the existing AppFactory Cloudflare account connection. No Cloudflare token is copied into the generated repository.

AppFactory reuses the Workers Builds authentication already attached to `appfactory-api` when possible. `CLOUDFLARE_BUILD_TOKEN_UUID` can explicitly select an existing build token UUID if discovery is ambiguous; `CLOUDFLARE_BUILD_TOKEN_SOURCE_WORKER` changes the discovery source Worker and defaults to `appfactory-api`.

The AppFactory Cloudflare API token must be able to perform the infrastructure operations it orchestrates:

- D1 Edit;
- Workers Scripts Edit;
- Workers Builds Configuration Edit;
- existing Pages permissions remain required for landing projects.

If one of these permissions is missing, AppFactory returns `CLOUDFLARE_TOKEN_PERMISSION_REQUIRED` with the required permission names. Extend the existing token rather than creating a second repository credential.

The production Workers Build runs:

```text
npm run d1:migrate:remote
        ↓
npx wrangler deploy
```

This deliberately leaves migration bookkeeping to Wrangler and D1's native `d1_migrations` mechanism rather than implementing a second migration engine inside AppFactory.

Product runtime secrets are **not** generated implicitly. `ADMIN_API_KEY`, `SERVICE_API_KEY`, the Ed25519 private key and its public key remain explicit post-provisioning configuration because silently generated credentials would be difficult to recover and rotate safely.


## Managed blueprint upgrades

Service repositories carry a versioned `.appfactory/service.json` marker. Replays on the current version remain no-op/idempotent.

A reviewed migration updates only an explicit AppFactory-owned file allowlist using the existing repository tree as its base. Versions 1 or 2 → 3 update Project Automation and the service marker only; application code, infrastructure configuration and product-specific changes are preserved. Version 3 promotes the reviewed immutable Project runtime `14d51168311c25f41d89df370c5e2ad2d5f42e83`. Future blueprint versions fail closed instead of being downgraded.
