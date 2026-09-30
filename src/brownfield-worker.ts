import type { CloudflareApiResponse, Env, GitHubRepository } from "./types";
import {
  managedDatabaseUrl,
  managedHyperdriveEvidence,
  verifyManagedHyperdriveBinding,
  type ManagedHyperdriveEvidence
} from "./hyperdrive";
import {
  deploymentOnlyReadiness,
  probeWorkerReadiness,
  type WorkerReadinessEvidence
} from "./worker-readiness";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MARKER_PATH = ".appfactory/worker-infrastructure.json";
const SCHEMA_VERSION = 1;

const LEGACY_BUILD_COMMAND =
  "python -m pip install --user uv && uvx --from workers-py pywrangler deploy --config wrangler.production.toml --dry-run";
const LEGACY_DEPLOY_COMMAND =
  "python -m pip install --user uv && uvx --from workers-py pywrangler deploy --config wrangler.production.toml --keep-vars";
const RUNTIME_ONLY_BUILD_COMMAND =
  "bash scripts/package_worker.sh dry-run wrangler.production.toml ../worker-dist-production";
const RUNTIME_ONLY_DEPLOY_COMMAND =
  "bash scripts/package_worker.sh deploy wrangler.production.toml";
const ALEMBIC_MIGRATION_COMMAND =
  'python -m pip install --user uv && export PATH="$HOME/.local/bin:$PATH" && MIGRATION_VENV="$(mktemp -d)" && trap \'rm -rf "$MIGRATION_VENV"\' EXIT && uv venv --python 3.13 "$MIGRATION_VENV" && uv pip install --python "$MIGRATION_VENV/bin/python" . "psycopg[binary]>=3.2,<4" "alembic>=1.13,<2" && "$MIGRATION_VENV/bin/alembic" upgrade head';

interface WorkerScript {
  id: string;
  tag: string;
}

interface CloudflareWorkerResource {
  id: string;
  name: string;
}

interface RepositoryConnection {
  repo_connection_uuid: string;
}

interface BuildToken {
  build_token_uuid: string;
  build_token_name?: string;
  cloudflare_token_id?: string;
}

interface TokenVerification {
  id: string;
  status: "active" | "disabled" | "expired";
}

interface BuildTrigger {
  trigger_uuid: string;
  build_token_uuid?: string;
  branch_includes?: string[];
  build_command?: string;
  deploy_command?: string;
  root_directory?: string;
  repo_connection?: {
    repo_connection_uuid?: string;
  };
}

interface WorkerBuild {
  build_uuid: string;
  build_outcome?: string;
  build_trigger_metadata?: {
    commit_hash?: string;
    branch?: string;
    build_token_uuid?: string;
    build_command?: string;
    deploy_command?: string;
    root_directory?: string;
  };
}

interface WorkerBuildLogs {
  cursor?: string;
  lines?: Array<Array<number | string>>;
  truncated?: boolean;
}

interface GitHubFile {
  sha: string;
  content: string;
  encoding: string;
}

interface WorkerMarker {
  schemaVersion: number;
  provider: "cloudflare-workers-builds";
  repository: string;
  workerName: string;
  rootDirectory: string;
  buildCommand: string;
  deployCommand: string;
  migrationRecipe?: "python-alembic";
  migrationProfile?: string;
  databaseUrlEnv?: string;
}

export interface GeneratedWorkerSecret {
  name: string;
  kind: "token" | "fernet";
}

export interface WorkerMigrationGate {
  recipe: "python-alembic";
  profile?: string;
  databaseUrlEnv?: string;
}

export interface BrownfieldWorkerRequest {
  repository: string;
  workerName?: string;
  rootDirectory?: string;
  buildCommand?: string;
  deployCommand?: string;
  runtimeSecrets?: Record<string, string>;
  generatedSecrets?: GeneratedWorkerSecret[];
  pagesProject?: string;
  migration?: WorkerMigrationGate;
}

export interface BrownfieldWorkerResult {
  repository: string;
  worker: {
    name: string;
    tag: string;
    created: boolean;
    url: string;
  };
  pages: {
    project: string | null;
    url: string | null;
    apiBaseUrlConfigured: boolean;
  };
  builds: {
    repositoryConnectionUuid: string;
    triggerUuid: string;
    triggerCreated: boolean;
    buildUuid: string;
    buildOutcome: string | null;
    reused: boolean;
  };
  secrets: {
    upserted: string[];
    generated: string[];
    preserved: string[];
  };
  migration: {
    enabled: boolean;
    recipe: "python-alembic" | null;
    profile: string | null;
    databaseUrlEnv: string | null;
    buildSecretConfigured: boolean;
    buildCompleted: boolean;
  };
  release: {
    state: WorkerReadinessEvidence["state"];
    databaseRequired: boolean;
    hyperdrive: ManagedHyperdriveEvidence;
    hyperdriveReconciled: boolean;
    readiness: WorkerReadinessEvidence;
  };
}

