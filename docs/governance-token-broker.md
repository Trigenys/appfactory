# Repository governance token broker

`POST /v1/github/installation-token` lets a consumer repository run AppFactory
Repository Governance (`reusable-repository-governance.yml`, mode
`authentication: broker-app`) without storing the GitHub App private key in its
own secrets. The key stays where it already lives: the `GITHUB_PRIVATE_KEY`
secret of the `appfactory-api` Worker.

## Flow

```text
consumer governance job (id-token: write)
        │  GitHub Actions OIDC token, audience appfactory-governance
        ▼
appfactory-api  POST /v1/github/installation-token
        │  1. verify signature, issuer, audience, validity window
        │  2. repository_owner ∈ GOVERNANCE_ALLOWED_OWNERS
        │  3. job_workflow_ref ∈ GOVERNANCE_ALLOWED_JOB_WORKFLOW_REFS (commit SHA only)
        │  4. GET /repos/{owner}/{repo}/installation with the App JWT
        │  5. POST /app/installations/{id}/access_tokens
        │       repositories: [repo], permissions: { administration: write }
        ▼
one-hour installation token, scoped to the calling repository
        │  masked in the job, passed to the governance Action
        ▼
DELETE /installation/token at job end (always)
```

The target repository is taken from the verified `repository` claim only. The
request body is ignored, so a caller cannot ask for another repository or for
wider permissions.

## Worker variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `GOVERNANCE_ALLOWED_OWNERS` | yes | Comma-separated GitHub accounts whose repositories may request governance tokens (case-insensitive), e.g. `EagleFox31,Trigenys`. |
| `GOVERNANCE_ALLOWED_JOB_WORKFLOW_REFS` | yes | Comma-separated `job_workflow_ref` values, each pinned to a 40-character commit SHA of the reusable governance workflow, e.g. `EagleFox31/appfactory-project-automation/.github/workflows/reusable-repository-governance.yml@<sha>`. Branch and tag refs are rejected at startup of every exchange. |
| `GOVERNANCE_OIDC_AUDIENCE` | no | OIDC audience the job requests. Defaults to `appfactory-governance`. |

While either allowlist is empty the endpoint answers `503
GOVERNANCE_BROKER_NOT_CONFIGURED` and issues nothing. No new secret is
required: the existing `GITHUB_PRIVATE_KEY` and `GITHUB_APP_ID` are reused.
`GITHUB_INSTALLATION_ID` is not used; the installation is resolved per
repository, which also enforces that the App is installed there.

## Responses

| Status | `error` | Meaning / action |
| --- | --- | --- |
| 200 | — | `{ token, expiresAt, repository, permissions }`. The token appears exactly once and is never logged. |
| 401 | `OIDC_*` | Token missing, malformed, expired or badly signed. |
| 403 | `OIDC_AUDIENCE_FORBIDDEN` | Request the `appfactory-governance` audience. |
| 403 | `GOVERNANCE_OWNER_FORBIDDEN` | Add the account to `GOVERNANCE_ALLOWED_OWNERS`. |
| 403 | `GOVERNANCE_WORKFLOW_FORBIDDEN` | The job did not come from a pinned reusable governance workflow; update the pin after reviewing the new workflow SHA. |
| 403 | `GITHUB_APP_NOT_INSTALLED` | Install the App on the repository (or add it to the installation's selected repositories). |
| 422 | `GITHUB_APP_PERMISSION_UNAVAILABLE` | Grant the App **Repository permissions → Administration: Read and write** and accept the updated permissions on the installation. |
| 502 | `GITHUB_*` | GitHub API failure; retry later. |
| 503 | `GOVERNANCE_BROKER_*` | Broker not configured or misconfigured; see the message. |

## Trust boundaries

- **Outer boundary**: the App installation. A repository the App is not
  installed on cannot obtain a token, whatever its OIDC claims say.
- **Inner boundary**: the pinned `job_workflow_ref`. Only the reviewed reusable
  governance workflow, at an exact commit, can exchange a token. A consumer
  workflow that calls the governance workflow by branch or tag still presents
  the resolved commit SHA in `job_workflow_ref`; the pin must match that SHA.
- **Scope**: one repository, `administration: write`, one hour, revoked by the
  job when it ends.

This endpoint is independent from the Project board broker
(`appfactory-project-token-broker`), which issues OAuth user tokens and does
not hold the App key.
