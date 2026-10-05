import type { CloudflareApiResponse, Env, GitHubRepository } from "./types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const WORKER_MARKER_PATH = ".appfactory/worker-infrastructure.json";
const HYPERDRIVE_MARKER_PATH = ".appfactory/hyperdrive.json";
const STAGING_HYPERDRIVE_MARKER_PATH = ".appfactory/hyperdrive.staging.json";
const SCHEMA_VERSION = 1;
const DEFAULT_BINDING = "HYPERDRIVE";

export type InfrastructureEnvironment = "production" | "staging";

interface DatabaseOrigin {
  scheme: "postgres" | "postgresql" | "mysql";
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

interface HyperdriveProfile {
  origin: DatabaseOrigin;
  caching?: {
    disabled?: boolean;
    max_age?: number;
    stale_while_revalidate?: number;
  };
  origin_connection_limit?: number;
}

interface HyperdriveConfig {
  id: string;
  name: string;
  origin?: {
    scheme?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
  };
  caching?: {
    disabled?: boolean;
    max_age?: number;
    stale_while_revalidate?: number;
  };
  origin_connection_limit?: number;
}

interface WorkerScript {
  id: string;
  tag?: string;
}

interface WorkerBinding {
  name: string;
  type: string;
  id?: string;
}

interface WorkerSettings {
  bindings?: WorkerBinding[];
}

interface GitHubFile {
  sha: string;
  content: string;
  encoding: string;
}

interface WorkerMarker {
  schemaVersion: number;
  provider: string;
  repository: string;
  workerName: string;
  environment?: InfrastructureEnvironment;
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
  environment?: InfrastructureEnvironment;
}

export interface HyperdriveProvisioningRequest {
  repository: string;
  environment?: InfrastructureEnvironment;
  workerName?: string;
  profile?: string;
  hyperdriveName?: string;
  binding?: string;
}

export interface HyperdriveProvisioningResult {
  repository: string;
  worker: string;
  hyperdrive: {
    id: string;
    name: string;
    created: boolean;
    updated: boolean;
  };
  binding: {
    name: string;
    configured: boolean;
    deferredToDeploy: boolean;
  };
  marker: {
    path: string;
    updated: boolean;
  };
}

export interface ManagedHyperdriveEvidence {
  declared: boolean;
  binding: string | null;
  id: string | null;
  actualId: string | null;
  configured: boolean;
}

export class HyperdriveProvisioningError extends Error {
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

function assertCloudflareConfig(env: Env): asserts env is Env & {
  CLOUDFLARE_ACCOUNT_ID: string;
} {
  if (!env.CLOUDFLARE_ACCOUNT_ID) {
    throw new HyperdriveProvisioningError(
      "CLOUDFLARE_ACCOUNT_ID_REQUIRED",
      "AppFactory runtime is missing CLOUDFLARE_ACCOUNT_ID."
    );
  }
  if (!env.CLOUDFLARE_API_TOKEN && !env.CLOUDFLARE_PAGES_D1_TOKEN) {
    throw new HyperdriveProvisioningError(
      "CLOUDFLARE_RESOURCE_TOKEN_REQUIRED",
      "AppFactory runtime is missing a Cloudflare resource API token."
    );
  }
}

async function cloudflareRequestWithToken<T>(
  token: string,
  path: string,
  init: RequestInit
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

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

async function cloudflareRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  assertCloudflareConfig(env);

  const preferredToken = env.CLOUDFLARE_PAGES_D1_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (!preferredToken) {
    throw new HyperdriveProvisioningError(
      "CLOUDFLARE_RESOURCE_TOKEN_REQUIRED",
      "AppFactory runtime is missing a Cloudflare resource API token."
    );
  }

  try {
    return await cloudflareRequestWithToken<T>(preferredToken, path, init);
  } catch (error) {
    const fallbackToken = env.CLOUDFLARE_API_TOKEN;
    const canRetryWithFallback =
      error instanceof CloudflareApiError &&
      (error.status === 401 || error.status === 403) &&
      Boolean(env.CLOUDFLARE_PAGES_D1_TOKEN) &&
      Boolean(fallbackToken) &&
      fallbackToken !== preferredToken;

    if (!canRetryWithFallback || !fallbackToken) throw error;

    return cloudflareRequestWithToken<T>(fallbackToken, path, init);
  }
}

function permissionError(
  error: unknown,
  operation: string,
  permissions: string[]
): never {
  if (error instanceof CloudflareApiError && (error.status === 401 || error.status === 403)) {
    throw new HyperdriveProvisioningError(
      "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED",
      `Cloudflare denied ${operation} on ${error.path} (HTTP ${error.status}; ${error.detail.slice(0, 200)}). Hyperdrive and Worker binding operations use the AppFactory resource API token.`,
      permissions
    );
  }
  throw error;
}

async function githubRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "Trigenys-AppFactory",
      ...(init.headers || {})
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

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function repositoryByFullName(
  token: string,
  fullName: string
): Promise<GitHubRepository> {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new HyperdriveProvisioningError(
      "INVALID_REPOSITORY",
      "Repository must use owner/name format."
    );
  }
  return githubRequest<GitHubRepository>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  );
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

function hyperdriveMarkerPath(environment: InfrastructureEnvironment): string {
  return environment === "staging"
    ? STAGING_HYPERDRIVE_MARKER_PATH
    : HYPERDRIVE_MARKER_PATH;
}

async function writeMarker(
  token: string,
  repository: GitHubRepository,
  marker: HyperdriveMarker,
  markerPath: string,
  currentSha?: string
): Promise<void> {
  const [owner, repo] = repository.full_name.split("/");
  await githubRequest(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${markerPath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: "chore(appfactory): claim Hyperdrive infrastructure",
        content: encodeBase64(`${JSON.stringify(marker, null, 2)}\n`),
        branch: repository.default_branch || "main",
        ...(currentSha ? { sha: currentSha } : {})
      })
    }
  );
}

