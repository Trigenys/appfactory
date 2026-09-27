import type { CloudflareApiResponse, Env, GitHubRepository } from "./types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const INFRA_SCHEMA_VERSION = 1;

interface D1Database {
  uuid: string;
  name: string;
  created_at?: string;
}

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
  provider_type?: string;
  provider_account_id?: string;
  repo_id?: string;
  repo_name?: string;
}

interface BuildTrigger {
  trigger_uuid: string;
  trigger_name?: string;
  build_token_uuid?: string;
  branch_includes?: string[];
  repo_connection?: {
    repo_connection_uuid?: string;
    repo_id?: string;
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

interface ServiceInfrastructureMarker {
  schemaVersion: number;
  provider: "cloudflare-workers";
  repository: string;
  workerName: string;
  databaseName: string;
  databaseId: string;
}

interface ProvisioningClaim {
  schemaVersion: number;
  provider: "cloudflare-workers";
  repository: string;
  workerName: string;
  databaseName: string;
  startedAt: string;
}

interface GitHubFile {
  sha: string;
  content: string;
  encoding: string;
}

export class ServiceCloudflareProvisioningError extends Error {
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
    throw new ServiceCloudflareProvisioningError(
      "CLOUDFLARE_ACCOUNT_ID_REQUIRED",
      "Service infrastructure provisioning requires CLOUDFLARE_ACCOUNT_ID."
    );
  }
  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new ServiceCloudflareProvisioningError(
      "CLOUDFLARE_API_TOKEN_REQUIRED",
      "Service infrastructure provisioning requires the existing AppFactory CLOUDFLARE_API_TOKEN."
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
    throw new ServiceCloudflareProvisioningError(
      "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED",
      `The existing AppFactory Cloudflare token cannot ${operation}. Extend that token instead of creating a duplicate credential.`,
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
  return (await response.json()) as T;
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
  return (await response.json()) as GitHubFile;
}

async function readJsonFile<T>(
  token: string,
  repository: GitHubRepository,
  path: string
): Promise<T | null> {
  const file = await readGitHubFile(token, repository, path);
  if (!file) return null;
  if (file.encoding !== "base64") throw new Error(`Unsupported GitHub encoding for ${path}.`);
  return JSON.parse(decodeBase64(file.content)) as T;
}

async function getHead(
  token: string,
  repository: GitHubRepository
): Promise<{ sha: string; treeSha: string }> {
  const [owner, repo] = repository.full_name.split("/");
  const ref = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(repository.default_branch || "main")}`
  );
  const commit = await githubRequest<{ tree: { sha: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${ref.object.sha}`
  );
  return { sha: ref.object.sha, treeSha: commit.tree.sha };
}

async function createBlob(
  token: string,
  repository: GitHubRepository,
  text: string
): Promise<string> {
  const [owner, repo] = repository.full_name.split("/");
  const blob = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
    { method: "POST", body: JSON.stringify({ content: encodeBase64(text), encoding: "base64" }) }
  );
  return blob.sha;
}

async function ensureProvisioningClaim(
  token: string,
  repository: GitHubRepository,
  workerName: string,
  databaseName: string
): Promise<ProvisioningClaim> {
  const finalMarker = await readJsonFile<ServiceInfrastructureMarker>(
    token,
    repository,
    ".appfactory/cloudflare.json"
  );
  if (finalMarker) {
    return {
      schemaVersion: finalMarker.schemaVersion,
      provider: finalMarker.provider,
      repository: finalMarker.repository,
      workerName: finalMarker.workerName,
      databaseName: finalMarker.databaseName,
      startedAt: new Date(0).toISOString()
    };
  }

  const existing = await readJsonFile<ProvisioningClaim>(
    token,
    repository,
    ".appfactory/cloudflare-provisioning.json"
  );
  if (existing) {
    if (
      existing.provider !== "cloudflare-workers" ||
      existing.repository !== repository.full_name ||
      existing.workerName !== workerName ||
      existing.databaseName !== databaseName
    ) {
      throw new Error("Existing Cloudflare provisioning claim does not match the requested service.");
    }
    return existing;
  }

  const claim: ProvisioningClaim = {
    schemaVersion: INFRA_SCHEMA_VERSION,
    provider: "cloudflare-workers",
    repository: repository.full_name,
    workerName,
    databaseName,
    startedAt: new Date().toISOString()
  };
  const [owner, repo] = repository.full_name.split("/");
  await githubRequest(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.appfactory/cloudflare-provisioning.json`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: "chore(appfactory): claim Cloudflare service provisioning",
        content: encodeBase64(`${JSON.stringify(claim, null, 2)}\n`),
        branch: repository.default_branch || "main"
      })
    }
  );
  return claim;
}

async function listD1Databases(env: Env): Promise<D1Database[]> {
  assertCloudflareConfig(env);
  try {
    return await cloudflareRequest<D1Database[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database?per_page=100`
    );
  } catch (error) {
    permissionError(error, "list D1 databases", ["D1 Edit"]);
  }
}

