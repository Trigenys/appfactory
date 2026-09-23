# AppFactory

Automated software delivery platform for generating, validating and deploying applications.

## Current milestone — M3 OpenPage Engine POC

AppFactory has validated its native brief-to-manifest pipeline and modular landing renderer. M3 now introduces a pluggable generation-engine boundary so open-source website generators can be connected without turning the Worker itself into a giant design engine.

Current architecture:

```text
brief
  -> AppFactory orchestration
  -> generation engine
       -> native AppFactory planner (production path)
       -> OpenPage adapter (POC path)
  -> quality gate
  -> repository generation
  -> Cloudflare Pages deployment
```

The first external engine POC targets `buildingopen/openpage`, an MIT-licensed JSON-first website builder. OpenPage generates a structured site config from a prompt; AppFactory remains responsible for orchestration, quality rules, GitHub lifecycle and deployment.

## API

### `GET /health`

Returns Worker readiness plus the active milestone, manifest version and engine configuration flags without exposing secret values.

### `POST /projects`

Production project provisioning currently uses the native AppFactory renderer.

Preferred request:

```json
{
  "name": "Nova Legal",
  "slug": "nova-legal",
  "brief": "Cabinet d'avocats premium spécialisé dans les startups technologiques en Afrique. L'objectif principal est la prise de rendez-vous.",
  "language": "fr",
  "audience": "Fondateurs et dirigeants de startups technologiques",
  "private": true
}
```

AppFactory infers a specification such as:

```text
industry  -> legal
tone      -> premium
goal      -> bookings
recipe    -> luxury
animation -> subtle
sections  -> hero, trust, services, process, faq, contact, final-cta
```

Successful response includes the repository, Manifest v2 commit and Cloudflare Pages deployment details.

The optional request field `engine` accepts `native` or `openpage`. `native` is the default. `engine: "openpage"` is deliberately blocked on `/projects` until OpenPage rendering/export is wired end-to-end, so AppFactory never silently deploys the native template while claiming an external engine was used.

### `POST /engines/openpage/generate`

POC endpoint for validating OpenPage generation independently from repository provisioning.

It accepts the same brief-first request as `/projects`, calls the configured OpenPage generator and returns a sanitized OpenPage `SiteConfig`.

AppFactory removes evidence-sensitive block types when the brief does not contain supporting data, including fabricated testimonials, logo clouds, statistics and pricing. It also requires a hero and a CTA/contact block.

Example:

```json
{
  "name": "Nova Legal",
  "slug": "nova-legal-openpage-poc",
  "brief": "Cabinet d'avocats premium spécialisé dans les startups technologiques en Afrique. L'objectif principal est la prise de rendez-vous.",
  "language": "fr",
  "audience": "Fondateurs et dirigeants de startups technologiques"
}
```

## Service project blueprints

AppFactory can also provision backend service repositories through `projectType: "service"`. The first preset is `entitlements`, which generates a Cloudflare Worker + D1 entitlement service with online checks, short-lived Ed25519 offline grants, CI and AppFactory Project Automation already wired.

Service repositories intentionally bypass the landing renderer and Cloudflare Pages provisioning. See [Service project blueprints](docs/service-blueprints.md) for the request contract, ownership boundaries and idempotency model.

## Manifest v2

The native engine emits structured generation intent:

- `strategy`: brief, audience, industry, tone and conversion goal
- `brand`: tone, palette and typography direction
- `design`: recipe, animation and density
- `sections`: ordered section plan
- `seo`: generated title and description
- `motion`: motion policy and reduced-motion requirement
- `content`: generated business-facing section content

The native modular renderer consumes this contract directly.

## Runtime

AppFactory API is designed for Cloudflare Workers and uses GitHub App installation authentication plus the Cloudflare Pages API.

Required Worker runtime variables/secrets:

- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_PRIVATE_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` — secret with Cloudflare Pages Edit / Pages Write access for the target account

Optional variables:

- `GITHUB_OWNER` (defaults to `Trigenys`)
- `GITHUB_TEMPLATE_OWNER` (defaults to `GITHUB_OWNER`)
- `GITHUB_TEMPLATE_REPO` (defaults to `appfactory-landing-template`)
- `GITHUB_COMMIT_AUTHOR_NAME`
- `GITHUB_COMMIT_AUTHOR_EMAIL`
- `OPENPAGE_GENERATOR_URL` — self-hosted OpenPage base URL or full `/api/generate` URL
- `OPENPAGE_API_TOKEN` — optional bearer token for a protected Trigenys OpenPage deployment
- `ENVIRONMENT`

GitHub downloads App private keys as PEM files. AppFactory accepts both the native GitHub RSA PEM format (`-----BEGIN RSA PRIVATE KEY-----`) and PKCS#8 (`-----BEGIN PRIVATE KEY-----`) directly, so no manual key conversion is required. The legacy `GITHUB_PRIVATE_KEY_PKCS8` secret name remains supported as a fallback.

### Commit attribution

Generated commits use the human project owner as the Git author and the AppFactory GitHub App as the technical committer. The default author is the `EagleFox31` GitHub account via its GitHub noreply address; the optional commit-author variables can override that identity.

### Cloudflare GitHub access

The Cloudflare Workers & Pages GitHub App must be installed on the `Trigenys` organization with access to repositories generated by AppFactory. For end-to-end unattended generation, granting that Cloudflare App access to all current and future repositories in the organization avoids a manual authorization step for every generated site.

Each native Pages project is created with:

- Git provider: GitHub
- production branch: `main`
- build command: `npm run build`
- output directory: `dist`
- production deployments enabled
- preview deployments enabled for branches

## Continuous deployment

AppFactory deploys its production Cloudflare Worker from GitHub Actions; no local clone is required for normal delivery.

The `Deploy AppFactory` workflow runs after the existing `CI` workflow completes successfully on `main`. It checks out the exact tested commit SHA, deploys through Cloudflare's maintained `wrangler-action@v4`, then calls `GET /health` on the deployment URL and requires `status: "ok"`.

Repository Actions secrets required by the deployment workflow:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Application/runtime secrets such as `GITHUB_PRIVATE_KEY` remain configured on the Worker in Cloudflare. Wrangler deployments do not delete existing Worker secrets, and this repository also keeps dashboard-managed variables with `keep_vars: true`.

A manual redeploy is available through `workflow_dispatch`, but it cannot bypass validation: the selected ref resolves to a commit SHA and the workflow refuses to deploy it unless that exact SHA already has a successful `CI` run.

## Local development

```bash
npm install
npm run typecheck
npm run dev
```

Store local secrets in `.dev.vars`; never commit that file.

## Architecture boundary

`appfactory` owns orchestration, engine selection, quality gates, repository generation and hosting provisioning.

`appfactory-landing-template` is the native fallback renderer, not the only long-term generation engine.

External generation engines such as OpenPage plug into AppFactory behind adapters. Their own renderer/export path should remain authoritative wherever possible instead of being reimplemented inside the Worker.

See `docs/openpage-engine-poc.md` for the OpenPage audit and the remaining end-to-end integration step.