function expectedWorkerName(
  repository: GitHubRepository,
  environment: InfrastructureEnvironment
): string {
  return environment === "staging"
    ? `${repository.name}-staging-api`.slice(0, 63)
    : `${repository.name}-api`.slice(0, 63);
}

function expectedProfile(
  repository: GitHubRepository,
  environment: InfrastructureEnvironment
): string {
  return environment === "staging"
    ? `${repository.name}-staging`
    : `${repository.name}-production`;
}

function validateRequest(
  repository: GitHubRepository,
  callerRepository: string,
  input: HyperdriveProvisioningRequest
): Required<HyperdriveProvisioningRequest> {
  if (callerRepository !== repository.full_name || input.repository !== repository.full_name) {
    throw new HyperdriveProvisioningError(
      "REPOSITORY_MISMATCH",
      "OIDC caller may provision Hyperdrive only for its own repository."
    );
  }

  const environment = input.environment || "production";
  if (environment !== "production" && environment !== "staging") {
    throw new HyperdriveProvisioningError(
      "INFRASTRUCTURE_ENVIRONMENT_FORBIDDEN",
      "Infrastructure environment must be production or staging."
    );
  }

  const workerName = input.workerName || expectedWorkerName(repository, environment);
  if (workerName !== expectedWorkerName(repository, environment)) {
    throw new HyperdriveProvisioningError(
      "WORKER_NAME_FORBIDDEN",
      `Worker name must be ${expectedWorkerName(repository, environment)}.`
    );
  }

  const profile = input.profile || expectedProfile(repository, environment);
  if (profile !== expectedProfile(repository, environment)) {
    throw new HyperdriveProvisioningError(
      "DATABASE_PROFILE_FORBIDDEN",
      `Database profile must be ${expectedProfile(repository, environment)}.`
    );
  }

  const hyperdriveName = input.hyperdriveName || expectedProfile(repository, environment);
  if (hyperdriveName !== expectedProfile(repository, environment)) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_NAME_FORBIDDEN",
      `Hyperdrive name must be ${expectedProfile(repository, environment)}.`
    );
  }

  const binding = input.binding || DEFAULT_BINDING;
  if (binding !== DEFAULT_BINDING) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_BINDING_FORBIDDEN",
      `Managed database binding must be ${DEFAULT_BINDING}.`
    );
  }

  return {
    repository: repository.full_name,
    environment,
    workerName,
    profile,
    hyperdriveName,
    binding
  };
}

function parseProfiles(env: Env): Record<string, HyperdriveProfile> {
  const raw = env.HYPERDRIVE_DATABASE_PROFILES?.trim();
  if (!raw) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_DATABASE_PROFILES_REQUIRED",
      "AppFactory runtime is missing HYPERDRIVE_DATABASE_PROFILES."
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_DATABASE_PROFILES_INVALID",
      "HYPERDRIVE_DATABASE_PROFILES must contain valid JSON."
    );
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_DATABASE_PROFILES_INVALID",
      "HYPERDRIVE_DATABASE_PROFILES must be a JSON object keyed by profile name."
    );
  }

  return value as Record<string, HyperdriveProfile>;
}

