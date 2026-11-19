import type { GitHubOidcClaims } from "./auth";
import type { Env } from "./types";

/**
 * Repository governance token broker.
 *
 * A consumer repository's governance job (AppFactory reusable workflow,
 * `authentication: broker-app`) proves its identity with a GitHub Actions
 * OIDC token and receives a one-hour GitHub App installation token that is
 * restricted to that single repository and to `administration: write`.
 *
 * The App private key never leaves this Worker. The target repository comes
 * exclusively from the verified OIDC claims; the request body is ignored.
 *
 * This module is dependency-free on purpose: OIDC verification, App JWT
 * signing and `fetch` are injected so the policy can be unit-tested without
 * key material or network access.
 */

export const DEFAULT_GOVERNANCE_AUDIENCE = "appfactory-governance";
export const GOVERNANCE_TOKEN_PERMISSIONS = Object.freeze({ administration: "write" as const });

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "Trigenys-AppFactory-Governance-Broker";
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const PINNED_WORKFLOW_REF = /^[^@\s]+\/\.github\/workflows\/[^@\s]+\.ya?ml@[0-9a-f]{40}$/;

export class GovernanceBrokerError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 422 | 502 | 503,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface GovernanceBrokerConfig {
  audience: string;
  allowedOwners: readonly string[];
  allowedJobWorkflowRefs: readonly string[];
}

export interface GovernanceTarget {
  owner: string;
  repo: string;
}

function parseList(value: string | undefined): string[] {
  return (value || "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Reads the broker policy from Worker variables. Both allowlists are mandatory:
 * an unconfigured broker refuses every exchange instead of trusting everyone.
 */
export function governanceBrokerConfig(
  env: Pick<Env, "GOVERNANCE_OIDC_AUDIENCE" | "GOVERNANCE_ALLOWED_OWNERS" | "GOVERNANCE_ALLOWED_JOB_WORKFLOW_REFS">
): GovernanceBrokerConfig {
  const allowedOwners = parseList(env.GOVERNANCE_ALLOWED_OWNERS);
  const allowedJobWorkflowRefs = parseList(env.GOVERNANCE_ALLOWED_JOB_WORKFLOW_REFS);
  if (allowedOwners.length === 0 || allowedJobWorkflowRefs.length === 0) {
    throw new GovernanceBrokerError(
      503,
      "GOVERNANCE_BROKER_NOT_CONFIGURED",
      "Governance token broker is disabled: set GOVERNANCE_ALLOWED_OWNERS and GOVERNANCE_ALLOWED_JOB_WORKFLOW_REFS on the Worker."
    );
  }
  for (const ref of allowedJobWorkflowRefs) {
    if (!PINNED_WORKFLOW_REF.test(ref)) {
      throw new GovernanceBrokerError(
        503,
        "GOVERNANCE_BROKER_MISCONFIGURED",
        `GOVERNANCE_ALLOWED_JOB_WORKFLOW_REFS entries must be pinned to a 40-character commit SHA (owner/repo/.github/workflows/file.yml@<sha>); rejected "${ref}".`
      );
    }
  }
  return {
    audience: env.GOVERNANCE_OIDC_AUDIENCE || DEFAULT_GOVERNANCE_AUDIENCE,
    allowedOwners,
    allowedJobWorkflowRefs
  };
}

/**
 * Pure identity policy. The caller must already have verified the token
 * signature, issuer, audience and validity window.
 *
 * - `repository_owner` must be an allowed account (GitHub logins are
 *   case-insensitive);
 * - `job_workflow_ref` must equal an allowed reusable governance workflow
 *   pinned by commit SHA (branch or tag refs are never accepted);
 * - `repository` must belong to that owner and is the only source of the
 *   target repository.
 */
export function authorizeGovernanceClaims(
  claims: GitHubOidcClaims,
  config: GovernanceBrokerConfig
): GovernanceTarget {
  const owner = claims.repository_owner || "";
  const ownerAllowed = config.allowedOwners.some(
    (allowed) => allowed.toLowerCase() === owner.toLowerCase()
  );
  if (!owner || !ownerAllowed) {
    throw new GovernanceBrokerError(
      403,
      "GOVERNANCE_OWNER_FORBIDDEN",
      "Repository owner is not allowed to request governance tokens."
    );
  }

  const jobWorkflowRef = claims.job_workflow_ref || "";
  if (!jobWorkflowRef || !config.allowedJobWorkflowRefs.includes(jobWorkflowRef)) {
    throw new GovernanceBrokerError(
      403,
      "GOVERNANCE_WORKFLOW_FORBIDDEN",
      "Governance tokens are only issued to the pinned AppFactory reusable governance workflow."
    );
  }

  const repository = claims.repository || "";
  const [repositoryOwner, repo, ...rest] = repository.split("/");
  if (
    rest.length > 0 ||
    !repositoryOwner ||
    !repo ||
    repositoryOwner.toLowerCase() !== owner.toLowerCase() ||
    !GITHUB_LOGIN.test(repositoryOwner) ||
    !GITHUB_REPOSITORY_NAME.test(repo)
  ) {
    throw new GovernanceBrokerError(
      403,
      "GOVERNANCE_REPOSITORY_INVALID",
      "OIDC repository claim does not name a repository owned by the authenticated account."
    );
  }

  return { owner: repositoryOwner, repo };
}

export interface IssuedGovernanceToken {
  token: string;
  expiresAt: string;
  repository: string;
  installationId: number;
  permissions: { administration: "write" };
}

export interface GovernanceTokenIssuerDeps {
  /** Signs a short-lived GitHub App JWT with the Worker-held private key. */
  appJwt: () => Promise<string>;
  fetch: typeof fetch;
}

async function readMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return typeof body.message === "string" ? body.message : "";
  } catch {
    return "";
  }
}

