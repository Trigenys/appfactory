import type { CloudflareApiResponse, Env, GitHubRepository } from "./types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const HYPERDRIVE_MARKER_PATH = ".appfactory/hyperdrive.json";
const DATABASE_URL_VARIABLE = "APPFACTORY_DATABASE_URL";
const MIGRATION_RECIPE_VARIABLE = "APPFACTORY_MIGRATION_RECIPE";

export const PYTHON_ALEMBIC_MIGRATION_RECIPE = "python-alembic-v1";
export const PYTHON_ALEMBIC_BUILD_COMMAND =
  'python -m pip install --user uv && export PATH="$HOME/.local/bin:$PATH" && uv run --group dev alembic upgrade head && rm -rf .venv && unset APPFACTORY_DATABASE_URL && bash scripts/package_worker.sh dry-run wrangler.production.toml ../worker-dist-production';
export const PYTHON_ALEMBIC_DEPLOY_COMMAND =
  'unset APPFACTORY_DATABASE_URL && bash scripts/package_worker.sh deploy wrangler.production.toml';

interface DatabaseOrigin {
  scheme: "postgres" | "postgresql" | "mysql";
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

interface ManagedDatabaseProfile {
  origin: DatabaseOrigin;
  migration?: {
    sslmode?: "require" | "verify-full" | "disable";
  };
}

interface HyperdriveMarker {
  schemaVersion: number;
  provider: "cloudflare-hyperdrive";
  repository: string;
  workerName: string;
  profile: string;
  hyperdriveName: string;
  binding: string;
  id: string;
}

interface GitHubFile {
  sha: string;
  content: string;
  encoding: string;
}

interface BuildEnvironmentVariable {
  created_on?: string;
  is_secret: boolean;
  value?: string | null;
}

type BuildEnvironmentVariables = Record<string, BuildEnvironmentVariable>;

export interface DatabaseMigrationGateResult {
  recipe: typeof PYTHON_ALEMBIC_MIGRATION_RECIPE;
  profile: string;
  triggerUuid: string;
  buildSecret: typeof DATABASE_URL_VARIABLE;
  configured: boolean;
}

export class DatabaseMigrationGateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requiredPermissions: string[] = []
  ) {
    super(message);
  }
}

class CloudflareApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string
  ) {
    super(`Cloudflare API ${status} on ${path}: ${detail}`);
  }
}

async function githubRequest<T>(
  token: string,
  path: string
): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "Trigenys-AppFactory"
    }
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status} on ${path}: ${(await response.text()).slice(0, 500)}`
    );
  }
  return await response.json() as T;
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

async function readGitHubFile(
  token: string,
  repository: GitHubRepository,
  path: string
): Promise<GitHubFile | null> {
  const [owner, repo] = repository.full_name.split("/");
  const endpoint =
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const response = await fetch(`${GITHUB_API}${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "Trigenys-AppFactory"
    }
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status} on ${endpoint}: ${(await response.text()).slice(0, 500)}`
    );
  }
  return await response.json() as GitHubFile;
}

async function readHyperdriveMarker(
  token: string,
  repository: GitHubRepository
): Promise<HyperdriveMarker> {
  const file = await readGitHubFile(token, repository, HYPERDRIVE_MARKER_PATH);
  if (!file) {
    throw new DatabaseMigrationGateError(
      "HYPERDRIVE_REQUIRED",
      "Database migration gating requires an AppFactory-managed Hyperdrive marker first."
    );
  }
  if (file.encoding !== "base64") {
    throw new DatabaseMigrationGateError(
      "HYPERDRIVE_MARKER_INVALID",
      "Existing Hyperdrive marker uses an unsupported encoding."
    );
  }

  let marker: HyperdriveMarker;
  try {
    marker = JSON.parse(decodeBase64(file.content)) as HyperdriveMarker;
  } catch {
    throw new DatabaseMigrationGateError(
      "HYPERDRIVE_MARKER_INVALID",
      "Existing Hyperdrive marker is not valid JSON."
    );
  }

  if (
    marker.schemaVersion !== 1 ||
    marker.provider !== "cloudflare-hyperdrive" ||
    marker.repository !== repository.full_name ||
    marker.workerName !== `${repository.name}-api`.slice(0, 63) ||
    marker.profile !== `${repository.name}-production`
  ) {
    throw new DatabaseMigrationGateError(
      "HYPERDRIVE_MARKER_MISMATCH",
      "Existing Hyperdrive marker does not match the managed Worker/database identity."
    );
  }

  return marker;
}

function parseProfiles(env: Env): Record<string, ManagedDatabaseProfile> {
  const raw = env.HYPERDRIVE_DATABASE_PROFILES?.trim();
  if (!raw) {
    throw new DatabaseMigrationGateError(
      "HYPERDRIVE_DATABASE_PROFILES_REQUIRED",
      "AppFactory runtime is missing HYPERDRIVE_DATABASE_PROFILES."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DatabaseMigrationGateError(
      "HYPERDRIVE_DATABASE_PROFILES_INVALID",
      "HYPERDRIVE_DATABASE_PROFILES must contain valid JSON."
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DatabaseMigrationGateError(
      "HYPERDRIVE_DATABASE_PROFILES_INVALID",
      "HYPERDRIVE_DATABASE_PROFILES must be a JSON object keyed by profile name."
    );
  }

  return parsed as Record<string, ManagedDatabaseProfile>;
}

function databaseUrl(profileName: string, profile: ManagedDatabaseProfile | undefined): string {
  const origin = profile?.origin;
  if (
    !origin ||
    !["postgres", "postgresql"].includes(origin.scheme) ||
    typeof origin.host !== "string" ||
    !origin.host.trim() ||
    typeof origin.database !== "string" ||
    !origin.database.trim() ||
    typeof origin.user !== "string" ||
    !origin.user.trim() ||
    typeof origin.password !== "string" ||
    !origin.password
  ) {
    throw new DatabaseMigrationGateError(
      "POSTGRES_MIGRATION_PROFILE_INVALID",
      `Database profile ${profileName} must contain a PostgreSQL origin with host, database, user and password.`
    );
  }

  const port = origin.port ?? 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DatabaseMigrationGateError(
      "POSTGRES_MIGRATION_PROFILE_INVALID",
      `Database profile ${profileName} has an invalid PostgreSQL port.`
    );
  }

  const sslmode = profile?.migration?.sslmode || "require";
  const host =
    origin.host.includes(":") && !origin.host.startsWith("[")
      ? `[${origin.host}]`
      : origin.host;

  return (
    `postgresql://${encodeURIComponent(origin.user)}:` +
    `${encodeURIComponent(origin.password)}@${host}:${port}/` +
    `${encodeURIComponent(origin.database)}?sslmode=${encodeURIComponent(sslmode)}`
  );
}