export class BrownfieldWorkerProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requiredPermissions: string[] = [],
    readonly evidence?: Record<string, unknown>
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
  CLOUDFLARE_API_TOKEN: string;
} {
  if (!env.CLOUDFLARE_ACCOUNT_ID) {
    throw new BrownfieldWorkerProvisioningError(
      "CLOUDFLARE_ACCOUNT_ID_REQUIRED",
      "AppFactory runtime is missing CLOUDFLARE_ACCOUNT_ID."
    );
  }
  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new BrownfieldWorkerProvisioningError(
      "CLOUDFLARE_API_TOKEN_REQUIRED",
      "AppFactory runtime is missing its existing CLOUDFLARE_API_TOKEN."
    );
  }
}

async function cloudflareRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  assertCloudflareConfig(env);
  const isBuildsApi =
    path.includes("/builds/") ||
    path.endsWith("/builds") ||
    path === "/user/tokens/verify";
  const apiToken = isBuildsApi
    ? env.CLOUDFLARE_API_TOKEN
    : env.CLOUDFLARE_PAGES_D1_TOKEN || env.CLOUDFLARE_API_TOKEN;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiToken}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${CLOUDFLARE_API}${path}`, { ...init, headers });
  const raw = await response.text();
  let payload: CloudflareApiResponse<T> | null = null;
  try {
    payload = raw ? JSON.parse(raw) as CloudflareApiResponse<T> : null;
  } catch {
    throw new CloudflareApiError(response.status, path, `Malformed response: ${raw.slice(0, 240)}`);
  }

  if (!response.ok || !payload?.success) {
    const detail = payload?.errors?.map((item) => `${item.code}: ${item.message}`).join("; ") ||
      `HTTP ${response.status}`;
    throw new CloudflareApiError(response.status, path, detail);
  }
  return payload.result;
}

function permissionError(
  error: unknown,
  operation: string,
  permissions: string[]
): never {
  if (error instanceof CloudflareApiError && (error.status === 401 || error.status === 403)) {
    throw new BrownfieldWorkerProvisioningError(
      "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED",
      `Cloudflare denied ${operation} on ${error.path} (HTTP ${error.status}; ${error.detail.slice(0, 200)}). Resource APIs use CLOUDFLARE_PAGES_D1_TOKEN when configured; Workers Builds uses the user-scoped CLOUDFLARE_API_TOKEN.`,
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
    throw new Error(`GitHub API ${response.status} on ${path}: ${(await response.text()).slice(0, 500)}`);
  }
  return await response.json() as T;
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
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
  if (!owner || !repo) throw new Error("Repository must use owner/name format.");
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
  const url = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const response = await fetch(`${GITHUB_API}${url}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "Trigenys-AppFactory"
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API ${response.status} on ${url}: ${await response.text()}`);
  return await response.json() as GitHubFile;
}

async function readMarker(
  token: string,
  repository: GitHubRepository
): Promise<{ marker: WorkerMarker; sha: string } | null> {
  const file = await readGitHubFile(token, repository, MARKER_PATH);
  if (!file) return null;
  if (file.encoding !== "base64") throw new Error("Unsupported GitHub marker encoding.");
  return {
    marker: JSON.parse(decodeBase64(file.content)) as WorkerMarker,
    sha: file.sha
  };
}

async function writeMarker(
  token: string,
  repository: GitHubRepository,
  marker: WorkerMarker,
  currentSha?: string
): Promise<string> {
  const [owner, repo] = repository.full_name.split("/");
  const result = await githubRequest<{ commit: { sha: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${MARKER_PATH}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: "chore(appfactory): claim Worker infrastructure",
        content: encodeBase64(`${JSON.stringify(marker, null, 2)}\n`),
        branch: repository.default_branch || "main",
        ...(currentSha ? { sha: currentSha } : {})
      })
    }
  );
  return result.commit.sha;
}

async function headSha(
  token: string,
  repository: GitHubRepository
): Promise<string> {
  const [owner, repo] = repository.full_name.split("/");
  const ref = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(repository.default_branch || "main")}`
  );
  return ref.object.sha;
}

function expectedWorkerName(repository: GitHubRepository): string {
  return `${repository.name}-api`.slice(0, 63);
}

function databaseSecretPrefix(repository: GitHubRepository): string {
  return repository.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_";
}

function validateMigrationGate(
  repository: GitHubRepository,
  migration: WorkerMigrationGate | undefined
): {
  recipe: "python-alembic";
  profile: string;
  databaseUrlEnv: string;
} | null {
  if (!migration) return null;
  if (migration.recipe !== "python-alembic") {
    throw new BrownfieldWorkerProvisioningError(
      "MIGRATION_RECIPE_FORBIDDEN",
      "Managed Worker migrations must use the reviewed python-alembic recipe."
    );
  }

  const profile = migration.profile || `${repository.name}-production`;
  if (profile !== `${repository.name}-production`) {
    throw new BrownfieldWorkerProvisioningError(
      "MIGRATION_PROFILE_FORBIDDEN",
      `Migration profile must be ${repository.name}-production.`
    );
  }

  const databaseUrlEnv =
    migration.databaseUrlEnv || `${databaseSecretPrefix(repository)}DATABASE_URL`;
  if (databaseUrlEnv !== `${databaseSecretPrefix(repository)}DATABASE_URL`) {
    throw new BrownfieldWorkerProvisioningError(
      "MIGRATION_DATABASE_ENV_FORBIDDEN",
      `Migration database URL variable must be ${databaseSecretPrefix(repository)}DATABASE_URL.`
    );
  }

  return { recipe: "python-alembic", profile, databaseUrlEnv };
}

