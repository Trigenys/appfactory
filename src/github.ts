import type {
  CreateProjectRequest,
  Env,
  GitHubContentCommit,
  GitHubContentFile,
  GitHubRepository
} from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

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

function pemToPkcs8(pem: string): ArrayBuffer {
  if (pem.includes("BEGIN PRIVATE KEY")) {
    return decodePem(pem, "PRIVATE KEY").buffer;
  }

  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    return pkcs1ToPkcs8(decodePem(pem, "RSA PRIVATE KEY")).buffer;
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
    throw new Error(`GitHub API ${response.status} on ${path}: ${detail}`);
  }

  return (await response.json()) as T;
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
  const owner = env.GITHUB_OWNER || "Trigenys";
  const templateOwner = env.GITHUB_TEMPLATE_OWNER || owner;
  const templateRepo = env.GITHUB_TEMPLATE_REPO || "appfactory-landing-template";

  return githubRequest<GitHubRepository>(
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
}

export async function replaceManifest(
  token: string,
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
      branch: repository.default_branch
    })
  });
  return result.commit.sha;
}