async function ensureD1Database(
  env: Env,
  name: string,
  claim: ProvisioningClaim,
  finalMarker: ServiceInfrastructureMarker | null
): Promise<{ database: D1Database; created: boolean }> {
  const databases = await listD1Databases(env);
  const existing = databases.find((database) => database.name === name);
  if (existing) {
    if (finalMarker?.databaseId === existing.uuid) return { database: existing, created: false };
    if (!finalMarker && existing.created_at && claim.startedAt !== new Date(0).toISOString()) {
      const created = Date.parse(existing.created_at);
      const started = Date.parse(claim.startedAt);
      if (Number.isFinite(created) && Number.isFinite(started) && created + 60_000 < started) {
        throw new Error(
          `D1 database ${name} predates this AppFactory provisioning claim; refusing brownfield adoption.`
        );
      }
    }
    return { database: existing, created: false };
  }

  assertCloudflareConfig(env);
  try {
    const database = await cloudflareRequest<D1Database>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database`,
      { method: "POST", body: JSON.stringify({ name }) }
    );
    return { database, created: true };
  } catch (error) {
    permissionError(error, "create D1 databases", ["D1 Edit"]);
  }
}

function patchWranglerDatabaseId(content: string, databaseId: string): string {
  const current = content.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
  if (!current) throw new Error("Generated wrangler.jsonc does not declare database_id.");
  if (current !== "REPLACE_AFTER_WRANGLER_D1_CREATE" && current !== databaseId) {
    throw new Error(
      `Generated wrangler.jsonc already targets a different D1 database (${current}).`
    );
  }
  return content.replace(
    /"database_id"\s*:\s*"[^"]+"/,
    `"database_id": "${databaseId}"`
  );
}

async function commitInfrastructureConfig(
  token: string,
  repository: GitHubRepository,
  marker: ServiceInfrastructureMarker
): Promise<string> {
  const wrangler = await readGitHubFile(token, repository, "wrangler.jsonc");
  if (!wrangler || wrangler.encoding !== "base64") {
    throw new Error("Generated service is missing a readable wrangler.jsonc.");
  }
  const patchedWrangler = patchWranglerDatabaseId(decodeBase64(wrangler.content), marker.databaseId);
  const currentMarker = await readJsonFile<ServiceInfrastructureMarker>(
    token,
    repository,
    ".appfactory/cloudflare.json"
  );

  if (
    currentMarker &&
    currentMarker.databaseId === marker.databaseId &&
    currentMarker.workerName === marker.workerName &&
    currentMarker.repository === marker.repository &&
    patchedWrangler === decodeBase64(wrangler.content)
  ) {
    return (await getHead(token, repository)).sha;
  }

  const [owner, repo] = repository.full_name.split("/");
  const [wranglerBlob, markerBlob] = await Promise.all([
    createBlob(token, repository, patchedWrangler),
    createBlob(token, repository, `${JSON.stringify(marker, null, 2)}\n`)
  ]);
  const head = await getHead(token, repository);
  const tree = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: head.treeSha,
        tree: [
          { path: "wrangler.jsonc", mode: "100644", type: "blob", sha: wranglerBlob },
          { path: ".appfactory/cloudflare.json", mode: "100644", type: "blob", sha: markerBlob },
          { path: ".appfactory/cloudflare-provisioning.json", mode: "100644", type: "blob", sha: null }
        ]
      })
    }
  );
  const commit = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: "chore(appfactory): configure Cloudflare service infrastructure",
        tree: tree.sha,
        parents: [head.sha]
      })
    }
  );
  await githubRequest(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(repository.default_branch || "main")}`,
    { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) }
  );
  return commit.sha;
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