function migrationDeployCommand(
  baseDeployCommand: string,
  gate: ReturnType<typeof validateMigrationGate>
): string {
  if (!gate) return baseDeployCommand;
  return `export ${gate.databaseUrlEnv}="$APPFACTORY_DATABASE_URL" && ${ALEMBIC_MIGRATION_COMMAND} && ${baseDeployCommand}`;
}

function hyperdriveDeployCommand(
  baseDeployCommand: string,
  hyperdrive: ManagedHyperdriveEvidence
): string {
  if (!hyperdrive.declared) return baseDeployCommand;
  if (
    hyperdrive.binding !== "HYPERDRIVE" ||
    !hyperdrive.id ||
    !/^[A-Za-z0-9-]+$/.test(hyperdrive.id)
  ) {
    throw new BrownfieldWorkerProvisioningError(
      "HYPERDRIVE_DEPLOY_BINDING_INVALID",
      "Managed Hyperdrive marker is missing a safe HYPERDRIVE binding identity."
    );
  }

  const rewrittenDeployCommand = baseDeployCommand.replace(
    "wrangler.production.toml",
    '"$APPFACTORY_WRANGLER_CONFIG"'
  );
  if (rewrittenDeployCommand === baseDeployCommand) {
    throw new BrownfieldWorkerProvisioningError(
      "HYPERDRIVE_DEPLOY_RECIPE_UNSUPPORTED",
      "Managed Hyperdrive binding requires the reviewed Wrangler production config recipe."
    );
  }

  const bindingToml = `\\n[[hyperdrive]]\\nbinding = "${hyperdrive.binding}"\\nid = "${hyperdrive.id}"\\n`;
  return [
    'APPFACTORY_WRANGLER_CONFIG="$(mktemp .appfactory-wrangler.XXXXXX.toml)"',
    'cp wrangler.production.toml "$APPFACTORY_WRANGLER_CONFIG"',
    `printf '%b' '${bindingToml}' >> "$APPFACTORY_WRANGLER_CONFIG"`,
    `( trap 'rm -f "$APPFACTORY_WRANGLER_CONFIG"' EXIT; ${rewrittenDeployCommand} )`
  ].join(" && ");
}

type ValidatedWorkerMigrationGate = {
  recipe: "python-alembic";
  profile: string;
  databaseUrlEnv: string;
};

type ValidatedBrownfieldWorkerRequest =
  Required<Pick<BrownfieldWorkerRequest, "repository" | "workerName" | "rootDirectory" | "buildCommand" | "deployCommand">> &
  Omit<BrownfieldWorkerRequest, "migration"> & {
    migration?: ValidatedWorkerMigrationGate;
  };

function validateRequest(
  repository: GitHubRepository,
  input: BrownfieldWorkerRequest
): ValidatedBrownfieldWorkerRequest {
  if (input.repository !== repository.full_name) {
    throw new BrownfieldWorkerProvisioningError(
      "REPOSITORY_MISMATCH",
      "OIDC caller may provision only its own repository."
    );
  }

  const workerName = input.workerName || expectedWorkerName(repository);
  if (workerName !== expectedWorkerName(repository)) {
    throw new BrownfieldWorkerProvisioningError(
      "WORKER_NAME_FORBIDDEN",
      `Worker name must be ${expectedWorkerName(repository)}.`
    );
  }

  const rootDirectory = input.rootDirectory || "/backend";
  if (rootDirectory !== "/backend") {
    throw new BrownfieldWorkerProvisioningError(
      "ROOT_DIRECTORY_FORBIDDEN",
      "Brownfield Python Worker self-service currently allows only /backend."
    );
  }

  const buildCommand = input.buildCommand || LEGACY_BUILD_COMMAND;
  const deployCommand = input.deployCommand || LEGACY_DEPLOY_COMMAND;

  const allowedRecipes = new Set([
    `${LEGACY_BUILD_COMMAND}\n${LEGACY_DEPLOY_COMMAND}`,
    `${RUNTIME_ONLY_BUILD_COMMAND}\n${RUNTIME_ONLY_DEPLOY_COMMAND}`
  ]);
  if (!allowedRecipes.has(`${buildCommand}\n${deployCommand}`)) {
    throw new BrownfieldWorkerProvisioningError(
      "BUILD_COMMAND_FORBIDDEN",
      "Brownfield Worker commands must use one reviewed Python Worker deployment recipe without mixing build and deploy commands."
    );
  }

  const secretPrefix = databaseSecretPrefix(repository);
  for (const name of Object.keys(input.runtimeSecrets || {})) {
    if (!name.startsWith(secretPrefix)) {
      throw new BrownfieldWorkerProvisioningError(
        "SECRET_NAME_FORBIDDEN",
        `Worker secret ${name} must start with ${secretPrefix}.`
      );
    }
  }
  for (const spec of input.generatedSecrets || []) {
    if (!spec.name.startsWith(secretPrefix)) {
      throw new BrownfieldWorkerProvisioningError(
        "SECRET_NAME_FORBIDDEN",
        `Generated Worker secret ${spec.name} must start with ${secretPrefix}.`
      );
    }
  }

  const migration = validateMigrationGate(repository, input.migration);
  const { migration: _unvalidatedMigration, ...baseInput } = input;

  return {
    ...baseInput,
    repository: input.repository,
    workerName,
    rootDirectory,
    buildCommand,
    deployCommand,
    ...(migration ? { migration } : {})
  };
}

