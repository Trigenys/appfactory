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

AppFactory can also provision backend services through `projectType: "service"`. The first preset is `entitlements`, which generates the service repository, provisions/reuses D1, wires the real database UUID into Wrangler, creates/reuses the Cloudflare Worker, connects native Workers Builds, runs remote D1 migrations and triggers the first production build. Online checks, short-lived Ed25519 offline grants, CI and AppFactory Project Automation are included in the generated repository.

Service repositories intentionally bypass the landing renderer and Cloudflare Pages. See [Service project blueprints](docs/service-blueprints.md) for the request contract, Cloudflare delivery path, ownership boundaries and idempotency model.

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
- `CLOUDFLARE_API_TOKEN` — existing AppFactory Cloudflare token. Landing provisioning needs Pages write access; service provisioning additionally needs D1 Edit, Workers Scripts Edit and Workers Builds Configuration Edit.

Optional variables:

- `GITHUB_OWNER` (defaults to `Trigenys`)
- `GITHUB_TEMPLATE_OWNER` (defaults to `GITHUB_OWNER`)
- `GITHUB_TEMPLATE_REPO` (defaults to `appfactory-landing-template`)
- `GITHUB_COMMIT_AUTHOR_NAME`
- `GITHUB_COMMIT_AUTHOR_EMAIL`
- `OPENPAGE_GENERATOR_URL` — self-hosted OpenPage base URL or full `/api/generate` URL
- `OPENPAGE_API_TOKEN` — optional bearer token for a protected Trigenys OpenPage deployment
- `CLOUDFLARE_BUILD_TOKEN_UUID` — optional existing Workers Builds token UUID when automatic discovery is ambiguous
- `CLOUDFLARE_BUILD_TOKEN_SOURCE_WORKER` — optional Worker used to discover an existing build token; defaults to `appfactory-api`
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

AppFactory uses Cloudflare Workers Builds with the native GitHub integration for production delivery. The existing `appfactory-api` Worker is connected directly to `Trigenys/appfactory`, so pushes to the configured production branch are built and deployed by Cloudflare without duplicating Cloudflare account credentials into GitHub Actions.

GitHub Actions remains responsible for repository validation (`CI`), while Cloudflare reports its own `Workers Builds: appfactory-api` check run back to the same commit.

Production runtime credentials remain owned by the Worker in Cloudflare:

- `GITHUB_PRIVATE_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- the other AppFactory runtime variables documented above

No repository-level `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is required for normal deployment.

The `npm run deploy` / `wrangler deploy` path is retained only as a break-glass/manual deployment path. Because `wrangler.jsonc` sets `keep_vars: true`, a manual Wrangler deployment preserves dashboard-managed runtime variables.

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


## Desktop project blueprints

AppFactory can provision Windows desktop repositories through `projectType: "desktop"`, `platform: "windows"` and `preset: "tauri-react"`. The versioned blueprint lives in `blueprints/tauri-react/` and includes Tauri 2, React/TypeScript/Vite, a narrow Rust native boundary, CI and AppFactory Project Automation.

Desktop repositories bypass Cloudflare Pages and Workers provisioning. See [Desktop project blueprints](docs/desktop-blueprints.md).

## Mobile project blueprints

AppFactory can provision native Android repositories through `projectType: "mobile"`, `platform: "android"` and `preset: "android-compose"`. The versioned blueprint lives in `blueprints/android-compose/` and includes Compose UI foundations, CI, AppFactory Project Automation and Roborazzi visual-regression support.

Mobile repositories bypass Cloudflare Pages and Workers provisioning. See [Mobile project blueprints](docs/mobile-blueprints.md).


## Mutation authentication

Production mutation endpoints are authenticated with GitHub Actions OIDC. Knowing the Worker URL is not sufficient to create repositories or invoke generation.

Use the **Provision AppFactory Project** workflow in `.github/workflows/provision-project.yml`. The Worker validates the short-lived GitHub token signature, audience, repository, main ref and exact workflow identity before accepting `POST /projects` or `POST /engines/openpage/generate`.

See [Mutation authentication](docs/mutation-authentication.md).
