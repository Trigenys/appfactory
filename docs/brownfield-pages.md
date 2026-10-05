# Brownfield Cloudflare Pages

AppFactory can provision a Cloudflare Pages site for an existing Trigenys repository without copying Cloudflare credentials into that repository.

This is intended for secondary public surfaces such as a landing page attached to a mobile, desktop, service or webapp repository.

## Endpoint

`POST /infrastructure/pages`

Authentication uses the existing GitHub Actions OIDC infrastructure contract. The caller must be the canonical workflow:

```text
<repository>/.github/workflows/appfactory-infrastructure.yml@refs/heads/main
```

The OIDC repository claim must exactly match the `repository` in the request.

## Request

Example for CleanRoute:

```json
{
  "repository": "Trigenys/cleanroute",
  "projectName": "cleanroute",
  "productionBranch": "main",
  "rootDirectory": "/",
  "buildCommand": "python3 site/build_cloudflare.py",
  "outputDirectory": "site/dist",
  "customDomain": "cleanroute.trigenys.com"
}
```

`buildCommand` is required. Other fields default from the repository where possible.

Brownfield Pages project names are constrained to the repository name or a repository-prefixed variant, such as `cleanroute-docs`.

## What AppFactory owns

The endpoint validates the OIDC repository boundary, creates or reconciles a GitHub-connected Cloudflare Pages project, applies the requested build settings, optionally associates a custom domain, writes `.appfactory/pages-infrastructure.json` as the ownership marker, and reuses or triggers a production deployment.

Cloudflare Pages resource calls prefer `CLOUDFLARE_PAGES_D1_TOKEN`; `CLOUDFLARE_API_TOKEN` remains the legacy fallback.

## External DNS boundary

AppFactory associates the custom domain inside Cloudflare Pages, but it does not pretend to control an authoritative DNS provider outside Cloudflare.

For a subdomain hosted at an external DNS provider, the response includes a CNAME instruction pointing the requested hostname to the Pages `*.pages.dev` hostname. Apply that DNS record only after Cloudflare has associated the custom domain.

## Idempotency and adoption

The marker establishes AppFactory ownership of the Pages configuration for the repository. Replays reconcile the same project and settings.

If a Cloudflare Pages project already exists, AppFactory verifies that its GitHub source matches the calling repository before reconciling it. A project connected to another repository fails closed.

The marker may be updated when the same repository deliberately changes build settings, but AppFactory will not silently move ownership to another repository or unrelated Pages project.