function assertBuildsToken(env: Env): asserts env is Env & {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
} {
  if (!env.CLOUDFLARE_ACCOUNT_ID) {
    throw new DatabaseMigrationGateError(
      "CLOUDFLARE_ACCOUNT_ID_REQUIRED",
      "AppFactory runtime is missing CLOUDFLARE_ACCOUNT_ID."
    );
  }
  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new DatabaseMigrationGateError(
      "CLOUDFLARE_API_TOKEN_REQUIRED",
      "Database migration gating requires the AppFactory Workers Builds API token."
    );
  }
}

async function buildsRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  assertBuildsToken(env);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${CLOUDFLARE_API}${path}`, { ...init, headers });
  const raw = await response.text();
  let payload: CloudflareApiResponse<T> | null = null;
  try {
    payload = raw ? JSON.parse(raw) as CloudflareApiResponse<T> : null;
  } catch {
    throw new CloudflareApiError(
      response.status,
      path,
      `Malformed response: ${raw.slice(0, 240)}`
    );
  }

  if (!response.ok || !payload?.success) {
    const detail = payload?.errors?.map((item) => `${item.code}: ${item.message}`).join("; ") ||
      `HTTP ${response.status}`;
    throw new CloudflareApiError(response.status, path, detail);
  }

  return payload.result;
}

function migrationPermissionError(error: unknown, operation: string): never {
  if (error instanceof CloudflareApiError && (error.status === 401 || error.status === 403)) {
    throw new DatabaseMigrationGateError(
      "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED",
      `Cloudflare denied ${operation} on ${error.path} (HTTP ${error.status}; ${error.detail.slice(0, 200)}).`,
      ["Workers CI Write"]
    );
  }
  throw error;
}

async function configureBuildVariables(
  env: Env,
  triggerUuid: string,
  directDatabaseUrl: string
): Promise<void> {
  const path =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/builds/triggers/${encodeURIComponent(triggerUuid)}/environment_variables`;

  try {
    await buildsRequest<BuildEnvironmentVariables>(env, path, {
      method: "PATCH",
      body: JSON.stringify({
        [DATABASE_URL_VARIABLE]: {
          value: directDatabaseUrl,
          is_secret: true
        },
        [MIGRATION_RECIPE_VARIABLE]: {
          value: PYTHON_ALEMBIC_MIGRATION_RECIPE,
          is_secret: false
        }
      })
    });
  } catch (error) {
    migrationPermissionError(error, "configure Workers Builds migration variables");
  }

  let variables: BuildEnvironmentVariables;
  try {
    variables = await buildsRequest<BuildEnvironmentVariables>(env, path);
  } catch (error) {
    migrationPermissionError(error, "verify Workers Builds migration variables");
  }

  const databaseSecret = variables[DATABASE_URL_VARIABLE];
  const recipe = variables[MIGRATION_RECIPE_VARIABLE];

  if (
    !databaseSecret ||
    databaseSecret.is_secret !== true ||
    databaseSecret.value != null ||
    !recipe ||
    recipe.is_secret !== false ||
    recipe.value !== PYTHON_ALEMBIC_MIGRATION_RECIPE
  ) {
    throw new DatabaseMigrationGateError(
      "MIGRATION_BUILD_VARIABLE_VERIFICATION_FAILED",
      "Workers Builds did not report the expected masked database secret and migration recipe after configuration."
    );
  }
}

export async function configureDatabaseMigrationGate(
  githubToken: string,
  env: Env,
  repository: GitHubRepository,
  triggerUuid: string,
  recipe: string
): Promise<DatabaseMigrationGateResult> {
  if (recipe !== PYTHON_ALEMBIC_MIGRATION_RECIPE) {
    throw new DatabaseMigrationGateError(
      "MIGRATION_RECIPE_FORBIDDEN",
      `Unsupported database migration recipe: ${recipe}`
    );
  }

  const marker = await readHyperdriveMarker(githubToken, repository);
  const profiles = parseProfiles(env);
  const directDatabaseUrl = databaseUrl(marker.profile, profiles[marker.profile]);

  await configureBuildVariables(env, triggerUuid, directDatabaseUrl);

  return {
    recipe: PYTHON_ALEMBIC_MIGRATION_RECIPE,
    profile: marker.profile,
    triggerUuid,
    buildSecret: DATABASE_URL_VARIABLE,
    configured: true
  };
}
