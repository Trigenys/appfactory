import type { GitHubRepository } from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

class ManagedBlueprintUpgradeError extends Error {
  constructor(readonly status: number, readonly path: string, detail: string) {
    super(`GitHub API ${status} on ${path}: ${detail}`);
  }
}

interface GitHubContent {
  content: string;
  encoding: string;
}

interface CommitIdentity {
  headSha: string;
  treeSha: string;
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

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
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
    throw new ManagedBlueprintUpgradeError(response.status, path, await response.text());
  }
  return (await response.json()) as T;
}

async function currentCommit(
  token: string,
  repository: GitHubRepository
): Promise<CommitIdentity> {
  const [owner, repo] = repository.full_name.split("/");
  const branch = repository.default_branch || "main";
  const ref = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  const commit = await githubRequest<{ tree: { sha: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${ref.object.sha}`
  );
  return { headSha: ref.object.sha, treeSha: commit.tree.sha };
}

async function sourceText(
  token: string,
  sourceOwner: string,
  sourceRepo: string,
  sourceRef: string,
  path: string
): Promise<string> {
  const file = await githubRequest<GitHubContent>(
    token,
    `/repos/${encodeURIComponent(sourceOwner)}/${encodeURIComponent(sourceRepo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(sourceRef)}`
  );
  if (file.encoding !== "base64") {
    throw new Error(`Unsupported blueprint encoding for ${path}.`);
  }
  return decodeBase64(file.content);
}

export async function applyManagedBlueprintUpgrade({
  token,
  repository,
  sourceOwner,
  sourceRepo,
  sourceRef,
  sourcePrefix,
  managedPaths,
  commitMessage
}: {
  token: string;
  repository: GitHubRepository;
  sourceOwner: string;
  sourceRepo: string;
  sourceRef: string;
  sourcePrefix: string;
  managedPaths: readonly string[];
  commitMessage: string;
}): Promise<string> {
  if (!managedPaths.length) throw new Error("Managed blueprint upgrade must declare at least one file.");

  const uniquePaths = [...new Set(managedPaths)];
  if (uniquePaths.length !== managedPaths.length) {
    throw new Error("Managed blueprint upgrade contains duplicate file paths.");
  }

  const [targetOwner, targetRepo] = repository.full_name.split("/");
  const { headSha, treeSha } = await currentCommit(token, repository);

  const entries = await Promise.all(uniquePaths.map(async (targetPath) => {
    const sourcePath = `${sourcePrefix.replace(/\/$/u, "")}/${targetPath}`;
    const content = await sourceText(
      token,
      sourceOwner,
      sourceRepo,
      sourceRef,
      sourcePath
    );
    const blob = await githubRequest<{ sha: string }>(
      token,
      `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({ content: encodeBase64(content), encoding: "base64" })
      }
    );
    return { path: targetPath, mode: "100644", type: "blob", sha: blob.sha };
  }));

  const tree = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({ base_tree: treeSha, tree: entries })
    }
  );

  const commit = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: commitMessage,
        tree: tree.sha,
        parents: [headSha]
      })
    }
  );

  await githubRequest(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/refs/heads/${encodeURIComponent(repository.default_branch || "main")}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false })
    }
  );

  return commit.sha;
}