async function listWorkerScripts(env: Env): Promise<WorkerScript[]> {
  assertCloudflareConfig(env);
  try {
    return await cloudflareRequest<WorkerScript[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/scripts`
    );
  } catch (error) {
    permissionError(error, "list Workers", ["Workers Scripts Read"]);
  }
}

async function createWorkerResource(
  env: Env,
  workerName: string
): Promise<CloudflareWorkerResource> {
  assertCloudflareConfig(env);
  try {
    return await cloudflareRequest<CloudflareWorkerResource>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/workers`,
      {
        method: "POST",
        body: JSON.stringify({ name: workerName })
      }
    );
  } catch (error) {
    permissionError(error, "create Workers", ["Workers product Admin (create Worker)"]);
  }
}

async function uploadBootstrapWorker(env: Env, workerName: string): Promise<void> {
  assertCloudflareConfig(env);
  const form = new FormData();
  form.set(
    "metadata",
    new Blob([
      JSON.stringify({
        main_module: "bootstrap.mjs",
        compatibility_date: "2026-09-27"
      })
    ], { type: "application/json" })
  );
  form.set(
    "bootstrap.mjs",
    new Blob([
      'export default { async fetch() { return new Response(JSON.stringify({status:"bootstrapping"}), {status:503, headers:{"content-type":"application/json"}}); } };'
    ], { type: "application/javascript+module" }),
    "bootstrap.mjs"
  );

  try {
    await cloudflareRequest<unknown>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/scripts/${encodeURIComponent(workerName)}`,
      { method: "PUT", body: form }
    );
  } catch (error) {
    permissionError(error, "upload Worker bootstrap code", [
      "Workers product Editor (deploy existing Worker)"
    ]);
  }
}

async function createBootstrapWorker(env: Env, workerName: string): Promise<void> {
  assertCloudflareConfig(env);
  const worker = await createWorkerResource(env, workerName);
  try {
    await uploadBootstrapWorker(env, workerName);
  } catch (error) {
    try {
      await cloudflareRequest<unknown>(
        env,
        `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/workers/${encodeURIComponent(worker.id)}`,
        { method: "DELETE" }
      );
    } catch (rollbackError) {
      throw new BrownfieldWorkerProvisioningError(
        "WORKER_BOOTSTRAP_ROLLBACK_FAILED",
        `Worker ${workerName} was created, but bootstrap upload failed and the empty Worker could not be removed. Original error: ${error instanceof Error ? error.message : String(error)}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      );
    }
    throw error;
  }
}

async function ensureWorker(
  env: Env,
  workerName: string,
  marker: WorkerMarker | null
): Promise<{ script: WorkerScript; created: boolean }> {
  let scripts = await listWorkerScripts(env);
  let script = scripts.find((item) => item.id === workerName);
  if (script) {
    if (!marker) {
      throw new BrownfieldWorkerProvisioningError(
        "BROWNFIELD_WORKER_UNCLAIMED",
        `Worker ${workerName} already exists without an AppFactory marker; refusing silent adoption.`
      );
    }
    return { script, created: false };
  }

  await createBootstrapWorker(env, workerName);
  scripts = await listWorkerScripts(env);
  script = scripts.find((item) => item.id === workerName);
  if (!script?.tag) throw new Error(`Worker ${workerName} was created but its tag could not be resolved.`);
  return { script, created: true };
}

async function ensureRepositoryConnection(
  env: Env,
  repository: GitHubRepository
): Promise<RepositoryConnection> {
  assertCloudflareConfig(env);
  if (!repository.id || !repository.owner?.id || !repository.owner.login) {
    throw new Error(`Repository ${repository.full_name} is missing GitHub IDs required by Workers Builds.`);
  }
  try {
    return await cloudflareRequest<RepositoryConnection>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/repos/connections`,
      {
        method: "PUT",
        body: JSON.stringify({
          provider_type: "github",
          provider_account_id: String(repository.owner.id),
          provider_account_name: repository.owner.login,
          repo_id: String(repository.id),
          repo_name: repository.name
        })
      }
    );
  } catch (error) {
    permissionError(error, "connect GitHub repositories to Workers Builds", [
      "Workers Builds Configuration Edit"
    ]);
  }
}

async function listTriggers(env: Env, workerTag: string): Promise<BuildTrigger[]> {
  assertCloudflareConfig(env);
  try {
    return await cloudflareRequest<BuildTrigger[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/workers/${encodeURIComponent(workerTag)}/triggers`
    );
  } catch (error) {
    permissionError(error, "read Workers Builds triggers", ["Workers Builds Configuration Edit"]);
  }
}

