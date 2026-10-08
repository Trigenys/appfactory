import type { Env } from "./types";
import type { GitHubOidcClaims } from "./auth";

const NEON_BASE = "https://console.neon.tech/api/v2";
const SEO_REPOSITORY = "Trigenys/trigenys-seo-monitor";

export interface NeonTarget {
  projectId: string;
  branchId: string;
  databaseName: string;
  roleName: string;
  workerName: string;
  secretName: string;
  createMissing: boolean;
}

const SEO_TARGET: NeonTarget = {
  projectId: "little-frog-93793324",
  branchId: "br-twilight-star-b2orr8hw",
  databaseName: "seo_monitor",
  roleName: "seo_monitor_owner",
  workerName: "appfactory-api",
  secretName: "APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL",
  createMissing: false
};

export interface NeonDependencies {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  listSecretNames: (env: Env, workerName: string) => Promise<Set<string>>;
  putSecret: (env: Env, workerName: string, name: string, value: string) => Promise<void>;
}

export type ProvisioningResult = {
  status: "ALREADY_CONFIGURED" | "PROVISIONED";
  repository: string;
  database: string;
  worker: string;
  secretName: string;
  createdDatabase: boolean;
  createdRole: boolean;
};

export class NeonProvisioningError extends Error {
  constructor(
    readonly status: 400 | 403 | 409 | 502 | 503,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const IDENTIFIER = /^[a-z][a-z0-9_-]{0,62}$/;
const PROJECT_IDENTIFIER = /^[a-z0-9-]{1,60}$/;
const SECRET_IDENTIFIER = /^[A-Z][A-Z0-9_]{5,100}$/;
const WORKER_IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,62}$/;

function parseTargets(env: Env): Record<string, NeonTarget> {
  const targets: Record<string, NeonTarget> = { [SEO_REPOSITORY]: SEO_TARGET };
  if (!env.APPFACTORY_NEON_TARGETS?.trim()) return targets;
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.APPFACTORY_NEON_TARGETS);
  } catch {
    throw new NeonProvisioningError(503, "NEON_TARGETS_INVALID", "AppFactory Neon target configuration is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NeonProvisioningError(503, "NEON_TARGETS_INVALID", "AppFactory Neon target configuration is invalid.");
  }
  for (const [repository, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      repository === SEO_REPOSITORY ||
      !/^Trigenys\/[a-zA-Z0-9_.-]{1,90}$/.test(repository) ||
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      throw new NeonProvisioningError(503, "NEON_TARGETS_INVALID", "AppFactory Neon target configuration is invalid.");
    }
    const value = raw as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (
      keys.join(",") !== [
        "branchId", "createMissing", "databaseName", "projectId", "roleName", "secretName", "workerName"
      ].sort().join(",") ||
      typeof value.projectId !== "string" || !PROJECT_IDENTIFIER.test(value.projectId) ||
      typeof value.branchId !== "string" || !PROJECT_IDENTIFIER.test(value.branchId) ||
      typeof value.databaseName !== "string" || !IDENTIFIER.test(value.databaseName) ||
      typeof value.roleName !== "string" || !IDENTIFIER.test(value.roleName) ||
      typeof value.workerName !== "string" || !WORKER_IDENTIFIER.test(value.workerName) ||
      typeof value.secretName !== "string" || !SECRET_IDENTIFIER.test(value.secretName) ||
      typeof value.createMissing !== "boolean"
    ) {
      throw new NeonProvisioningError(503, "NEON_TARGETS_INVALID", "AppFactory Neon target configuration is invalid.");
    }
    const repoSlug = repository.split("/")[1];
    // A repo may only provision its own named Worker/secret; AppFactory's
    // global Worker is reserved for the hard-coded SEO Monitor allowlist.
    const secretPrefix = repoSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_";
    if (
      value.workerName !== repoSlug + "-api" ||
      !(value.secretName as string).startsWith(secretPrefix)
    ) {
      throw new NeonProvisioningError(503, "NEON_TARGET_SCOPE_INVALID", "Neon target Worker/secret scope is invalid.");
    }
    targets[repository] = value as unknown as NeonTarget;
  }
  if (Object.keys(targets).length > 40) {
    throw new NeonProvisioningError(503, "NEON_TARGETS_INVALID", "Too many Neon targets configured.");
  }
  return targets;
}

export function approvedNeonTarget(env: Env, repository: string): NeonTarget {
  const targets = parseTargets(env);
  const target = targets[repository];
  if (!target) {
    throw new NeonProvisioningError(403, "NEON_TARGET_NOT_APPROVED", "Repository has no approved Neon target.");
  }
  return target;
}

function validateRequest(claims: GitHubOidcClaims, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new NeonProvisioningError(400, "NEON_REQUEST_INVALID", "Expected repository identity.");
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.repository !== "string") {
    throw new NeonProvisioningError(400, "NEON_REQUEST_INVALID", "Only repository identity is permitted.");
  }
  if (body.repository !== claims.repository) {
    throw new NeonProvisioningError(403, "NEON_REPOSITORY_MISMATCH", "Repository identity mismatch.");
  }
  return body.repository;
}

