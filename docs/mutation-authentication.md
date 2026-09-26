# AppFactory mutation authentication

AppFactory mutation endpoints are protected with GitHub Actions OIDC.

## Protected endpoints

- `POST /projects`
- `POST /engines/openpage/generate`

`GET /health` remains public and never exposes secret values.

## Trust boundary

The Worker accepts only short-lived GitHub OIDC tokens that match all of the following:

- issuer: `https://token.actions.githubusercontent.com`;
- audience: `appfactory-api`;
- ref: `refs/heads/main`;
- one of the explicitly trusted repository/workflow pairs:
  - `Trigenys/appfactory` + `Trigenys/appfactory/.github/workflows/provision-project.yml@refs/heads/main`;
  - `Trigenys/.github` + `Trigenys/.github/.github/workflows/provision-appfactory-project.yml@refs/heads/main`;
- valid RS256 signature against GitHub's published JWKS;
- valid expiration/not-before window.

This means knowing the Worker URL is not sufficient to provision repositories. The caller must have write access to one of the approved repositories and run the exact trusted workflow from its main branch. The public organization provisioner exists so repository creation does not depend on private-repository Actions minutes; it does not weaken the OIDC repository/workflow/ref boundary.

## Provisioning workflow

Use either the private AppFactory workflow **Provision AppFactory Project** or the public organization workflow **Provision AppFactory Project (public runner)**. Both request an OIDC token directly from GitHub, build the AppFactory request and call the Worker.

No long-lived AppFactory API key is stored in GitHub or Cloudflare. The public runner workflow is intentionally hosted in `Trigenys/.github`; only repository writers can dispatch it, and AppFactory validates its exact OIDC identity.

## Development

Authentication is bypassed only when the Worker explicitly runs with `ENVIRONMENT=development`. Production and unspecified environments enforce OIDC.


## Declarative provisioning requests

For an auditable GitOps path, add or modify one JSON request under `.appfactory/requests/` and merge it to `main`. The same OIDC-protected workflow detects changed request files and provisions them through AppFactory.

The request file is an immutable-friendly audit record; AppFactory's own brownfield/idempotency checks remain authoritative and prevent unrelated repositories from being overwritten.
