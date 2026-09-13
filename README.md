# AppFactory

Automated software delivery platform for generating, validating and deploying applications.

## Current milestone — M1 Repository Factory

The first executable AppFactory capability is intentionally narrow:

```text
POST /projects
  -> authenticate as AppFactory Bot (GitHub App)
  -> create a repository from Trigenys/appfactory-landing-template
  -> replace appfactory.json with project-specific configuration
  -> the generated repository CI runs automatically
  -> return the repository URL and manifest commit SHA
```

No AI generation is required for M1. The goal is to prove reliable repository creation and configuration first.

## API

### `GET /health`

Returns the Worker health and active milestone.

### `POST /projects`

Example request:

```json
{
  "name": "Kamer Logistics",
  "slug": "kamer-logistics",
  "description": "Premium B2B logistics landing page",
  "private": true,
  "recipe": "corporate",
  "animation": "subtle",
  "heroTitle": "Logistics without the guesswork.",
  "heroSubtitle": "A clear route from request to delivery.",
  "primaryCtaLabel": "Request a quote",
  "primaryCtaHref": "mailto:hello@example.com"
}
```

Successful response:

```json
{
  "status": "CREATED",
  "repository": "Trigenys/kamer-logistics",
  "repositoryUrl": "https://github.com/Trigenys/kamer-logistics",
  "defaultBranch": "main",
  "manifestCommitSha": "..."
}
```

## Runtime

AppFactory API is designed for Cloudflare Workers and uses GitHub App installation authentication.

Required Worker secrets:

- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_PRIVATE_KEY_PKCS8`

Optional variables:

- `GITHUB_OWNER` (defaults to `Trigenys`)
- `GITHUB_TEMPLATE_OWNER` (defaults to `GITHUB_OWNER`)
- `GITHUB_TEMPLATE_REPO` (defaults to `appfactory-landing-template`)
- `ENVIRONMENT`

GitHub downloads App private keys as PEM files. AppFactory expects the key stored in the Worker secret to be PKCS#8 (`-----BEGIN PRIVATE KEY-----`). Convert it once before storing it if necessary.

## Local development

```bash
npm install
npm run typecheck
npm run dev
```

Store local secrets in `.dev.vars`; never commit that file.

## Architecture boundary

`appfactory` owns orchestration and repository generation. `appfactory-landing-template` owns the generated frontend contract. `appfactory-project-automation` remains a separate reusable GitHub Project/Issue/PR automation brick.