async function resolveBuildTokenUuid(env: Env): Promise<string> {
  if (env.CLOUDFLARE_BUILD_TOKEN_UUID?.trim()) return env.CLOUDFLARE_BUILD_TOKEN_UUID.trim();

  assertCloudflareConfig(env);

  let verification: TokenVerification;
  try {
    verification = await cloudflareRequest<TokenVerification>(env, "/user/tokens/verify");
  } catch (error) {
    permissionError(error, "verify the Workers Builds API token", [
      "Workers Builds Configuration Edit"
    ]);
  }

  if (verification.status !== "active") {
    throw new BrownfieldWorkerProvisioningError(
      "CLOUDFLARE_BUILD_API_TOKEN_INACTIVE",
      `The AppFactory Workers Builds API token is ${verification.status}; replace CLOUDFLARE_API_TOKEN with an active user-scoped token.`
    );
  }

  let tokens: BuildToken[];
  try {
    tokens = await cloudflareRequest<BuildToken[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/tokens`
    );
  } catch (error) {
    permissionError(error, "read Workers Builds tokens", [
      "Workers Builds Configuration Edit"
    ]);
  }

  const registered = tokens.find((token) =>
    token.cloudflare_token_id === verification.id && Boolean(token.build_token_uuid)
  );
  if (registered?.build_token_uuid) return registered.build_token_uuid;

  try {
    const created = await cloudflareRequest<BuildToken>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/tokens`,
      {
        method: "POST",
        body: JSON.stringify({
          build_token_name: "AppFactory Workers Builds",
          build_token_secret: env.CLOUDFLARE_API_TOKEN,
          cloudflare_token_id: verification.id
        })
      }
    );
    if (!created.build_token_uuid) {
      throw new Error("Cloudflare created a build token without returning its UUID.");
    }
    return created.build_token_uuid;
  } catch (error) {
    permissionError(error, "register the current API token as a Workers build token", [
      "Workers Builds Configuration Edit",
      "Workers CI Edit (legacy UI, if Cloudflare requires it for build-token registration)"
    ]);
  }
}

async function ensureProductionTrigger(
  env: Env,
  worker: WorkerScript,
  connection: RepositoryConnection,
  branch: string,
  config: {
    rootDirectory: string;
    buildCommand: string;
    deployCommand: string;
  }
): Promise<{ trigger: BuildTrigger; created: boolean }> {
  const buildTokenUuid = await resolveBuildTokenUuid(env);
  const triggers = await listTriggers(env, worker.tag);
  const existing = triggers.find((trigger) =>
    trigger.repo_connection?.repo_connection_uuid === connection.repo_connection_uuid &&
    (trigger.branch_includes || []).includes(branch)
  );

  if (existing) {
    const needsUpdate =
      existing.build_token_uuid !== buildTokenUuid ||
      existing.root_directory !== config.rootDirectory ||
      existing.build_command !== config.buildCommand ||
      existing.deploy_command !== config.deployCommand;

    if (!needsUpdate) return { trigger: existing, created: false };

    assertCloudflareConfig(env);
    try {
      const updated = await cloudflareRequest<BuildTrigger>(
        env,
        `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/triggers/${encodeURIComponent(existing.trigger_uuid)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            build_token_uuid: buildTokenUuid,
            root_directory: config.rootDirectory,
            build_command: config.buildCommand,
            deploy_command: config.deployCommand,
            path_includes: ["backend/**", "shopify.app.production.toml.template"],
            path_excludes: ["docs/**"]
          })
        }
      );
      return { trigger: updated, created: false };
    } catch (error) {
      permissionError(error, "update Workers Builds triggers", ["Workers Builds Configuration Edit"]);
    }
  }

  assertCloudflareConfig(env);
  try {
    const trigger = await cloudflareRequest<BuildTrigger>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/triggers`,
      {
        method: "POST",
        body: JSON.stringify({
          external_script_id: worker.tag,
          repo_connection_uuid: connection.repo_connection_uuid,
          build_token_uuid: buildTokenUuid,
          trigger_name: "Deploy production",
          build_command: config.buildCommand,
          deploy_command: config.deployCommand,
          root_directory: config.rootDirectory,
          branch_includes: [branch],
          branch_excludes: [],
          path_includes: ["backend/**", "shopify.app.production.toml.template"],
          path_excludes: ["docs/**"],
          build_caching_enabled: true
        })
      }
    );
    return { trigger, created: true };
  } catch (error) {
    permissionError(error, "create Workers Builds triggers", ["Workers Builds Configuration Edit"]);
  }
}

async function configureMigrationBuildSecret(
  env: Env,
  triggerUuid: string,
  databaseUrl: string
): Promise<void> {
  assertCloudflareConfig(env);
  try {
    await cloudflareRequest<unknown>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/triggers/${encodeURIComponent(triggerUuid)}/environment_variables`,
      {
        method: "PATCH",
        body: JSON.stringify({
          APPFACTORY_DATABASE_URL: {
            value: databaseUrl,
            is_secret: true
          }
        })
      }
    );
  } catch (error) {
    permissionError(error, "configure the migration database build secret", [
      "Workers Builds Configuration Edit"
    ]);
  }
}

async function waitForWorkerBuild(
  env: Env,
  workerTag: string,
  buildUuid: string
): Promise<WorkerBuild> {
  const terminal = new Set(["success", "fail", "cancelled", "terminated"]);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const builds = await listWorkerBuilds(env, workerTag);
    const build = builds.find((item) => item.build_uuid === buildUuid);
    if (build && terminal.has(build.build_outcome || "")) {
      if (build.build_outcome !== "success") {
        const excerpt = await buildFailureExcerpt(env, build.build_uuid);
        throw new BrownfieldWorkerProvisioningError(
          "CLOUDFLARE_WORKERS_BUILD_FAILED",
          `Cloudflare Workers Build ${build.build_uuid} failed the release gate. ${excerpt}`
        );
      }
      return build;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new BrownfieldWorkerProvisioningError(
    "CLOUDFLARE_WORKERS_BUILD_TIMEOUT",
    `Cloudflare Workers Build ${buildUuid} did not reach a terminal state within 3 minutes.`
  );
}

async function listWorkerBuilds(env: Env, workerTag: string): Promise<WorkerBuild[]> {
  assertCloudflareConfig(env);
  try {
    return await cloudflareRequest<WorkerBuild[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/workers/${encodeURIComponent(workerTag)}/builds`
    );
  } catch (error) {
    permissionError(error, "read Workers Builds", ["Workers Builds Configuration Edit"]);
  }
}

