import type { GitHubRepository } from "./types";

// Shared blueprint materializer for every provisioning path (desktop, mobile, service, webapp).
// Contract: one Git tree request carries every text file inline; only binary assets get their own
// blob write, because tree entries only accept UTF-8 content. This keeps a Worker invocation far
// below the Cloudflare subrequest limit (failure memory 2026-09-24 and 2026-11-04).
// Kept free of runtime imports and non-erasable TypeScript so tests can execute it directly.

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

export const DEFAULT_BINARY_EXTENSIONS: readonly string[] = [
  ".ico", ".icns", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2"
];

export interface BlueprintTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

export interface BlueprintFile {
  entry: BlueprintTreeEntry;
  targetPath: string;
}

export interface BlueprintSourceContext {
  tree: BlueprintTreeEntry[];
  readText(entry: BlueprintTreeEntry): Promise<string>;
}

export interface MaterializeBlueprintOptions {
  token: string;
  /** Product label used in errors and the commit message (desktop, mobile, service, webapp). */
  kind: string;
  preset: string;
  source: { owner: string; repo: string; ref?: string };
  targetOwner: string;
  repository: GitHubRepository;
  /** Source directory copied to the target root; defaults to `blueprints/<preset>/`. */
  prefix?: string;
  /** Renders a text file; binary files are copied byte for byte and never rendered. */
  render(content: string, file: BlueprintFile): string;
  /** Rewrites a path relative to the prefix; defaults to identity. */
  mapPath?(relativePath: string): string;
  /** Adds files from outside the prefix; later entries win on duplicate target paths. */
  extraFiles?(context: BlueprintSourceContext): Promise<BlueprintFile[]>;
  binaryExtensions?: readonly string[];
}

export class BlueprintGitHubError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, detail: string) {
    super(`GitHub API ${status} on ${path}: ${detail}`);
    this.status = status;
    this.path = path;
  }
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
  if (!response.ok) throw new BlueprintGitHubError(response.status, path, await response.text());
  return (await response.json()) as T;
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function isBinaryPath(path: string, binaryExtensions: readonly string[] = DEFAULT_BINARY_EXTENSIONS): boolean {
  const lower = path.toLowerCase();
  return binaryExtensions.some((extension) => lower.endsWith(extension));
}

export async function materializeBlueprint(options: MaterializeBlueprintOptions): Promise<string> {
  const { token, kind, preset, repository, targetOwner } = options;
  const sourceRepoPath = repoPath(options.source.owner, options.source.repo);
  const sourceRef = options.source.ref ||
    (await githubRequest<GitHubRepository>(token, sourceRepoPath)).default_branch ||
    "main";
  const prefix = options.prefix ?? `blueprints/${preset}/`;
  const tree = await githubRequest<{ truncated: boolean; tree: BlueprintTreeEntry[] }>(
    token,
    `${sourceRepoPath}/git/trees/${encodeURIComponent(sourceRef)}?recursive=1`
  );
  if (tree.truncated) throw new Error(`AppFactory ${kind} blueprint tree is too large to materialize safely.`);

  const readBase64 = async (entry: BlueprintTreeEntry): Promise<string> => {
    const blob = await githubRequest<{ content: string; encoding: string }>(
      token,
      `${sourceRepoPath}/git/blobs/${entry.sha}`
    );
    if (blob.encoding !== "base64") throw new Error(`Unsupported blueprint encoding for ${entry.path}.`);
    return blob.content;
  };

  const mapPath = options.mapPath ?? ((path: string) => path);
  const files: BlueprintFile[] = tree.tree
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix))
    .map((entry) => ({ entry, targetPath: mapPath(entry.path.slice(prefix.length)) }));
  if (files.length === 0) throw new Error(`No files found for ${kind} blueprint ${preset}.`);
  if (options.extraFiles) {
    files.push(...await options.extraFiles({
      tree: tree.tree,
      readText: async (entry) => decodeBase64(await readBase64(entry))
    }));
  }

  const [, targetRepo] = repository.full_name.split("/");
  const targetRepoPath = repoPath(targetOwner, targetRepo);
  const binaryExtensions = options.binaryExtensions ?? DEFAULT_BINARY_EXTENSIONS;

  const entries = await Promise.all(files.map(async (file) => {
    const content = await readBase64(file.entry);
    if (!isBinaryPath(file.entry.path, binaryExtensions)) {
      // Text files travel inline in the single tree request: no per-file write.
      return {
        path: file.targetPath,
        mode: file.entry.mode,
        type: "blob",
        content: options.render(decodeBase64(content), file)
      };
    }
    // Tree entries only carry UTF-8 content, so binary assets still need their own blob.
    const blob = await githubRequest<{ sha: string }>(token, `${targetRepoPath}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: content.replace(/\s+/g, ""), encoding: "base64" })
    });
    return { path: file.targetPath, mode: file.entry.mode, type: "blob", sha: blob.sha };
  }));

  const branch = repository.default_branch || "main";
  const targetTree = await githubRequest<{ sha: string }>(token, `${targetRepoPath}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: [...new Map(entries.map((entry) => [entry.path, entry])).values()] })
  });
  const head = await githubRequest<{ object: { sha: string } }>(
    token,
    `${repoPath(repository.full_name.split("/")[0], targetRepo)}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  const commit = await githubRequest<{ sha: string }>(token, `${targetRepoPath}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `feat(appfactory): materialize ${preset} ${kind} blueprint`,
      tree: targetTree.sha,
      parents: [head.object.sha]
    })
  });
  await githubRequest(token, `${targetRepoPath}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return commit.sha;
}
