# Service project blueprints

AppFactory can provision backend service repositories in addition to landing projects.

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

AppFactory creates the repository idempotently and materializes the versioned blueprint from `blueprints/entitlements/`. It does **not** create a Cloudflare Pages project for service repositories.

The generated repository contains:

- a Cloudflare Worker API;
- a D1 migration for plan entitlements, subscriptions, device activations and audit events;
- online entitlement checks;
- Ed25519-signed short-lived offline grants;
- CI;
- AppFactory Project Automation configuration and workflow;
- the shared AppFactory release workflow;
- RAIDER agent instructions and failure-memory documentation.

## Responsibility split

```text
AppFactory
  -> creates/reconciles repository
  -> materializes service blueprint

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

## Idempotency and brownfield safety

A repository with a valid `.appfactory/service.json` marker is treated as an existing managed service and a repeated provisioning request becomes a replay.

An unrelated repository with the requested slug is never overwritten. A temporary `.appfactory/service-provisioning.json` marker permits safe recovery if provisioning stopped after repository bootstrap but before the service blueprint commit.

## Blueprint source

The default source is the current AppFactory repository. Advanced deployments can override:

- `GITHUB_SERVICE_BLUEPRINT_OWNER`
- `GITHUB_SERVICE_BLUEPRINT_REPO`
- `GITHUB_SERVICE_BLUEPRINT_REF`

These settings allow service blueprints to move to a dedicated repository later without changing the public `POST /projects` contract.
