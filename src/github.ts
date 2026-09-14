import type {
  CreateProjectRequest,
  Env,
  GitHubContentCommit,
  GitHubContentFile,
  GitHubRepository
} from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_COMMIT_AUTHOR_NAME = "EagleFox31";
const DEFAULT_COMMIT_AUTHOR_EMAIL = "86088743+EagleFox31@users.noreply.github.com";

class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string
  ) {
    super(`GitHub API ${status} on ${path}: ${detail}`);
  }
}

function commitAuthor(env: Env): { name: string; email: string } {
  return {
    name: env.GITHUB_COMMIT_AUTHOR_NAME || DEFAULT_COMMIT_AUTHOR_NAME,
    email: env.GITHUB_COMMIT_AUTHOR_EMAIL || DEFAULT_COMMIT_AUTHOR_EMAIL
  };
}

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag), derLength(value.length), value);
}

function decodePem(pem: string, label: string): Uint8Array {
  const base64 = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithmIdentifier = Uint8Array.of(
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00
  );
  const privateKey = der(0x04, pkcs1);
  return der(0x30, concatBytes(version, rsaAlgorithmIdentifier, privateKey));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function pemToPkcs8(pem: string): ArrayBuffer {
  if (pem.includes("BEGIN PRIVATE KEY")) {
    return toArrayBuffer(decodePem(pem, "PRIVATE KEY"));
  }

  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    return toArrayBuffer(pkcs1ToPkcs8(decodePem(pem, "RSA PRIVATE KEY")));
  }

  throw new Error(
    "GITHUB_PRIVATE_KEY must contain a PEM private key (BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY)."
  );
}

export async function createGitHubAppJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: env.GITHUB_APP_ID
    })
  );
  const unsigned = `${header}.${payload}`;
  const privateKey = env.GITHUB_PRIVATE_KEY || env.GITHUB_PRIVATE_KEY_PKCS8;

  if (!privateKey) {
    throw new Error("Missing GITHUB_PRIVATE_KEY Worker secret.");
  }

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
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
    const detail = await response.text();
    throw new GitHubApiError(response.status, path, detail);
  }

  return (await response.json()) as T;
}

function templateCoordinates(env: Env): {
  owner: string;
  templateOwner: string;
  templateRepo: string;
} {
  const owner = env.GITHUB_OWNER || "Trigenys";
  return {
    owner,
    templateOwner: env.GITHUB_TEMPLATE_OWNER || owner,
    templateRepo: env.GITHUB_TEMPLATE_REPO || "appfactory-landing-template"
  };
}

async function getExistingGeneratedRepository(
  token: string,
  owner: string,
  slug: string,
  templateOwner: string,
  templateRepo: string
): Promise<GitHubRepository> {
  const existing = await githubRequest<GitHubRepository>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`
  );
  const expectedTemplate = `${templateOwner}/${templateRepo}`.toLowerCase();
  const actualTemplate = existing.template_repository?.full_name?.toLowerCase();

  if (actualTemplate !== expectedTemplate) {
    throw new Error(
      `Repository ${existing.full_name} already exists and was not created from ${templateOwner}/${templateRepo}. Choose another slug.`
    );
  }

  return existing;
}

async function hasManifest(token: string, repository: GitHubRepository): Promise<boolean> {
  const [owner, repo] = repository.full_name.split("/");
  try {
    await githubRequest<GitHubContentFile>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/appfactory.json`
    );
    return true;
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return false;
    throw error;
  }
}

async function materializeTemplate(
  token: string,
  env: Env,
  repository: GitHubRepository
): Promise<void> {
  const { templateOwner, templateRepo } = templateCoordinates(env);
  const [targetOwner, targetRepo] = repository.full_name.split("/");

  const template = await githubRequest<GitHubRepository>(
    token,
    `/repos/${encodeURIComponent(templateOwner)}/${encodeURIComponent(templateRepo)}`
  );
  const tree = await githubRequest<{
    truncated: boolean;
    tree: Array<{ path: string; mode: string; type: string; sha: string }>;
  }>(
    token,
    `/repos/${encodeURIComponent(templateOwner)}/${encodeURIComponent(templateRepo)}/git/trees/${encodeURIComponent(template.default_branch)}?recursive=1`
  );

  if (tree.truncated) {
    throw new Error("Template tree is too large to materialize safely in one request.");
  }

  const blobs = tree.tree.filter((entry) => entry.type === "blob");
  const copiedEntries = await Promise.all(
    blobs.map(async (entry) => {
      const source = await githubRequest<{ content: string; encoding: string }>(
        token,
        `/repos/${encodeURIComponent(templateOwner)}/${encodeURIComponent(templateRepo)}/git/blobs/${entry.sha}`
      );
      if (source.encoding !== "base64") {
        throw new Error(`Unsupported blob encoding for ${entry.path}: ${source.encoding}`);
      }

      const copied = await githubRequest<{ sha: string }>(
        token,
        `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/blobs`,
        {
          method: "POST",
          body: JSON.stringify({
            content: source.content.replace(/\s+/g, ""),
            encoding: "base64"
          })
        }
      );

      return {
        path: entry.path,
        mode: entry.mode,
        type: "blob",
        sha: copied.sha
      };
    })
  );

  const targetTree = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({ tree: copiedEntries })
    }
  );
  const commit = await githubRequest<{ sha: string }>(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: "chore(appfactory): materialize landing template",
        tree: targetTree.sha,
        parents: [],
        author: commitAuthor(env)
      })
    }
  );

  await githubRequest<unknown>(
    token,
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/git/refs`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${repository.default_branch || "main"}`,
        sha: commit.sha
      })
    }
  );
}

async function ensureTemplateMaterialized(
  token: string,
  env: Env,
  repository: GitHubRepository
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hasManifest(token, repository)) return;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  await materializeTemplate(token, env, repository);
}

export async function getInstallationToken(env: Env): Promise<string> {
  const jwt = await createGitHubAppJwt(env);
  const result = await githubRequest<{ token: string }>(
    jwt,
    `/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    { method: "POST" }
  );
  return result.token;
}

export async function createRepositoryFromTemplate(
  token: string,
  env: Env,
  input: CreateProjectRequest & { slug: string }
): Promise<GitHubRepository> {
  const { owner, templateOwner, templateRepo } = templateCoordinates(env);
  let repository: GitHubRepository;

  try {
    repository = await githubRequest<GitHubRepository>(
      token,
      `/repos/${encodeURIComponent(templateOwner)}/${encodeURIComponent(templateRepo)}/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          owner,
          name: input.slug,
          description: input.description || `Generated by AppFactory for ${input.name}`,
          private: input.private ?? true,
          include_all_branches: false
        })
      }
    );
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 422) throw error;
    repository = await getExistingGeneratedRepository(
      token,
      owner,
      input.slug,
      templateOwner,
      templateRepo
    );
  }

  await ensureTemplateMaterialized(token, env, repository);
  return repository;
}

export async function replaceManifest(
  token: string,
  env: Env,
  repository: GitHubRepository,
  manifest: unknown
): Promise<string> {
  const [owner, repo] = repository.full_name.split("/");
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/appfactory.json`;
  const current = await githubRequest<GitHubContentFile>(token, path);
  const result = await githubRequest<GitHubContentCommit>(token, path, {
    method: "PUT",
    body: JSON.stringify({
      message: "chore(appfactory): configure generated project",
      content: toBase64(`${JSON.stringify(manifest, null, 2)}\n`),
      sha: current.sha,
      branch: repository.default_branch,
      author: commitAuthor(env)
    })
  });
  return result.commit.sha;
}