function validateProfile(name: string, profile: HyperdriveProfile | undefined): HyperdriveProfile {
  const origin = profile?.origin;
  if (
    !origin ||
    !["postgres", "postgresql", "mysql"].includes(origin.scheme) ||
    typeof origin.host !== "string" ||
    !origin.host.trim() ||
    typeof origin.database !== "string" ||
    !origin.database.trim() ||
    typeof origin.user !== "string" ||
    !origin.user.trim() ||
    typeof origin.password !== "string" ||
    !origin.password
  ) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_DATABASE_PROFILE_INVALID",
      `Database profile ${name} is missing a supported scheme, host, database, user, or password.`
    );
  }

  if (
    origin.port !== undefined &&
    (!Number.isInteger(origin.port) || origin.port < 1 || origin.port > 65535)
  ) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_DATABASE_PROFILE_INVALID",
      `Database profile ${name} has an invalid port.`
    );
  }

  return profile;
}

function encodeDatabaseComponent(value: string): string {
  return encodeURIComponent(value);
}

export function managedDatabaseUrl(env: Env, profileName: string): string {
  const profiles = parseProfiles(env);
  const profile = validateProfile(profileName, profiles[profileName]);
  const origin = profile.origin;
  const scheme = origin.scheme === "mysql" ? "mysql+pymysql" : "postgresql+psycopg";
  const port = origin.port ?? (origin.scheme === "mysql" ? 3306 : 5432);

  return `${scheme}://${encodeDatabaseComponent(origin.user)}:${encodeDatabaseComponent(origin.password)}@${origin.host}:${port}/${encodeDatabaseComponent(origin.database)}`;
}


function workerMarkerPath(environment: InfrastructureEnvironment): string {
  return environment === "staging"
    ? ".appfactory/worker-infrastructure.staging.json"
    : WORKER_MARKER_PATH;
}

async function assertManagedWorker(
  githubToken: string,
  env: Env,
  repository: GitHubRepository,
  workerName: string,
  environment: InfrastructureEnvironment
): Promise<void> {
  const markerFile = await readGitHubFile(
    githubToken,
    repository,
    workerMarkerPath(environment)
  );
  if (!markerFile) {
    throw new HyperdriveProvisioningError(
      "BROWNFIELD_WORKER_UNCLAIMED",
      `Worker ${workerName} has no AppFactory Worker marker; refusing silent adoption.`
    );
  }
  if (markerFile.encoding !== "base64") {
    throw new HyperdriveProvisioningError(
      "INFRASTRUCTURE_MARKER_INVALID",
      "Existing AppFactory Worker marker uses an unsupported encoding."
    );
  }

  const marker = JSON.parse(decodeBase64(markerFile.content)) as WorkerMarker;
  if (
    marker.schemaVersion !== 1 ||
    marker.provider !== "cloudflare-workers-builds" ||
    marker.repository !== repository.full_name ||
    marker.workerName !== workerName ||
    (marker.environment || "production") !== environment
  ) {
    throw new HyperdriveProvisioningError(
      "INFRASTRUCTURE_MARKER_MISMATCH",
      "Existing AppFactory Worker marker does not match the requested Hyperdrive target."
    );
  }

  try {
    const scripts = await cloudflareRequest<WorkerScript[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/workers/scripts`
    );
    if (!scripts.some((script) => script.id === workerName)) {
      throw new HyperdriveProvisioningError(
        "MANAGED_WORKER_NOT_FOUND",
        `AppFactory marker exists but Worker ${workerName} was not found in Cloudflare.`
      );
    }
  } catch (error) {
    if (error instanceof HyperdriveProvisioningError) throw error;
    permissionError(error, "read the managed Worker before Hyperdrive binding", [
      "Workers Scripts Read"
    ]);
  }
}

function comparableProfile(profile: HyperdriveProfile) {
  return {
    origin: {
      scheme: profile.origin.scheme,
      host: profile.origin.host,
      port: profile.origin.port ?? (profile.origin.scheme === "mysql" ? 3306 : 5432),
      database: profile.origin.database,
      user: profile.origin.user
    },
    caching: {
      disabled: profile.caching?.disabled ?? false,
      max_age: profile.caching?.max_age,
      stale_while_revalidate: profile.caching?.stale_while_revalidate
    },
    origin_connection_limit: profile.origin_connection_limit
  };
}

function comparableConfig(config: HyperdriveConfig) {
  return {
    origin: {
      scheme: config.origin?.scheme,
      host: config.origin?.host,
      port: config.origin?.port ?? (
        config.origin?.scheme === "mysql" ? 3306 : 5432
      ),
      database: config.origin?.database,
      user: config.origin?.user
    },
    caching: {
      disabled: config.caching?.disabled ?? false,
      max_age: config.caching?.max_age,
      stale_while_revalidate: config.caching?.stale_while_revalidate
    },
    origin_connection_limit: config.origin_connection_limit
  };
}

function publicConfigMatches(config: HyperdriveConfig, profile: HyperdriveProfile): boolean {
  return JSON.stringify(comparableConfig(config)) === JSON.stringify(comparableProfile(profile));
}

async function listHyperdrives(env: Env): Promise<HyperdriveConfig[]> {
  try {
    return await cloudflareRequest<HyperdriveConfig[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/hyperdrive/configs?per_page=100`
    );
  } catch (error) {
    permissionError(error, "list Hyperdrive configurations", ["Hyperdrive Read"]);
  }
}

