import type { CloudflareApiResponse, Env, GitHubRepository } from "./types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MARKER_PATH = ".appfactory/worker-infrastructure.json";
const SCHEMA_VERSION = 1;

interface WorkerScript {
  id: string;
  tag: string;
}

interface RepositoryConnection {
  repo_connection_uuid: string;
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
  };
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
}

export interface GeneratedWorkerSecret {
  name: string;
  kind: "token" | "fernet";
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
}

export class BrownfieldWorkerProvisioningError extends Error {
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
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
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
      `The existing AppFactory Cloudflare token cannot ${operation}. Extend that token instead of creating another credential.`,
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

function validateRequest(
  repository: GitHubRepository,
  input: BrownfieldWorkerRequest
): Required<Pick<BrownfieldWorkerRequest, "repository" | "workerName" | "rootDirectory" | "buildCommand" | "deployCommand">> & BrownfieldWorkerRequest {
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

  const buildCommand =
    input.buildCommand ||
    "python -m pip install --user uv && uvx --from workers-py pywrangler deploy --config wrangler.production.toml --dry-run";
  const deployCommand =
    input.deployCommand ||
    "python -m pip install --user uv && uvx --from workers-py pywrangler deploy --config wrangler.production.toml --keep-vars";

  const allowedCommands = new Set([
    "python -m pip install --user uv && uvx --from workers-py pywrangler deploy --config wrangler.production.toml --dry-run",
    "python -m pip install --user uv && uvx --from workers-py pywrangler deploy --config wrangler.production.toml --keep-vars"
  ]);
  if (!allowedCommands.has(buildCommand) || !allowedCommands.has(deployCommand)) {
    throw new BrownfieldWorkerProvisioningError(
      "BUILD_COMMAND_FORBIDDEN",
      "Brownfield Worker commands must use the reviewed Python Worker deployment recipe."
    );
  }

  const secretPrefix = repository.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_";
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

  return {
    ...input,
    repository: input.repository,
    workerName,
    rootDirectory,
    buildCommand,
    deployCommand
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

async function createBootstrapWorker(env: Env, workerName: string): Promise<void> {
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
    permissionError(error, "create Workers", ["Workers Scripts Edit"]);
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

  const sourceWorkerName = env.CLOUDFLARE_BUILD_TOKEN_SOURCE_WORKER || "appfactory-api";
  const sourceWorker = (await listWorkerScripts(env)).find((item) => item.id === sourceWorkerName);
  if (sourceWorker?.tag) {
    const triggers = await listTriggers(env, sourceWorker.tag);
    const reusable = triggers.find((trigger) => Boolean(trigger.build_token_uuid));
    if (reusable?.build_token_uuid) return reusable.build_token_uuid;
  }

  assertCloudflareConfig(env);
  try {
    const tokens = await cloudflareRequest<Array<{ build_token_uuid: string }>>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/tokens`
    );
    if (tokens.length === 1 && tokens[0].build_token_uuid) return tokens[0].build_token_uuid;
  } catch (error) {
    permissionError(error, "read Workers Builds tokens", ["Workers Builds Configuration Edit"]);
  }

  throw new BrownfieldWorkerProvisioningError(
    "CLOUDFLARE_BUILD_TOKEN_AMBIGUOUS",
    "AppFactory could not select the existing Workers Builds token. Configure CLOUDFLARE_BUILD_TOKEN_UUID on AppFactory instead of creating a repository credential."
  );
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
  const triggers = await listTriggers(env, worker.tag);
  const existing = triggers.find((trigger) =>
    trigger.repo_connection?.repo_connection_uuid === connection.repo_connection_uuid &&
    (trigger.branch_includes || []).includes(branch)
  );

  if (existing) {
    const needsUpdate =
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

  const buildTokenUuid = await resolveBuildTokenUuid(env);
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
    deployCommand: request.deployCommand
  };

  if (
    marker &&
    (
      marker.schemaVersion !== expectedMarker.schemaVersion ||
      marker.provider !== expectedMarker.provider ||
      marker.repository !== expectedMarker.repository ||
      marker.workerName !== expectedMarker.workerName ||
      marker.rootDirectory !== expectedMarker.rootDirectory ||
      marker.buildCommand !== expectedMarker.buildCommand ||
      marker.deployCommand !== expectedMarker.deployCommand
    )
  ) {
    throw new BrownfieldWorkerProvisioningError(
      "INFRASTRUCTURE_MARKER_MISMATCH",
      "Existing AppFactory Worker marker does not match the requested infrastructure."
    );
  }

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

  const configCommitSha = marker
    ? await headSha(githubToken, repository)
    : await writeMarker(githubToken, repository, expectedMarker);

  const connection = await ensureRepositoryConnection(env, repository);
  const { trigger, created: triggerCreated } = await ensureProductionTrigger(
    env,
    script,
    connection,
    repository.default_branch || "main",
    {
      rootDirectory: request.rootDirectory,
      buildCommand: request.buildCommand,
      deployCommand: request.deployCommand
    }
  );

  const { build, reused } = await ensureBuild(
    env,
    script,
    trigger,
    repository.default_branch || "main",
    configCommitSha
  );

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
      buildUuid: build.build_uuid,
      buildOutcome: build.build_outcome || null,
      reused
    },
    secrets: {
      upserted: upserted.sort(),
      generated: generated.sort(),
      preserved: preserved.sort()
    }
  };
}
