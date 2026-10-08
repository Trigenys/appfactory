import type { Env } from "./types";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
const JWKS_TTL_MS = 10 * 60 * 1000;

export interface GitHubOidcClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  repository?: string;
  ref?: string;
  workflow_ref?: string;
  actor?: string;
  event_name?: string;
}

interface GitHubJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface TrustedGitHubCaller {
  repository: string;
  workflowRef: string;
}

let jwksCache: { expiresAt: number; keys: GitHubJwk[] } | undefined;

export class AuthenticationError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function decodeJson<T>(segment: string): T {
  const bytes = decodeBase64Url(segment);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) {
    throw new AuthenticationError(
      401,
      "AUTH_REQUIRED",
      "A GitHub Actions OIDC bearer token is required."
    );
  }
  return match[1];
}

function audienceMatches(audience: string | string[], expected: string): boolean {
  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

function trustedMutationCallers(env: Env, expectedRef: string): TrustedGitHubCaller[] {
  const owner = env.GITHUB_OWNER || "Trigenys";
  const appFactoryRepository =
    env.GITHUB_OIDC_REPOSITORY || `${owner}/appfactory`;
  const appFactoryWorkflowRef =
    env.GITHUB_OIDC_WORKFLOW_REF ||
    `${appFactoryRepository}/.github/workflows/provision-project.yml@${expectedRef}`;
  const provisionerRepository =
    env.GITHUB_OIDC_PROVISIONER_REPOSITORY || `${owner}/.github`;
  const provisionerWorkflowRef =
    env.GITHUB_OIDC_PROVISIONER_WORKFLOW_REF ||
    `${provisionerRepository}/.github/workflows/provision-appfactory-project.yml@${expectedRef}`;

  return [
    { repository: appFactoryRepository, workflowRef: appFactoryWorkflowRef },
    { repository: provisionerRepository, workflowRef: provisionerWorkflowRef }
  ];
}

async function githubJwks(): Promise<GitHubJwk[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;

  const response = await fetch(GITHUB_JWKS_URL, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new AuthenticationError(401, "OIDC_JWKS_UNAVAILABLE", "Unable to validate GitHub OIDC token.");
  }

  const body = await response.json() as { keys?: GitHubJwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new AuthenticationError(401, "OIDC_JWKS_INVALID", "GitHub OIDC key set is invalid.");
  }

  jwksCache = { expiresAt: now + JWKS_TTL_MS, keys: body.keys };
  return body.keys;
}

async function verifySignature(
  signingInput: string,
  signatureSegment: string,
  kid: string
): Promise<void> {
  const keys = await githubJwks();
  const jwk = keys.find((candidate) => candidate.kid === kid);
  if (!jwk) {
    jwksCache = undefined;
    const refreshed = await githubJwks();
    const refreshedJwk = refreshed.find((candidate) => candidate.kid === kid);
    if (!refreshedJwk) {
      throw new AuthenticationError(401, "OIDC_KEY_NOT_FOUND", "GitHub OIDC signing key was not found.");
    }
    return verifyWithKey(signingInput, signatureSegment, refreshedJwk);
  }
  return verifyWithKey(signingInput, signatureSegment, jwk);
}

async function verifyWithKey(
  signingInput: string,
  signatureSegment: string,
  jwk: GitHubJwk
): Promise<void> {
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    toArrayBuffer(decodeBase64Url(signatureSegment)),
    toArrayBuffer(new TextEncoder().encode(signingInput))
  );
  if (!valid) {
    throw new AuthenticationError(401, "OIDC_SIGNATURE_INVALID", "GitHub OIDC signature is invalid.");
  }
}

