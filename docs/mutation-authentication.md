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
- repository: `Trigenys/appfactory`;
- ref: `refs/heads/main`;
- workflow ref: `Trigenys/appfactory/.github/workflows/provision-project.yml@refs/heads/main`;
- valid RS256 signature against GitHub's published JWKS;
- valid expiration/not-before window.

This means knowing the Worker URL is not sufficient to provision repositories. The caller must be the approved workflow running from AppFactory's main branch.

## Provisioning workflow

Use the GitHub Actions workflow **Provision AppFactory Project**. It requests an OIDC token directly from GitHub, builds the AppFactory request and calls the Worker.

No long-lived AppFactory API key is stored in GitHub or Cloudflare.

## Development

Authentication is bypassed only when the Worker explicitly runs with `ENVIRONMENT=development`. Production and unspecified environments enforce OIDC.