async function neonRequest<T>(
  env: Env,
  fetcher: NeonDependencies["fetch"],
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<T> {
  if (!env.NEON_API_KEY) {
    throw new NeonProvisioningError(
      503, "NEON_API_KEY_NOT_CONFIGURED",
      "AppFactory needs its private Neon API key to provision database connections."
    );
  }
  let response: Response;
  try {
    response = await fetcher(NEON_BASE + path, {
      method,
      headers: {
        Authorization: "Bearer " + env.NEON_API_KEY,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw new NeonProvisioningError(502, "NEON_REQUEST_FAILED", "Neon API request failed.");
  }
  if (!response.ok) {
    const code =
      response.status === 401 || response.status === 403
        ? "NEON_API_PERMISSION_DENIED"
        : response.status === 409 || response.status === 423
          ? "NEON_STATE_CONFLICT"
          : "NEON_API_UNAVAILABLE";
    throw new NeonProvisioningError(
      response.status === 409 || response.status === 423 ? 409 : 502,
      code,
      "Neon API returned an error; no credentials were logged."
    );
  }
  try {
    return await response.json() as T;
  } catch {
    throw new NeonProvisioningError(502, "NEON_RESPONSE_INVALID", "Neon API returned an invalid response.");
  }
}

function validateNeonConnection(uri: string, target: NeonTarget): string {
  let u: URL;
  try { u = new URL(uri); }
  catch {
    throw new NeonProvisioningError(502, "NEON_CONNECTION_INVALID", "Neon returned an invalid PostgreSQL URI.");
  }
  if (
    !["postgresql:", "postgres:"].includes(u.protocol) ||
    !u.hostname.endsWith(".neon.tech") ||
    u.username !== target.roleName ||
    decodeURIComponent(u.pathname) !== "/" + target.databaseName ||
    !u.password ||
    Boolean(u.hash) ||
    (u.port !== "" && u.port !== "5432")
  ) {
    throw new NeonProvisioningError(502, "NEON_CONNECTION_MISMATCH", "Neon returned an unexpected connection.");
  }
  // Force TLS in the storage layer; do not forward parameters that may
  // supersede explicit pg TLS certificate verification.
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) u.searchParams.delete(name);
  return u.toString();
}

/**
 * Idempotently prepare only an operator-approved Neon target and store its
 * PostgreSQL connection as a Cloudflare Worker secret. Never return URLs,
 * passwords, API key material, or upstream error bodies to GitHub.
 */
export async function provisionApprovedNeon(
  env: Env,
  claims: GitHubOidcClaims,
  input: unknown,
  deps: NeonDependencies
): Promise<ProvisioningResult> {
  const repository = validateRequest(claims, input);
  const target = approvedNeonTarget(env, repository);

  let secretNames: Set<string>;
  try {
    secretNames = await deps.listSecretNames(env, target.workerName);
  } catch {
    throw new NeonProvisioningError(502, "CLOUDFLARE_SECRET_LOOKUP_FAILED", "Unable to check the approved Worker secret.");
  }
  if (secretNames.has(target.secretName)) {
    return {
      status: "ALREADY_CONFIGURED",
      repository, database: target.databaseName,
      worker: target.workerName, secretName: target.secretName,
      createdDatabase: false, createdRole: false
    };
  }

  // Do not contact Neon or create resources until the private API key exists.
  if (!env.NEON_API_KEY) {
    throw new NeonProvisioningError(
      503, "NEON_API_KEY_NOT_CONFIGURED", "AppFactory's Neon API key must be configured once."
    );
  }

  const project = encodeURIComponent(target.projectId);
  const branch = encodeURIComponent(target.branchId);
  const base = `/projects/${project}/branches/${branch}`;
  const roles = await neonRequest<{ roles: Array<{ name: string }> }>(
    env, deps.fetch, base + "/roles"
  );
  if (!Array.isArray(roles.roles)) {
    throw new NeonProvisioningError(502, "NEON_RESPONSE_INVALID", "Neon roles response is invalid.");
  }
  const databases = await neonRequest<{ databases: Array<{ name: string; owner_name: string }> }>(
    env, deps.fetch, base + "/databases"
  );
  if (!Array.isArray(databases.databases)) {
    throw new NeonProvisioningError(502, "NEON_RESPONSE_INVALID", "Neon databases response is invalid.");
  }

  const existingDb = databases.databases.find(d => d.name === target.databaseName);
  if (existingDb && existingDb.owner_name !== target.roleName) {
    throw new NeonProvisioningError(409, "NEON_DATABASE_OWNER_MISMATCH", "Existing database belongs to a different PostgreSQL role.");
  }
  let createdRole = false;
  let createdDatabase = false;

  if (!roles.roles.some(role => role.name === target.roleName)) {
    if (!target.createMissing) {
      throw new NeonProvisioningError(409, "NEON_ROLE_MISSING", "Approved PostgreSQL role does not exist.");
    }
    await neonRequest(env, deps.fetch, base + "/roles", "POST", {role:{name:target.roleName}});
    createdRole = true;
  }
  if (!existingDb) {
    if (!target.createMissing) {
      throw new NeonProvisioningError(409, "NEON_DATABASE_MISSING", "Approved PostgreSQL database does not exist.");
    }
    await neonRequest(
      env, deps.fetch, base + "/databases", "POST",
      { database: {name:target.databaseName, owner_name:target.roleName} }
    );
    createdDatabase = true;
  }

  const query = new URLSearchParams({
    branch_id: target.branchId,
    database_name: target.databaseName,
    role_name: target.roleName,
    pooled: "false"
  });
  const response = await neonRequest<{uri: string}>(
    env, deps.fetch, `/projects/${project}/connection_uri?${query.toString()}`
  );
  if (typeof response.uri !== "string") {
    throw new NeonProvisioningError(502, "NEON_RESPONSE_INVALID", "Neon connection response is invalid.");
  }
  const connection = validateNeonConnection(response.uri, target);
  try {
    await deps.putSecret(env, target.workerName, target.secretName, connection);
  } catch {
    throw new NeonProvisioningError(502, "CLOUDFLARE_SECRET_WRITE_FAILED", "Unable to save the approved Worker secret.");
  }
  return {
    status: "PROVISIONED",
    repository, database: target.databaseName,
    worker: target.workerName, secretName: target.secretName,
    createdDatabase, createdRole
  };
}