async function createHyperdrive(
  env: Env,
  name: string,
  profile: HyperdriveProfile
): Promise<HyperdriveConfig> {
  try {
    return await cloudflareRequest<HyperdriveConfig>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/hyperdrive/configs`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          origin: profile.origin,
          ...(profile.caching ? { caching: profile.caching } : {}),
          ...(profile.origin_connection_limit !== undefined
            ? { origin_connection_limit: profile.origin_connection_limit }
            : {})
        })
      }
    );
  } catch (error) {
    permissionError(error, "create Hyperdrive configurations", ["Hyperdrive Write"]);
  }
}

async function updateHyperdrive(
  env: Env,
  config: HyperdriveConfig,
  profile: HyperdriveProfile
): Promise<HyperdriveConfig> {
  try {
    return await cloudflareRequest<HyperdriveConfig>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/hyperdrive/configs/${encodeURIComponent(config.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          origin: profile.origin,
          ...(profile.caching ? { caching: profile.caching } : {}),
          ...(profile.origin_connection_limit !== undefined
            ? { origin_connection_limit: profile.origin_connection_limit }
            : {})
        })
      }
    );
  } catch (error) {
    permissionError(error, "update Hyperdrive configurations", ["Hyperdrive Write"]);
  }
}

async function deleteHyperdrive(env: Env, id: string): Promise<void> {
  try {
    await cloudflareRequest<unknown>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/hyperdrive/configs/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
  } catch (error) {
    permissionError(error, "roll back a newly created Hyperdrive configuration", [
      "Hyperdrive Write"
    ]);
  }
}

async function readHyperdriveMarker(
  githubToken: string,
  repository: GitHubRepository,
  environment: InfrastructureEnvironment
): Promise<{ marker: HyperdriveMarker; sha: string } | null> {
  const file = await readGitHubFile(
    githubToken,
    repository,
    hyperdriveMarkerPath(environment)
  );
  if (!file) return null;
  if (file.encoding !== "base64") {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_MARKER_INVALID",
      "Existing Hyperdrive marker uses an unsupported encoding."
    );
  }

  let marker: HyperdriveMarker;
  try {
    marker = JSON.parse(decodeBase64(file.content)) as HyperdriveMarker;
  } catch {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_MARKER_INVALID",
      "Existing Hyperdrive marker is not valid JSON."
    );
  }
  return { marker, sha: file.sha };
}

export async function managedHyperdriveEvidence(
  githubToken: string,
  env: Env,
  repository: GitHubRepository,
  workerName: string,
  environment: InfrastructureEnvironment = "production"
): Promise<ManagedHyperdriveEvidence> {
  const markerFile = await readHyperdriveMarker(
    githubToken,
    repository,
    environment
  );
  if (!markerFile) {
    return {
      declared: false,
      binding: null,
      id: null,
      actualId: null,
      configured: false
    };
  }

  const marker = markerFile.marker;
  if (
    marker.schemaVersion !== SCHEMA_VERSION ||
    marker.provider !== "cloudflare-hyperdrive" ||
    marker.repository !== repository.full_name ||
    marker.workerName !== workerName
  ) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_MARKER_MISMATCH",
      "Existing AppFactory Hyperdrive marker does not match the requested Worker."
    );
  }

  const path =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/workers/scripts/${encodeURIComponent(workerName)}/settings`;

  let settings: WorkerSettings;
  try {
    settings = await cloudflareRequest<WorkerSettings>(env, path);
  } catch (error) {
    permissionError(error, "read Hyperdrive readiness binding", ["Workers Scripts Read"]);
  }

  const binding = (settings.bindings || []).find((item) => item.name === marker.binding);
  const actualId = binding?.type === "hyperdrive" ? binding.id || null : null;

  return {
    declared: true,
    binding: marker.binding,
    id: marker.id,
    actualId,
    configured:
      binding?.type === "hyperdrive" &&
      Boolean(binding.id) &&
      binding.id === marker.id
  };
}

export async function verifyManagedHyperdriveBinding(
  githubToken: string,
  env: Env,
  repository: GitHubRepository,
  workerName: string,
  environment: InfrastructureEnvironment = "production"
): Promise<ManagedHyperdriveEvidence> {
  return managedHyperdriveEvidence(
    githubToken,
    env,
    repository,
    workerName,
    environment
  );
}

function validateExistingMarker(
  marker: HyperdriveMarker,
  request: Required<HyperdriveProvisioningRequest>
): void {
  if (
    marker.schemaVersion !== SCHEMA_VERSION ||
    marker.provider !== "cloudflare-hyperdrive" ||
    marker.repository !== request.repository ||
    marker.workerName !== request.workerName ||
    (marker.environment || "production") !== request.environment ||
    marker.profile !== request.profile ||
    marker.hyperdriveName !== request.hyperdriveName ||
    marker.binding !== request.binding
  ) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_MARKER_MISMATCH",
      "Existing AppFactory Hyperdrive marker does not match the requested infrastructure identity."
    );
  }
}