async function verifyOidcToken(
  request: Request,
  env: Env
): Promise<{ claims: GitHubOidcClaims; expectedRef: string }> {
  if (env.ENVIRONMENT === "development") {
    return {
      claims: {
        iss: "development",
        aud: "development",
        exp: Math.floor(Date.now() / 1000) + 60,
        repository: env.GITHUB_OIDC_REPOSITORY || "Trigenys/appfactory",
        ref: env.GITHUB_OIDC_REF || "refs/heads/main",
        workflow_ref:
          env.GITHUB_OIDC_WORKFLOW_REF ||
          "Trigenys/appfactory/.github/workflows/provision-project.yml@refs/heads/main"
      },
      expectedRef: env.GITHUB_OIDC_REF || "refs/heads/main"
    };
  }

  const token = bearerToken(request);
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthenticationError(401, "OIDC_TOKEN_INVALID", "GitHub OIDC token is malformed.");
  }

  const [headerSegment, claimsSegment, signatureSegment] = parts;
  const header = decodeJson<{ alg?: string; kid?: string }>(headerSegment);
  if (header.alg !== "RS256" || !header.kid) {
    throw new AuthenticationError(401, "OIDC_HEADER_INVALID", "GitHub OIDC token header is invalid.");
  }

  await verifySignature(`${headerSegment}.${claimsSegment}`, signatureSegment, header.kid);

  const claims = decodeJson<GitHubOidcClaims>(claimsSegment);
  const now = Math.floor(Date.now() / 1000);
  const expectedRef = env.GITHUB_OIDC_REF || "refs/heads/main";
  const expectedAudience = env.GITHUB_OIDC_AUDIENCE || "appfactory-api";

  if (claims.iss !== GITHUB_OIDC_ISSUER) {
    throw new AuthenticationError(401, "OIDC_ISSUER_INVALID", "GitHub OIDC issuer is invalid.");
  }
  if (!audienceMatches(claims.aud, expectedAudience)) {
    throw new AuthenticationError(403, "OIDC_AUDIENCE_FORBIDDEN", "GitHub OIDC audience is not allowed.");
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= now - 30) {
    throw new AuthenticationError(401, "OIDC_TOKEN_EXPIRED", "GitHub OIDC token has expired.");
  }
  if (claims.nbf !== undefined && claims.nbf > now + 30) {
    throw new AuthenticationError(401, "OIDC_TOKEN_NOT_ACTIVE", "GitHub OIDC token is not active yet.");
  }
  if (claims.ref !== expectedRef) {
    throw new AuthenticationError(403, "OIDC_REF_FORBIDDEN", "GitHub ref is not allowed.");
  }

  return { claims, expectedRef };
}

export async function authenticateMutation(
  request: Request,
  env: Env
): Promise<GitHubOidcClaims> {
  if (env.ENVIRONMENT === "development") {
    return {
      iss: "development",
      aud: "development",
      exp: Math.floor(Date.now() / 1000) + 60
    };
  }

  const { claims, expectedRef } = await verifyOidcToken(request, env);
  const trustedCallers = trustedMutationCallers(env, expectedRef);

  const repositoryAllowed = trustedCallers.some(
    (caller) => caller.repository === claims.repository
  );
  if (!repositoryAllowed) {
    throw new AuthenticationError(403, "OIDC_REPOSITORY_FORBIDDEN", "GitHub repository is not allowed.");
  }

  const workflowAllowed = trustedCallers.some(
    (caller) =>
      caller.repository === claims.repository &&
      caller.workflowRef === claims.workflow_ref
  );
  if (!workflowAllowed) {
    throw new AuthenticationError(403, "OIDC_WORKFLOW_FORBIDDEN", "GitHub workflow is not allowed.");
  }

  return claims;
}

