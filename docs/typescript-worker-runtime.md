# TypeScript/Wrangler brownfield Worker runtime

Status: supported reusable AppFactory infrastructure recipe  
Related: #107

## Purpose

AppFactory can provision a Cloudflare Worker for an **existing** Trigenys repository without copying Cloudflare credentials into that repository.

Use the `typescript-wrangler` runtime for small TypeScript APIs such as Hono backends that live beside a web application.

This is an infrastructure recipe, not a product-specific Commerce Factory path.

## Request contract

The canonical repository workflow calls:

`POST /infrastructure/worker`

with its GitHub Actions OIDC token and a body such as:

```json
{
  "repository": "Trigenys/example-webapp",
  "runtime": "typescript-wrangler",
  "pagesProject": "example-webapp"
}
```

The caller does **not** supply Cloudflare credentials.

Omitting `runtime` remains backward compatible and selects `python-pywrangler`.

## Reviewed TypeScript recipe

AppFactory owns the deployment recipe:

```text
root:   /backend
build:  npm install --ignore-scripts --no-audit --no-fund && npm run check
deploy: ./node_modules/.bin/wrangler deploy --config wrangler.production.jsonc --keep-vars
build environment: NODE_VERSION=24
```

The backend therefore owns:

- `backend/package.json`;
- a committed `backend/package-lock.json` is recommended after the first install, but is not required to bootstrap an existing repository;
- a `check` script that performs the repository's validation gate;
- a local `wrangler` development dependency;
- `backend/wrangler.production.jsonc`;
- the Worker source and product tests.

AppFactory does not execute an arbitrary build or deploy command supplied by a repository. A request that mixes the TypeScript runtime with another command is rejected.

## What is reused

The TypeScript runtime uses the same AppFactory control plane as existing brownfield Workers:

- GitHub Actions OIDC caller verification;
- repository/branch ownership checks;
- deterministic Worker name (`<repo>-api`, or staging variant);
- bootstrap Worker creation with rollback on partial failure;
- Cloudflare Workers Builds repository connection;
- build-token reuse/refresh;
- generated/runtime secret prefix isolation;
- optional Pages `VITE_API_BASE_URL` wiring;
- idempotent infrastructure ownership marker;
- build failure diagnostics.

No per-project Cloudflare API token is introduced.

## Marker compatibility

Existing markers that do not contain `runtime` are interpreted as `python-pywrangler`.

New TypeScript-managed Workers record:

```json
{
  "runtime": "typescript-wrangler"
}
```

Changing an already-owned Worker from Python to TypeScript (or the reverse) is an infrastructure identity mismatch and fails closed instead of silently replacing the runtime.

## Database boundary

The existing `python-alembic` migration gate is intentionally rejected for `typescript-wrangler`.

A TypeScript product may still use AppFactory-managed database provisioning or runtime secrets, but a reusable Node/Postgres migration gate must be introduced as a separate reviewed capability rather than pretending the Python Alembic recipe applies.

Commerce Factory is the first planned consumer of this runtime.