function buildMatchesCurrentTrigger(
  build: WorkerBuild,
  trigger: BuildTrigger,
  branch: string,
  commitSha: string
): boolean {
  const metadata = build.build_trigger_metadata;
  if (
    metadata?.commit_hash !== commitSha ||
    metadata?.branch !== branch ||
    !trigger.build_token_uuid ||
    metadata.build_token_uuid !== trigger.build_token_uuid
  ) {
    return false;
  }

  if (
    metadata.build_command &&
    trigger.build_command &&
    metadata.build_command !== trigger.build_command
  ) {
    return false;
  }
  if (
    metadata.deploy_command &&
    trigger.deploy_command &&
    metadata.deploy_command !== trigger.deploy_command
  ) {
    return false;
  }
  if (
    metadata.root_directory &&
    trigger.root_directory &&
    metadata.root_directory !== trigger.root_directory
  ) {
    return false;
  }
  return true;
}

async function buildFailureExcerpt(env: Env, buildUuid: string): Promise<string> {
  assertCloudflareConfig(env);
  try {
    const logs = await cloudflareRequest<WorkerBuildLogs>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/builds/${encodeURIComponent(buildUuid)}/logs`
    );
    const rendered = (logs.lines || [])
      .map((line) => line.map((part) => String(part)).join(" "))
      .filter(Boolean);

    const useful = rendered.filter((line) =>
      /error|fail|authentication|unauthori|permission|wrangler|deploy|token/i.test(line)
    );
    const excerpt = (useful.length > 0 ? useful : rendered).slice(-12).join(" | ");
    return excerpt.slice(0, 2400);
  } catch (error) {
    return `Build logs unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function ensureBuild(
  env: Env,
  worker: WorkerScript,
  trigger: BuildTrigger,
  branch: string,
  commitSha: string
): Promise<{ build: WorkerBuild; reused: boolean }> {
  const builds = await listWorkerBuilds(env, worker.tag);
  const existing = builds.find((build) =>
    build.build_trigger_metadata?.commit_hash === commitSha &&
    build.build_trigger_metadata?.branch === branch &&
    !["fail", "cancelled", "terminated"].includes(build.build_outcome || "")
  );
  if (existing) return { build: existing, reused: true };

  const failedCurrentBuild = builds.find((build) =>
    build.build_outcome === "fail" &&
    buildMatchesCurrentTrigger(build, trigger, branch, commitSha)
  );
  if (failedCurrentBuild) {
    const excerpt = await buildFailureExcerpt(env, failedCurrentBuild.build_uuid);
    throw new BrownfieldWorkerProvisioningError(
      "CLOUDFLARE_WORKERS_BUILD_FAILED",
      `Cloudflare Workers Build ${failedCurrentBuild.build_uuid} failed before deployment. ${excerpt}`
    );
  }

  assertCloudflareConfig(env);
  try {
    const build = await cloudflareRequest<WorkerBuild>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/triggers/${encodeURIComponent(trigger.trigger_uuid)}/builds`,
      {
        method: "POST",
        body: JSON.stringify({ branch, commit_hash: commitSha })
      }
    );
    return { build, reused: false };
  } catch (error) {
    permissionError(error, "start Workers Builds", ["Workers Builds Configuration Edit"]);
  }
}

async function listSecretNames(env: Env, workerName: string): Promise<Set<string>> {
  assertCloudflareConfig(env);
  try {
    const secrets = await cloudflareRequest<Array<{ name: string }>>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/scripts/${encodeURIComponent(workerName)}/secrets`
    );
    return new Set(secrets.map((item) => item.name));
  } catch (error) {
    permissionError(error, "list Worker secrets", ["Workers Scripts Read"]);
  }
}

async function putSecret(
  env: Env,
  workerName: string,
  name: string,
  value: string
): Promise<void> {
  assertCloudflareConfig(env);
  try {
    await cloudflareRequest<unknown>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
      {
        method: "PUT",
        body: JSON.stringify({ name, text: value, type: "secret_text" })
      }
    );
  } catch (error) {
    permissionError(error, "write Worker secrets", ["Workers Scripts Edit"]);
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array, padded = false): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  let encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
  if (!padded) encoded = encoded.replace(/=+$/g, "");
  return encoded;
}

