# Web application blueprints

AppFactory provisions reusable web application repositories through `projectType: "webapp"`.

The first preset is a deliberately small React foundation:

```json
{
  "name": "Product Console",
  "slug": "product-console",
  "projectType": "webapp",
  "preset": "react-vite",
  "private": true
}
```

## Baseline

The `react-vite` preset generates:

- React 19;
- TypeScript;
- Vite;
- Node.js 24 CI;
- AppFactory Project Automation using the zero-PAT OIDC broker;
- a versioned `.appfactory/webapp.json` marker;
- a minimal responsive application shell;
- RAIDER-oriented engineering instructions.

## What it does not guess

A generic web application blueprint should not silently choose architecture that belongs to the product.

The preset therefore does **not** automatically select:

- a backend framework;
- a database;
- authentication;
- a state-management library;
- a component library;
- analytics;
- a hosting provider;
- a video-rendering runtime.

Those are added by the generated product when concrete requirements justify them.

This distinction matters for workloads such as Remotion rendering: the frontend may be a Vite application while rendering jobs require a Node-compatible compute boundary that would be inappropriate to force into Cloudflare Pages.

## Provisioning behavior

AppFactory creates the target repository, claims provisioning with `.appfactory/webapp-provisioning.json`, materializes `blueprints/react-vite/`, and replaces the temporary claim with the final versioned marker from the blueprint.

A repository already carrying the matching current marker is treated as an idempotent replay. AppFactory refuses to overwrite an unrelated repository with the same slug.

## Blueprint source overrides

The default source is the current AppFactory repository. Advanced deployments can override:

- `GITHUB_WEBAPP_BLUEPRINT_OWNER`;
- `GITHUB_WEBAPP_BLUEPRINT_REPO`;
- `GITHUB_WEBAPP_BLUEPRINT_REF`.

## Ownership boundary

AppFactory owns the reusable scaffold and managed automation contract.

The generated repository owns its domain architecture, runtime topology, product code, deployment strategy, observability, persistence, authentication and commercial logic.
