import type { Env } from "./types";
import type { GitHubOidcClaims } from "./auth";

const NEON_BASE = "https://console.neon.tech/api/v2";
const SEO_REPOSITORY = "Trigenys/trigenys-seo-monitor";
const EDITORIAL_OS_REPOSITORY = "Trigenys/trigenys-editorial-os";

export interface NeonAuthTarget {
  provider: "better_auth";
  applicationName: string;
  baseUrlSecretName: string;
}

export interface NeonTarget {
  projectId: string;
  branchId: string;
  databaseName: string;
  roleName: string;
  workerName: string;
  secretName: string;
  createMissing: boolean;
  auth?: NeonAuthTarget;
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

const EDITORIAL_OS_STAGING_TARGET: NeonTarget = {
  projectId: "little-frog-93793324",
  branchId: "br-twilight-star-b2orr8hw",
  databaseName: "editorial_os_staging",
  roleName: "editorial_os_staging",
  workerName: "appfactory-api",
  secretName: "HYPERDRIVE_DATABASE_URL__TRIGENYS_EDITORIAL_OS_STAGING",
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
  auth: {
    enabled: boolean;
    created: boolean;
    baseUrlSecretName: string | null;
  };
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
  const targets: Record<string, NeonTarget> = {
    [SEO_REPOSITORY]: SEO_TARGET,
    [EDITORIAL_OS_REPOSITORY]: EDITORIAL_OS_STAGING_TARGET
  };
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
      repository === EDITORIAL_OS_REPOSITORY ||
      !/^Trigenys\/[a-zA-Z0-9_.-]{1,90}$/.test(repository) ||
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      throw new NeonProvisioningError(503, "NEON_TARGETS_INVALID", "AppFactory Neon target configuration is invalid.");
    }
    const value = raw as Record<string, unknown>;
    const allowedKeys = new Set([
      "branchId", "createMissing", "databaseName", "projectId", "roleName", "secretName", "workerName", "auth"
    ]);
    if (
      Object.keys(value).some(key => !allowedKeys.has(key)) ||
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

    let auth: NeonAuthTarget | undefined;
    if (value.auth !== undefined) {
      if (!value.auth || typeof value.auth !== "object" || Array.isArray(value.auth)) {
        throw new NeonProvisioningError(503, "NEON_TARGETS_INVALID", "AppFactory Neon auth target configuration is invalid.");
      }
      const rawAuth = value.auth as Record<string, unknown>;
      const authKeys = Object.keys(rawAuth).sort();
      if (
        authKeys.join(",") !== ["applicationName", "baseUrlSecretName", "provider"].sort().join(",") ||
        rawAuth.provider !== "better_auth" ||
        typeof rawAuth.applicationName !== "string" ||
        rawAuth.applicationName.trim().length < 1 ||
        rawAuth.applicationName.length > 128 ||
        typeof rawAuth.baseUrlSecretName !== "string" ||
        !SECRET_IDENTIFIER.test(rawAuth.baseUrlSecretName)
      ) {
        throw new NeonProvisioningError(503, "NEON_TARGETS_INVALID", "AppFactory Neon auth target configuration is invalid.");
      }
      auth = {
        provider: "better_auth",
        applicationName: rawAuth.applicationName.trim(),
        baseUrlSecretName: rawAuth.baseUrlSecretName
      };
    }

    const repoSlug = repository.split("/")[1];
    // A configurable repo may only provision its own named Worker/secrets.
    // AppFactory's global Worker is reserved for hard-coded control-plane targets.
    const secretPrefix = repoSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_";
    if (
      value.workerName !== repoSlug + "-api" ||
      !(value.secretName as string).startsWith(secretPrefix) ||
      (auth && !auth.baseUrlSecretName.startsWith(secretPrefix))
    ) {
      throw new NeonProvisioningError(503, "NEON_TARGET_SCOPE_INVALID", "Neon target Worker/secret scope is invalid.");
    }
    targets[repository] = {
      projectId: value.projectId,
      branchId: value.branchId,
      databaseName: value.databaseName,
      roleName: value.roleName,
      workerName: value.workerName,
      secretName: value.secretName,
      createMissing: value.createMissing,
      ...(auth ? { auth } : {})
    } as NeonTarget;
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
  method: "GET" | "POST" | "PATCH" = "GET",
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

type NeonAuthResponse = {
  auth_provider?: string;
  db_name?: string;
  base_url?: string;
  jwks_url?: string;
};

function validateNeonAuthBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch {
    throw new NeonProvisioningError(502, "NEON_AUTH_URL_INVALID", "Neon Auth returned an invalid base URL.");
  }
  if (
    url.protocol !== "https:" ||
    Boolean(url.username) ||
    Boolean(url.password) ||
    Boolean(url.hash) ||
    !(url.hostname.endsWith(".neon.tech") || url.hostname.endsWith(".neon.build"))
  ) {
    throw new NeonProvisioningError(502, "NEON_AUTH_URL_INVALID", "Neon Auth returned an unexpected base URL.");
  }
  return url.toString().replace(/\/$/, "");
}

async function ensureManagedAuth(
  env: Env,
  deps: NeonDependencies,
  target: NeonTarget,
  base: string
): Promise<{ created: boolean; baseUrl: string }> {
  if (!target.auth) {
    throw new NeonProvisioningError(503, "NEON_AUTH_TARGET_INVALID", "Managed Auth target is missing.");
  }

  let response: Response;
  try {
    response = await deps.fetch(NEON_BASE + base + "/auth", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + env.NEON_API_KEY,
        Accept: "application/json"
      }
    });
  } catch {
    throw new NeonProvisioningError(502, "NEON_AUTH_REQUEST_FAILED", "Neon Auth API request failed.");
  }

  let created = false;
  let auth: NeonAuthResponse;
  if (response.status === 404) {
    auth = await neonRequest<NeonAuthResponse>(
      env,
      deps.fetch,
      base + "/auth",
      "POST",
      {
        auth_provider: target.auth.provider,
        database_name: target.databaseName
      }
    );
    created = true;
  } else {
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "NEON_API_PERMISSION_DENIED"
          : "NEON_AUTH_API_UNAVAILABLE";
      throw new NeonProvisioningError(502, code, "Neon Auth API returned an error; no credentials were logged.");
    }
    try {
      auth = await response.json() as NeonAuthResponse;
    } catch {
      throw new NeonProvisioningError(502, "NEON_RESPONSE_INVALID", "Neon Auth API returned an invalid response.");
    }
  }

  if (
    auth.auth_provider !== target.auth.provider ||
    (auth.db_name !== undefined && auth.db_name !== target.databaseName) ||
    typeof auth.base_url !== "string"
  ) {
    throw new NeonProvisioningError(409, "NEON_AUTH_TARGET_MISMATCH", "Existing Neon Auth configuration does not match the approved target.");
  }

  const baseUrl = validateNeonAuthBaseUrl(auth.base_url);
  await neonRequest(
    env,
    deps.fetch,
    base + "/auth/config",
    "PATCH",
    { name: target.auth.applicationName }
  );

  return { created, baseUrl };
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
  const databaseSecretConfigured = secretNames.has(target.secretName);
  const authSecretConfigured =
    !target.auth || secretNames.has(target.auth.baseUrlSecretName);
  if (databaseSecretConfigured && authSecretConfigured) {
    return {
      status: "ALREADY_CONFIGURED",
      repository, database: target.databaseName,
      worker: target.workerName, secretName: target.secretName,
      createdDatabase: false, createdRole: false,
      auth: {
        enabled: Boolean(target.auth),
        created: false,
        baseUrlSecretName: target.auth?.baseUrlSecretName || null
      }
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
    if (!databaseSecretConfigured) {
      await deps.putSecret(env, target.workerName, target.secretName, connection);
    }
  } catch {
    throw new NeonProvisioningError(502, "CLOUDFLARE_SECRET_WRITE_FAILED", "Unable to save the approved Worker secret.");
  }

  let authCreated = false;
  if (target.auth && !authSecretConfigured) {
    const managedAuth = await ensureManagedAuth(env, deps, target, base);
    authCreated = managedAuth.created;
    try {
      await deps.putSecret(
        env,
        target.workerName,
        target.auth.baseUrlSecretName,
        managedAuth.baseUrl
      );
    } catch {
      throw new NeonProvisioningError(502, "CLOUDFLARE_SECRET_WRITE_FAILED", "Unable to save the approved Neon Auth Worker variable.");
    }
  }

  return {
    status: "PROVISIONED",
    repository, database: target.databaseName,
    worker: target.workerName, secretName: target.secretName,
    createdDatabase, createdRole,
    auth: {
      enabled: Boolean(target.auth),
      created: authCreated,
      baseUrlSecretName: target.auth?.baseUrlSecretName || null
    }
  };
}
