import type { CreateProjectRequest, Env, GitHubRepository } from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const STATE_PATH = "appfactory.state.json";
const DEFAULT_COMMIT_AUTHOR_NAME = "EagleFox31";
const DEFAULT_COMMIT_AUTHOR_EMAIL = "86088743+EagleFox31@users.noreply.github.com";

export interface ProjectIdempotencyState {
  schemaVersion: 1;
  engine: "native" | "openpage";
  requestHash: string;
  contentHash: string;
  complete: true;
}

interface GitHubContentResponse {
  sha: string;
  content?: string;
  encoding?: string;
}

interface GitHubContentCommitResponse {
  commit: { sha: string };
}

function commitAuthor(env: Env): { name: string; email: string } {
  return {
    name: env.GITHUB_COMMIT_AUTHOR_NAME || DEFAULT_COMMIT_AUTHOR_NAME,
    email: env.GITHUB_COMMIT_AUTHOR_EMAIL || DEFAULT_COMMIT_AUTHOR_EMAIL
  };
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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
    const detail = await response.text();
    const error = new Error(`GitHub API ${response.status} on ${path}: ${detail}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

function canonicalProjectRequest(input: CreateProjectRequest & { slug: string }): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: input.name,
    slug: input.slug,
    description: input.description ?? null,
    private: input.private ?? true,
    brief: input.brief ?? null,
    language: input.language ?? "en",
    audience: input.audience ?? null,
    goal: input.goal ?? null,
    engine: input.engine ?? "native",
    recipe: input.recipe ?? null,
    animation: input.animation ?? null,
    heroTitle: input.heroTitle ?? null,
    heroSubtitle: input.heroSubtitle ?? null,
    primaryCtaLabel: input.primaryCtaLabel ?? null,
    primaryCtaHref: input.primaryCtaHref ?? null
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function projectRequestHash(
  input: CreateProjectRequest & { slug: string }
): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalProjectRequest(input)));
}

export async function projectContentHash(parts: Array<string | undefined | null>): Promise<string> {
  return sha256Hex(parts.map((part) => part ?? "").join("\n---APPFACTORY-PART---\n"));
}

function stateText(state: ProjectIdempotencyState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export async function readProjectState(
  token: string,
  repository: GitHubRepository
): Promise<ProjectIdempotencyState | null> {
  const [owner, repo] = repository.full_name.split("/");
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${STATE_PATH}?ref=${encodeURIComponent(repository.default_branch || "main")}`;

  let file: GitHubContentResponse;
  try {
    file = await githubRequest<GitHubContentResponse>(token, path);
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) return null;
    throw error;
  }

  if (file.encoding !== "base64" || !file.content) return null;

  let parsed: Partial<ProjectIdempotencyState>;
  try {
    parsed = JSON.parse(decodeBase64Utf8(file.content)) as Partial<ProjectIdempotencyState>;
  } catch {
    return null;
  }

  if (
    parsed.schemaVersion !== 1 ||
    (parsed.engine !== "native" && parsed.engine !== "openpage") ||
    typeof parsed.requestHash !== "string" ||
    typeof parsed.contentHash !== "string" ||
    parsed.complete !== true
  ) {
    return null;
  }

  return parsed as ProjectIdempotencyState;
}

export async function getRepositoryHeadSha(
  token: string,
  repository: GitHubRepository
): Promise<string> {
  const [owner, repo] = repository.full_name.split("/");
  const branch = repository.default_branch || "main";
  const ref = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  return ref.object.sha;
}

export async function saveProjectState(
  token: string,
  env: Env,
  repository: GitHubRepository,
  state: ProjectIdempotencyState
): Promise<{ commitSha: string; changed: boolean }> {
  const [owner, repo] = repository.full_name.split("/");
  const branch = repository.default_branch || "main";
  const encodedPath = STATE_PATH.split("/").map(encodeURIComponent).join("/");
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
  const desired = stateText(state);

  let current: GitHubContentResponse | null = null;
  try {
    current = await githubRequest<GitHubContentResponse>(token, `${path}?ref=${encodeURIComponent(branch)}`);
    if (current.encoding === "base64" && current.content && decodeBase64Utf8(current.content) === desired) {
      return { commitSha: await getRepositoryHeadSha(token, repository), changed: false };
    }
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 404) throw error;
  }

  const result = await githubRequest<GitHubContentCommitResponse>(token, path, {
    method: "PUT",
    body: JSON.stringify({
      message: "chore(appfactory): checkpoint idempotency state",
      content: encodeBase64Utf8(desired),
      branch,
      author: commitAuthor(env),
      ...(current?.sha ? { sha: current.sha } : {})
    })
  });

  return { commitSha: result.commit.sha, changed: true };
}