async function uploadBootstrapWorker(
  env: Env,
  workerName: string,
  databaseId: string
): Promise<void> {
  assertCloudflareConfig(env);
  const form = new FormData();
  form.set(
    "metadata",
    new Blob([
      JSON.stringify({
        main_module: "bootstrap.mjs",
        compatibility_date: "2026-09-23",
        bindings: [{ type: "d1", name: "DB", database_id: databaseId }]
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

async function createBootstrapWorker(
  env: Env,
  workerName: string,
  databaseId: string
): Promise<void> {
  assertCloudflareConfig(env);
  const worker = await createWorkerResource(env, workerName);
  try {
    await uploadBootstrapWorker(env, workerName, databaseId);
  } catch (error) {
    try {
      await cloudflareRequest<unknown>(
        env,
        `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/workers/${encodeURIComponent(worker.id)}`,
        { method: "DELETE" }
      );
    } catch (rollbackError) {
      throw new ServiceCloudflareProvisioningError(
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
  databaseId: string,
  finalMarker: ServiceInfrastructureMarker | null
): Promise<{ script: WorkerScript; created: boolean }> {
  let scripts = await listWorkerScripts(env);
  let script = scripts.find((item) => item.id === workerName);
  if (script) {
    if (!finalMarker) {
      throw new Error(
        `Worker ${workerName} already exists without an AppFactory infrastructure marker; refusing brownfield adoption.`
      );
    }
    return { script, created: false };
  }

  await createBootstrapWorker(env, workerName, databaseId);
  scripts = await listWorkerScripts(env);
  script = scripts.find((item) => item.id === workerName);
  if (!script?.tag) throw new Error(`Worker ${workerName} was created but its Cloudflare tag could not be resolved.`);
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
    const sourceTriggers = await listTriggers(env, sourceWorker.tag);
    const reusable = sourceTriggers.find((trigger) => Boolean(trigger.build_token_uuid));
    if (reusable?.build_token_uuid) return reusable.build_token_uuid;
  }

  assertCloudflareConfig(env);
  try {
    const tokens = await cloudflareRequest<Array<{ build_token_uuid: string; build_token_name?: string }>>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/builds/tokens`
    );
    if (tokens.length === 1 && tokens[0].build_token_uuid) return tokens[0].build_token_uuid;
  } catch (error) {
    permissionError(error, "read Workers Builds tokens", ["Workers Builds Configuration Edit"]);
  }

  throw new ServiceCloudflareProvisioningError(
    "CLOUDFLARE_BUILD_TOKEN_AMBIGUOUS",
    "AppFactory could not select an existing Workers Builds token. Set CLOUDFLARE_BUILD_TOKEN_UUID to an existing token UUID; do not create a duplicate token."
  );
}

async function ensureProductionTrigger(
  env: Env,
  worker: WorkerScript,
  connection: RepositoryConnection,
  branch: string
): Promise<{ trigger: BuildTrigger; created: boolean }> {
  const triggers = await listTriggers(env, worker.tag);
  const existing = triggers.find((trigger) =>
    trigger.repo_connection?.repo_connection_uuid === connection.repo_connection_uuid &&
    (trigger.branch_includes || []).includes(branch)
  );
  if (existing) return { trigger: existing, created: false };

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
          build_command: "npm run d1:migrate:remote",
          deploy_command: "npx wrangler deploy",
          root_directory: "/",
          branch_includes: [branch],
          branch_excludes: [],
          path_includes: ["*"],
          path_excludes: [".appfactory/**", "docs/**"],
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
    build.build_outcome !== "fail" &&
    build.build_outcome !== "cancelled" &&
    build.build_outcome !== "terminated"
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

export interface ServiceCloudflareResult {
  replay: boolean;
  configCommitSha: string;
  database: {
    id: string;
    name: string;
    created: boolean;
  };
  worker: {
    name: string;
    tag: string;
    created: boolean;
  };
  builds: {
    repositoryConnectionUuid: string;
    productionTriggerUuid: string;
    triggerCreated: boolean;
    buildUuid: string;
    buildOutcome: string | null;
    reused: boolean;
  };
}

export async function provisionServiceCloudflare(
  githubToken: string,
  env: Env,
  repository: GitHubRepository
): Promise<ServiceCloudflareResult> {
  assertCloudflareConfig(env);
  const workerName = repository.name;
  const databaseName = `${repository.name}-db`;
  const finalMarker = await readJsonFile<ServiceInfrastructureMarker>(
    githubToken,
    repository,
    ".appfactory/cloudflare.json"
  );

  if (
    finalMarker &&
    (
      finalMarker.schemaVersion !== INFRA_SCHEMA_VERSION ||
      finalMarker.provider !== "cloudflare-workers" ||
      finalMarker.repository !== repository.full_name ||
      finalMarker.workerName !== workerName ||
      finalMarker.databaseName !== databaseName
    )
  ) {
    throw new Error("Existing AppFactory Cloudflare infrastructure marker does not match this service.");
  }

  const claim = await ensureProvisioningClaim(githubToken, repository, workerName, databaseName);
  const { database, created: databaseCreated } = await ensureD1Database(
    env,
    databaseName,
    claim,
    finalMarker
  );

  const marker: ServiceInfrastructureMarker = {
    schemaVersion: INFRA_SCHEMA_VERSION,
    provider: "cloudflare-workers",
    repository: repository.full_name,
    workerName,
    databaseName,
    databaseId: database.uuid
  };
  const configCommitSha = await commitInfrastructureConfig(githubToken, repository, marker);

  const { script, created: workerCreated } = await ensureWorker(
    env,
    workerName,
    database.uuid,
    finalMarker
  );
  const connection = await ensureRepositoryConnection(env, repository);
  const { trigger, created: triggerCreated } = await ensureProductionTrigger(
    env,
    script,
    connection,
    repository.default_branch || "main"
  );
  const { build, reused: buildReused } = await ensureBuild(
    env,
    script,
    trigger,
    repository.default_branch || "main",
    configCommitSha
  );

  return {
    replay: Boolean(finalMarker && !databaseCreated && !workerCreated && !triggerCreated && buildReused),
    configCommitSha,
    database: {
      id: database.uuid,
      name: database.name,
      created: databaseCreated
    },
    worker: {
      name: workerName,
      tag: script.tag,
      created: workerCreated
    },
    builds: {
      repositoryConnectionUuid: connection.repo_connection_uuid,
      productionTriggerUuid: trigger.trigger_uuid,
      triggerCreated,
      buildUuid: build.build_uuid,
      buildOutcome: build.build_outcome || null,
      reused: buildReused
    }
  };
}
