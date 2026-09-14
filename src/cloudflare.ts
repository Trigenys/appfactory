import type {
  CloudflareApiResponse,
  CloudflarePagesDeployment,
  CloudflarePagesProject,
  Env,
  GitHubRepository
} from "./types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

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
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID Worker runtime variable.");
  }
  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new Error("Missing CLOUDFLARE_API_TOKEN Worker secret.");
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseCloudflareResponse<T>(
  response: Response,
  path: string
): Promise<CloudflareApiResponse<T>> {
  const text = await response.text();

  if (!text.trim()) {
    throw new CloudflareApiError(response.status, path, "Cloudflare returned an empty response body.");
  }

  try {
    return JSON.parse(text) as CloudflareApiResponse<T>;
  } catch {
    throw new CloudflareApiError(
      response.status,
      path,
      `Cloudflare returned malformed JSON: ${text.slice(0, 300)}`
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

  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers
  });

  const payload = await parseCloudflareResponse<T>(response, path);
  if (!response.ok || !payload.success) {
    const detail =
      payload.errors?.map((error) => `${error.code}: ${error.message}`).join("; ") ||
      `HTTP ${response.status}`;
    throw new CloudflareApiError(response.status, path, detail);
  }

  return payload.result;
}

function expectedGitHubSource(repository: GitHubRepository): {
  owner: string;
  ownerId: string;
  repoId: string;
  repoName: string;
} {
  if (!repository.id || !repository.owner?.id || !repository.owner.login) {
    throw new Error(
      `Repository ${repository.full_name} is missing GitHub identifiers required for Cloudflare Pages.`
    );
  }

  return {
    owner: repository.owner.login,
    ownerId: String(repository.owner.id),
    repoId: String(repository.id),
    repoName: repository.name
  };
}

function verifyProjectSource(
  project: CloudflarePagesProject,
  repository: GitHubRepository
): CloudflarePagesProject {
  const source = expectedGitHubSource(repository);
  const config = project.source?.config;

  if (
    project.source?.type !== "github" ||
    (config?.repo_id && config.repo_id !== source.repoId) ||
    (config?.repo_name && config.repo_name !== source.repoName) ||
    (config?.owner && config.owner.toLowerCase() !== source.owner.toLowerCase())
  ) {
    throw new Error(
      `Cloudflare Pages project ${project.name} already exists but is not linked to ${repository.full_name}.`
    );
  }

  return project;
}

async function getPagesProjectIfPresent(
  env: Env,
  projectPath: string,
  repository: GitHubRepository
): Promise<CloudflarePagesProject | null> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const existing = await cloudflareRequest<CloudflarePagesProject>(env, projectPath);
      return verifyProjectSource(existing, repository);
    } catch (error) {
      lastError = error;
      if (error instanceof CloudflareApiError && error.status === 404) return null;
      if (
        error instanceof CloudflareApiError &&
        (error.detail.includes("empty response body") || error.detail.includes("malformed JSON")) &&
        attempt === 0
      ) {
        await sleep(500);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function getLatestPagesDeployment(
  env: Env,
  project: CloudflarePagesProject
): Promise<CloudflarePagesDeployment | null> {
  const path = `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/pages/projects/${encodeURIComponent(project.name)}/deployments?per_page=1`;
  const deployments = await cloudflareRequest<CloudflarePagesDeployment[]>(env, path);
  return deployments[0] || null;
}

export async function ensurePagesProject(
  env: Env,
  repository: GitHubRepository
): Promise<CloudflarePagesProject> {
  assertCloudflareConfig(env);
  const source = expectedGitHubSource(repository);
  const projectName = repository.name;
  const projectPath = `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(projectName)}`;
  const existing = await getPagesProjectIfPresent(env, projectPath, repository);
  if (existing) return existing;

  const collectionPath = `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects`;
  const body = JSON.stringify({
    name: projectName,
    production_branch: repository.default_branch || "main",
    build_config: {
      build_command: "npm run build",
      destination_dir: "dist",
      root_dir: "/"
    },
    source: {
      type: "github",
      config: {
        owner: source.owner,
        owner_id: source.ownerId,
        repo_id: source.repoId,
        repo_name: source.repoName,
        production_branch: repository.default_branch || "main",
        production_deployments_enabled: true,
        preview_deployment_setting: "all",
        pr_comments_enabled: true
      }
    }
  });

  let lastError: unknown;

  // A newly generated private repository can take a few seconds to become visible
  // to Cloudflare's GitHub installation. Retry only transient server failures, and
  // always check whether Cloudflare created the project before issuing another POST.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await cloudflareRequest<CloudflarePagesProject>(env, collectionPath, {
        method: "POST",
        body
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof CloudflareApiError)) throw error;

      const ambiguousSuccess =
        error.status >= 200 &&
        error.status < 300 &&
        (error.detail.includes("empty response body") || error.detail.includes("malformed JSON"));

      if (
        ambiguousSuccess ||
        error.status === 400 ||
        error.status === 409 ||
        error.status >= 500
      ) {
        const created = await getPagesProjectIfPresent(env, projectPath, repository);
        if (created) return created;
      }

      if ((ambiguousSuccess || error.status >= 500) && attempt < 3) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

export async function triggerPagesDeployment(
  env: Env,
  project: CloudflarePagesProject,
  branch: string
): Promise<CloudflarePagesDeployment> {
  assertCloudflareConfig(env);

  const deploymentPath = `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(project.name)}/deployments`;
  const form = new FormData();
  form.set("branch", branch);

  try {
    return await cloudflareRequest<CloudflarePagesDeployment>(env, deploymentPath, {
      method: "POST",
      body: form
    });
  } catch (error) {
    if (!(error instanceof CloudflareApiError)) throw error;

    const ambiguousSuccess =
      error.status >= 200 &&
      error.status < 300 &&
      (error.detail.includes("empty response body") || error.detail.includes("malformed JSON"));

    if (ambiguousSuccess || error.status >= 500) {
      await sleep(750);
      const latest = await getLatestPagesDeployment(env, project);
      if (latest) return latest;
    }

    throw error;
  }
}

export function pagesProjectUrl(project: CloudflarePagesProject): string | null {
  return project.subdomain ? `https://${project.subdomain}` : null;
}
