import { createRepositoryFromTemplate } from "./github";
import type { CreateProjectRequest, Env, GitHubRepository, ServicePreset } from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const BLUEPRINT_VERSION = 1;

class GitHubServiceApiError extends Error {
  constructor(readonly status: number, readonly path: string, detail: string) {
    super(`GitHub API ${status} on ${path}: ${detail}`);
  }
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

interface ServiceMarker {
  schemaVersion: number;
  projectType: "service";
  preset: ServicePreset;
  blueprintVersion: number;
}

async function githubRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
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
    throw new GitHubServiceApiError(response.status, path, await response.text());
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

async function fetchRepository(token: string, owner: string, slug: string): Promise<GitHubRepository | null> {
  try {
    return await githubRequest<GitHubRepository>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof GitHubServiceApiError && error.status === 404) return null;
    throw error;
  }
}

async function readJsonFile<T>(
  token: string,
  repository: GitHubRepository,
  path: string
): Promise<T | null> {
  const [owner, repo] = repository.full_name.split("/");
  try {
    const file = await githubRequest<{ content: string; encoding: string }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`
    );
    if (file.encoding !== "base64") throw new Error(`Unsupported GitHub content encoding for ${path}.`);
    return JSON.parse(decodeBase64(file.content)) as T;
  } catch (error) {
    if (error instanceof GitHubServiceApiError && error.status === 404) return null;
    throw error;
  }
}

async function writeProvisioningMarker(
  token: string,
  repository: GitHubRepository,
  preset: ServicePreset
): Promise<void> {
  const [owner, repo] = repository.full_name.split("/");
  const path = ".appfactory/service-provisioning.json";
  const body = {
    schemaVersion: 1,
    projectType: "service",
    preset,
    blueprintVersion: BLUEPRINT_VERSION,
    complete: false
  };
  await githubRequest(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: "chore(appfactory): claim service provisioning",
        content: encodeBase64(`${JSON.stringify(body, null, 2)}\n`),
        branch: repository.default_branch || "main"
      })
    }
  );
}

async function getHeadSha(token: string, repository: GitHubRepository): Promise<string> {
  const [owner, repo] = repository.full_name.split("/");
  const ref = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(repository.default_branch || "main")}`
  );
  return ref.object.sha;
}

async function materializeBlueprint(
  token: string,
  env: Env,
  repository: GitHubRepository,
  preset: ServicePreset
): Promise<string> {
  const owner = env.GITHUB_OWNER || "Trigenys";
  const sourceRepo = env.GITHUB_SERVICE_BLUEPRINT_REPO || "appfactory";
  const source = await githubRequest<GitHubRepository>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(sourceRepo)}`
  );
  const sourceRef = env.GITHUB_SERVICE_BLUEPRINT_REF || source.default_branch || "main";
  const prefix = `blueprints/${preset}/`;
  const tree = await githubRequest<{ truncated: boolean; tree: GitTreeEntry[] }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(sourceRepo)}/git/trees/${encodeURIComponent(sourceRef)}?recursive=1`
  );
  if (tree.truncated) throw new Error("AppFactory blueprint tree is too large to materialize safely.");

  const sourceBlobs = tree.tree.filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix));
  if (sourceBlobs.length === 0) throw new Error(`No files found for service blueprint ${preset}.`);

  const [targetOwner, targetRepo] = repository.full_name.split("/");
  const targetEntries = await Promise.all(sourceBlobs.map(async (entry) => {
    const sourceBlob = await githubRequest<{ content: string; encoding: string }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(sourceRepo)}/git/blobs/${entry.sha}`
    );
    if (sourceBlob.encoding !== "base64") throw new Error(`Unsupported blueprint encoding for ${entry.path}.`);
    const targetBlob = await githubRequest<{ sha: string }>(
      token,
      `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({ content: sourceBlob.content.replace(/\s+/g, ""), encoding: "base64" })
      }
    );
    return {
      path: entry.path.slice(prefix.length),
      mode: entry.mode,
      type: "blob",
      sha: targetBlob.sha
    };
  }));

  const targetTree = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/trees`,
    { method: "POST", body: JSON.stringify({ tree: targetEntries }) }
  );
  const parentSha = await getHeadSha(token, repository);
  const commit = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: `feat(appfactory): materialize ${preset} service blueprint`,
        tree: targetTree.sha,
        parents: [parentSha]
      })
    }
  );
  await githubRequest(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/refs/heads/${encodeURIComponent(repository.default_branch || "main")}`,
    { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) }
  );
  return commit.sha;
}

function validMarker(marker: ServiceMarker | null, preset: ServicePreset): boolean {
  return Boolean(
    marker &&
    marker.schemaVersion === 1 &&
    marker.projectType === "service" &&
    marker.preset === preset &&
    marker.blueprintVersion === BLUEPRINT_VERSION
  );
}

export async function provisionServiceRepository(
  token: string,
  env: Env,
  input: CreateProjectRequest & { slug: string; projectType: "service"; preset: ServicePreset }
): Promise<{ repository: GitHubRepository; commitSha: string; replay: boolean }> {
  const owner = env.GITHUB_OWNER || "Trigenys";
  let repository = await fetchRepository(token, owner, input.slug);

  if (repository) {
    const marker = await readJsonFile<ServiceMarker>(token, repository, ".appfactory/service.json");
    if (validMarker(marker, input.preset)) {
      return { repository, commitSha: await getHeadSha(token, repository), replay: true };
    }
    const provisioning = await readJsonFile<ServiceMarker & { complete?: boolean }>(
      token,
      repository,
      ".appfactory/service-provisioning.json"
    );
    if (!provisioning || provisioning.preset !== input.preset || provisioning.complete !== false) {
      throw new Error(`Repository ${repository.full_name} already exists and is not managed by the requested service preset.`);
    }
  } else {
    repository = await createRepositoryFromTemplate(token, env, input);
    await writeProvisioningMarker(token, repository, input.preset);
  }

  const commitSha = await materializeBlueprint(token, env, repository, input.preset);
  return { repository, commitSha, replay: false };
}