async function ensureHyperdrive(
  env: Env,
  name: string,
  profile: HyperdriveProfile,
  marker: HyperdriveMarker | null
): Promise<{ config: HyperdriveConfig; created: boolean; updated: boolean }> {
  const configs = await listHyperdrives(env);
  const matches = configs.filter((config) => config.name === name);

  if (matches.length > 1) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_NAME_AMBIGUOUS",
      `Multiple Hyperdrive configurations are named ${name}; refusing ambiguous mutation.`
    );
  }

  const existing = matches[0];
  if (!existing) {
    return {
      config: await createHyperdrive(env, name, profile),
      created: true,
      updated: false
    };
  }

  if (!marker) {
    throw new HyperdriveProvisioningError(
      "BROWNFIELD_HYPERDRIVE_UNCLAIMED",
      `Hyperdrive ${name} already exists without an AppFactory marker; refusing silent adoption.`
    );
  }

  if (marker.id !== existing.id) {
    throw new HyperdriveProvisioningError(
      "HYPERDRIVE_MARKER_MISMATCH",
      `Hyperdrive marker points to ${marker.id}, but Cloudflare name ${name} resolves to ${existing.id}.`
    );
  }

  if (publicConfigMatches(existing, profile)) {
    return { config: existing, created: false, updated: false };
  }

  return {
    config: await updateHyperdrive(env, existing, profile),
    created: false,
    updated: true
  };
}

export async function provisionHyperdrive(
  githubToken: string,
  env: Env,
  callerRepository: string,
  input: HyperdriveProvisioningRequest
): Promise<HyperdriveProvisioningResult> {
  assertCloudflareConfig(env);
  const repository = await repositoryByFullName(githubToken, callerRepository);
  const request = validateRequest(repository, callerRepository, input);
  await assertManagedWorker(
    githubToken,
    env,
    repository,
    request.workerName,
    request.environment
  );

  const profiles = parseProfiles(env);
  const profile = validateProfile(request.profile, profiles[request.profile]);
  const markerFile = await readHyperdriveMarker(
    githubToken,
    repository,
    request.environment
  );
  if (markerFile) validateExistingMarker(markerFile.marker, request);

  const { config, created, updated } = await ensureHyperdrive(
    env,
    request.hyperdriveName,
    profile,
    markerFile?.marker || null
  );

  const expectedMarker: HyperdriveMarker = {
    schemaVersion: SCHEMA_VERSION,
    provider: "cloudflare-hyperdrive",
    repository: repository.full_name,
    workerName: request.workerName,
    profile: request.profile,
    hyperdriveName: request.hyperdriveName,
    binding: request.binding,
    id: config.id,
    ...(request.environment === "staging"
      ? { environment: request.environment }
      : {})
  };

  const markerChanged = !markerFile ||
    JSON.stringify(markerFile.marker) !== JSON.stringify(expectedMarker);

  if (markerChanged) {
    await writeMarker(
      githubToken,
      repository,
      expectedMarker,
      hyperdriveMarkerPath(request.environment),
      markerFile?.sha
    );
  }

  return {
    repository: repository.full_name,
    worker: request.workerName,
    hyperdrive: {
      id: config.id,
      name: config.name,
      created,
      updated
    },
    binding: {
      name: request.binding,
      configured: false,
      deferredToDeploy: true
    },
    marker: {
      path: hyperdriveMarkerPath(request.environment),
      updated: markerChanged
    }
  };
}