/**
 * Resolves the App installation that covers the target repository, then mints
 * an installation token restricted to that repository and to
 * `administration: write`. Installation selection is the outer boundary: a
 * repository the App is not installed on yields an actionable 403.
 */
export async function issueGovernanceInstallationToken(
  target: GovernanceTarget,
  deps: GovernanceTokenIssuerDeps
): Promise<IssuedGovernanceToken> {
  const jwt = await deps.appJwt();
  const headers = {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": USER_AGENT
  };
  const fullName = `${target.owner}/${target.repo}`;

  const installationResponse = await deps.fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/installation`,
    { headers, redirect: "manual", signal: AbortSignal.timeout(15000) }
  );
  if (installationResponse.status === 404) {
    throw new GovernanceBrokerError(
      403,
      "GITHUB_APP_NOT_INSTALLED",
      `The AppFactory GitHub App is not installed on ${fullName}. Install it on that account or add the repository to the installation's selected repositories, then rerun governance.`
    );
  }
  if (!installationResponse.ok) {
    throw new GovernanceBrokerError(
      502,
      "GITHUB_INSTALLATION_LOOKUP_FAILED",
      `GitHub returned HTTP ${installationResponse.status} while resolving the App installation for ${fullName}.`
    );
  }
  const installation = (await installationResponse.json()) as { id?: number };
  if (!Number.isInteger(installation.id)) {
    throw new GovernanceBrokerError(
      502,
      "GITHUB_INSTALLATION_INVALID",
      `GitHub did not return an installation id for ${fullName}.`
    );
  }

  const tokenResponse = await deps.fetch(
    `${GITHUB_API}/app/installations/${installation.id}/access_tokens`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        repositories: [target.repo],
        permissions: { ...GOVERNANCE_TOKEN_PERMISSIONS }
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(15000)
    }
  );
  if (tokenResponse.status === 422) {
    const message = await readMessage(tokenResponse);
    throw new GovernanceBrokerError(
      422,
      "GITHUB_APP_PERMISSION_UNAVAILABLE",
      `GitHub refused a repository-scoped administration:write token for ${fullName}. Grant the App "Repository permissions > Administration: Read and write" and accept the updated permissions on the installation.${message ? ` GitHub said: ${message}` : ""}`
    );
  }
  if (!tokenResponse.ok) {
    throw new GovernanceBrokerError(
      502,
      "GITHUB_INSTALLATION_TOKEN_FAILED",
      `GitHub returned HTTP ${tokenResponse.status} while creating the governance token for ${fullName}.`
    );
  }

  const issued = (await tokenResponse.json()) as { token?: string; expires_at?: string };
  if (typeof issued.token !== "string" || issued.token.length === 0) {
    throw new GovernanceBrokerError(
      502,
      "GITHUB_INSTALLATION_TOKEN_INVALID",
      `GitHub did not return a token for ${fullName}.`
    );
  }

  return {
    token: issued.token,
    expiresAt: issued.expires_at || "",
    repository: fullName,
    installationId: installation.id as number,
    permissions: { administration: "write" }
  };
}

export interface GovernanceTokenHandlerDeps extends GovernanceTokenIssuerDeps {
  /** Verifies signature, issuer, audience and validity; returns the claims. */
  verifyOidc: (request: Request, audience: string) => Promise<GitHubOidcClaims>;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

/**
 * HTTP adapter for `POST /v1/github/installation-token`. The response body
 * carries the token exactly once; nothing secret is logged.
 */
export async function handleGovernanceInstallationToken(
  request: Request,
  env: Env,
  deps: GovernanceTokenHandlerDeps
): Promise<Response> {
  try {
    const config = governanceBrokerConfig(env);
    const claims = await deps.verifyOidc(request, config.audience);
    const target = authorizeGovernanceClaims(claims, config);
    const issued = await issueGovernanceInstallationToken(target, deps);
    console.log(
      `Governance token issued for ${issued.repository} (installation ${issued.installationId}, workflow ${claims.job_workflow_ref}).`
    );
    return jsonResponse(
      {
        token: issued.token,
        expiresAt: issued.expiresAt,
        repository: issued.repository,
        permissions: issued.permissions
      },
      200
    );
  } catch (error) {
    if (error instanceof GovernanceBrokerError) {
      return jsonResponse({ error: error.code, message: error.message }, error.status);
    }
    const authError = error as { status?: number; code?: string; message?: string };
    if (
      (authError.status === 401 || authError.status === 403) &&
      typeof authError.code === "string"
    ) {
      return jsonResponse({ error: authError.code, message: authError.message }, authError.status);
    }
    // Error objects may embed upstream payloads; only the error type is logged.
    console.error(
      `Governance token exchange failed: ${error instanceof Error ? error.name : "unknown error"}`
    );
    return jsonResponse(
      { error: "GOVERNANCE_TOKEN_FAILED", message: "Unable to issue a governance token." },
      500
    );
  }
}