function generateSecret(kind: GeneratedWorkerSecret["kind"]): string {
  if (kind === "fernet") return base64Url(randomBytes(32), true);
  return base64Url(randomBytes(48), false);
}

async function workerSubdomain(env: Env): Promise<string> {
  assertCloudflareConfig(env);
  const result = await cloudflareRequest<{ subdomain?: string }>(
    env,
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/subdomain`
  );
  const subdomain = result.subdomain?.trim();
  if (!subdomain) {
    throw new BrownfieldWorkerProvisioningError(
      "WORKERS_DEV_SUBDOMAIN_REQUIRED",
      "Cloudflare account has no workers.dev subdomain configured."
    );
  }
  return subdomain;
}

async function configurePagesApiBase(
  env: Env,
  pagesProject: string | undefined,
  apiUrl: string
): Promise<{ project: string | null; url: string | null; configured: boolean }> {
  if (!pagesProject) return { project: null, url: null, configured: false };
  assertCloudflareConfig(env);
  try {
    const project = await cloudflareRequest<{ name: string; subdomain?: string }>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(pagesProject)}`
    );
    await cloudflareRequest<unknown>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(pagesProject)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          deployment_configs: {
            production: {
              env_vars: {
                VITE_API_BASE_URL: { type: "plain_text", value: apiUrl }
              }
            },
            preview: {
              env_vars: {
                VITE_API_BASE_URL: { type: "plain_text", value: apiUrl }
              }
            }
          }
        })
      }
    );
    return {
      project: project.name,
      url: project.subdomain ? `https://${project.subdomain}` : null,
      configured: true
    };
  } catch (error) {
    permissionError(error, "configure Cloudflare Pages variables", ["Cloudflare Pages Edit"]);
  }
}

function expandRuntimeValue(value: string, urls: { workerUrl: string; webUrl: string | null }): string {
  return value
    .replaceAll("__WORKER_URL__", urls.workerUrl)
    .replaceAll("__WEB_URL__", urls.webUrl || "");
}