export async function authenticateInfrastructureMutation(
  request: Request,
  env: Env
): Promise<GitHubOidcClaims> {
  if (env.ENVIRONMENT === "development") {
    return {
      iss: "development",
      aud: "development",
      exp: Math.floor(Date.now() / 1000) + 60,
      repository: "Trigenys/product-identity",
      ref: "refs/heads/main",
      workflow_ref:
        "Trigenys/product-identity/.github/workflows/appfactory-infrastructure.yml@refs/heads/main"
    };
  }

  const { claims, expectedRef } = await verifyOidcToken(request, env);
  const owner = env.GITHUB_OWNER || "Trigenys";
  const repository = claims.repository || "";

  if (!repository.startsWith(`${owner}/`)) {
    throw new AuthenticationError(
      403,
      "OIDC_INFRA_REPOSITORY_FORBIDDEN",
      "Infrastructure self-service is restricted to repositories owned by the configured GitHub organization."
    );
  }

  const expectedWorkflow =
    `${repository}/.github/workflows/appfactory-infrastructure.yml@${expectedRef}`;
  if (claims.workflow_ref !== expectedWorkflow) {
    throw new AuthenticationError(
      403,
      "OIDC_INFRA_WORKFLOW_FORBIDDEN",
      "Infrastructure self-service requires the canonical AppFactory infrastructure workflow on the protected main ref."
    );
  }

  return claims;
}

/**
 * Database access is narrower than generic infrastructure provisioning:
 * only the SEO Monitor collector on main, for scheduled or manually
 * dispatched collection. No other Trigenys repo may request this credential.
 */
export async function authenticateDatabaseLease(
  request: Request,
  env: Env
): Promise<GitHubOidcClaims> {
  const { claims, expectedRef } = await verifyOidcToken(request, env);
  const allowedRepo = "Trigenys/trigenys-seo-monitor";
  const allowedWorkflow =
    `${allowedRepo}/.github/workflows/seo-monitor.yml@${expectedRef}`;
  if (claims.repository !== allowedRepo || claims.workflow_ref !== allowedWorkflow) {
    throw new AuthenticationError(
      403,
      "DATABASE_LEASE_CALLER_FORBIDDEN",
      "Database access is restricted to the SEO Monitor workflow on main."
    );
  }
  if (claims.event_name !== "schedule" && claims.event_name !== "workflow_dispatch") {
    throw new AuthenticationError(
      403,
      "DATABASE_LEASE_EVENT_FORBIDDEN",
      "Database leases are available only to scheduled or manually dispatched monitoring jobs."
    );
  }
  return claims;
}

/**
 * Stateful Neon provisioning is pinned to protected main and exact workflow
 * identities. Canonical infrastructure workflows may reconcile approved
 * targets on a main push or an explicit dispatch. The exceptional SEO
 * collector identity remains dispatch-only.
 */
export async function authenticateNeonProvisioning(
  request: Request,
  env: Env
): Promise<GitHubOidcClaims> {
  const { claims, expectedRef } = await verifyOidcToken(request, env);
  const repository = claims.repository || "";
  const owner = env.GITHUB_OWNER || "Trigenys";

  if (!repository.startsWith(owner + "/")) {
    throw new AuthenticationError(
      403,
      "NEON_PROVISIONER_FORBIDDEN",
      "Neon provisioning is restricted to repositories owned by the configured organization."
    );
  }

  const canonicalInfra =
    repository + "/.github/workflows/appfactory-infrastructure.yml@" + expectedRef;
  const seoCollector =
    "Trigenys/trigenys-seo-monitor/.github/workflows/seo-monitor.yml@" + expectedRef;
  const canonicalInfrastructureCaller = claims.workflow_ref === canonicalInfra;
  const seoCollectorCaller =
    repository === "Trigenys/trigenys-seo-monitor" &&
    claims.workflow_ref === seoCollector;

  if (!canonicalInfrastructureCaller && !seoCollectorCaller) {
    throw new AuthenticationError(
      403,
      "NEON_PROVISIONER_WORKFLOW_FORBIDDEN",
      "Neon provisioning is restricted to canonical workflows on main."
    );
  }

  const canonicalEventAllowed =
    claims.event_name === "workflow_dispatch" || claims.event_name === "push";
  const seoEventAllowed = claims.event_name === "workflow_dispatch";
  if (
    (canonicalInfrastructureCaller && !canonicalEventAllowed) ||
    (seoCollectorCaller && !seoEventAllowed)
  ) {
    throw new AuthenticationError(
      403,
      "NEON_PROVISIONER_EVENT_FORBIDDEN",
      "Neon provisioning event is not allowed for this workflow identity."
    );
  }

  return claims;
}