export async function provisionBrownfieldWorker(
  githubToken: string,
  env: Env,
  callerRepository: string,
  input: BrownfieldWorkerRequest
): Promise<BrownfieldWorkerResult> {
  assertCloudflareConfig(env);
  const repository = await repositoryByFullName(githubToken, callerRepository);
  const request = validateRequest(repository, input);

  const markerFile = await readMarker(githubToken, repository);
  const marker = markerFile?.marker || null;
  const expectedMarker: WorkerMarker = {
    schemaVersion: SCHEMA_VERSION,
    provider: "cloudflare-workers-builds",
    repository: repository.full_name,
    workerName: request.workerName,
    rootDirectory: request.rootDirectory,
    buildCommand: request.buildCommand,
    deployCommand: request.deployCommand,
    ...(request.migration ? {
      migrationRecipe: request.migration.recipe,
      migrationProfile: request.migration.profile,
      databaseUrlEnv: request.migration.databaseUrlEnv
    } : {})
  };

  if (
    marker &&
    (
      marker.schemaVersion !== expectedMarker.schemaVersion ||
      marker.provider !== expectedMarker.provider ||
      marker.repository !== expectedMarker.repository ||
      marker.workerName !== expectedMarker.workerName ||
      marker.rootDirectory !== expectedMarker.rootDirectory
    )
  ) {
    throw new BrownfieldWorkerProvisioningError(
      "INFRASTRUCTURE_MARKER_MISMATCH",
      "Existing AppFactory Worker marker does not match the requested infrastructure identity."
    );
  }

  const recipeChanged = Boolean(
    marker &&
    (
      marker.buildCommand !== expectedMarker.buildCommand ||
      marker.deployCommand !== expectedMarker.deployCommand ||
      marker.migrationRecipe !== expectedMarker.migrationRecipe ||
      marker.migrationProfile !== expectedMarker.migrationProfile ||
      marker.databaseUrlEnv !== expectedMarker.databaseUrlEnv
    )
  );

  const { script, created } = await ensureWorker(env, request.workerName, marker);
  const subdomain = await workerSubdomain(env);
  const workerUrl = `https://${request.workerName}.${subdomain}.workers.dev`;
  const pages = await configurePagesApiBase(env, request.pagesProject, workerUrl);
  const webUrl = pages.url;

  const existingSecretNames = await listSecretNames(env, request.workerName);
  const upserted: string[] = [];
  const generated: string[] = [];
  const preserved: string[] = [];

  for (const [name, rawValue] of Object.entries(request.runtimeSecrets || {})) {
    const value = expandRuntimeValue(rawValue, { workerUrl, webUrl });
    if (!value) {
      throw new BrownfieldWorkerProvisioningError(
        "RUNTIME_SECRET_EMPTY",
        `Runtime value for ${name} resolved to an empty string.`
      );
    }
    await putSecret(env, request.workerName, name, value);
    upserted.push(name);
    existingSecretNames.add(name);
  }

  for (const spec of request.generatedSecrets || []) {
    if (existingSecretNames.has(spec.name)) {
      preserved.push(spec.name);
      continue;
    }
    await putSecret(env, request.workerName, spec.name, generateSecret(spec.kind));
    generated.push(spec.name);
    existingSecretNames.add(spec.name);
  }

  const configCommitSha = !marker
    ? await writeMarker(githubToken, repository, expectedMarker)
    : recipeChanged
      ? await writeMarker(githubToken, repository, expectedMarker, markerFile?.sha)
      : await headSha(githubToken, repository);

  const preBuildHyperdrive = await managedHyperdriveEvidence(
    githubToken,
    env,
    repository,
    request.workerName
  );
  const databaseRequired = preBuildHyperdrive.declared;
  const releaseDeployCommand = migrationDeployCommand(
    hyperdriveDeployCommand(request.deployCommand, preBuildHyperdrive),
    request.migration || null
  );

  const connection = await ensureRepositoryConnection(env, repository);
  const { trigger, created: triggerCreated } = await ensureProductionTrigger(
    env,
    script,
    connection,
    repository.default_branch || "main",
    {
      rootDirectory: request.rootDirectory,
      buildCommand: request.buildCommand,
      deployCommand: releaseDeployCommand
    }
  );

  let migrationBuildSecretConfigured = false;
  if (request.migration) {
    const databaseUrl = managedDatabaseUrl(env, request.migration.profile);
    await configureMigrationBuildSecret(env, trigger.trigger_uuid, databaseUrl);
    migrationBuildSecretConfigured = true;
  }

  const { build, reused } = await ensureBuild(
    env,
    script,
    trigger,
    repository.default_branch || "main",
    configCommitSha
  );

  const completedBuild = request.migration || databaseRequired
    ? await waitForWorkerBuild(env, script.tag, build.build_uuid)
    : build;

  const hyperdrive = databaseRequired
    ? await verifyManagedHyperdriveBinding(
        githubToken,
        env,
        repository,
        request.workerName
      )
    : preBuildHyperdrive;

  if (databaseRequired && !hyperdrive.configured) {
    const readiness = {
      ...deploymentOnlyReadiness(),
      state: "degraded" as const
    };
    throw new BrownfieldWorkerProvisioningError(
      "HYPERDRIVE_BINDING_NOT_READY",
      `Worker ${request.workerName} declares Hyperdrive binding ${hyperdrive.binding || "HYPERDRIVE"}, but the release deploy did not produce the expected binding identity.`,
      [],
      {
        release: {
          state: readiness.state,
          databaseRequired,
          hyperdrive,
          hyperdriveReconciled: false,
          readiness
        }
      }
    );
  }

  const readiness = databaseRequired
    ? await probeWorkerReadiness(workerUrl, true)
    : deploymentOnlyReadiness();

  if (databaseRequired && readiness.state !== "ready") {
    throw new BrownfieldWorkerProvisioningError(
      "WORKER_DATABASE_NOT_READY",
      `Worker ${request.workerName} deployed but did not reach database-ready health. state=${readiness.state}; health=${readiness.healthStatus || "unknown"}; database_configured=${String(readiness.databaseConfigured)}.`,
      [],
      {
        release: {
          state: readiness.state,
          databaseRequired,
          hyperdrive,
          hyperdriveReconciled: false,
          readiness
        }
      }
    );
  }

  return {
    repository: repository.full_name,
    worker: {
      name: request.workerName,
      tag: script.tag,
      created,
      url: workerUrl
    },
    pages: {
      project: pages.project,
      url: pages.url,
      apiBaseUrlConfigured: pages.configured
    },
    builds: {
      repositoryConnectionUuid: connection.repo_connection_uuid,
      triggerUuid: trigger.trigger_uuid,
      triggerCreated,
      buildUuid: completedBuild.build_uuid,
      buildOutcome: completedBuild.build_outcome || null,
      reused
    },
    secrets: {
      upserted: upserted.sort(),
      generated: generated.sort(),
      preserved: preserved.sort()
    },
    migration: {
      enabled: Boolean(request.migration),
      recipe: request.migration?.recipe || null,
      profile: request.migration?.profile || null,
      databaseUrlEnv: request.migration?.databaseUrlEnv || null,
      buildSecretConfigured: migrationBuildSecretConfigured,
      buildCompleted: request.migration ? completedBuild.build_outcome === "success" : false
    },
    release: {
      state: readiness.state,
      databaseRequired,
      hyperdrive,
      hyperdriveReconciled: false,
      readiness
    }
  };
}
