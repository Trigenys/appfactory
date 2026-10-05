import type {
  CloudflareApiResponse,
  CloudflarePagesDeployment,
  CloudflarePagesDomain,
  CloudflarePagesProject,
  Env,
  GitHubRepository
} from "./types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export interface PagesProjectOptions {
  projectName?: string;
  productionBranch?: string;
  buildCommand?: string;
  destinationDir?: string;
  rootDir?: string;
  previewDeploymentSetting?: "all" | "none" | "custom";
}

export class CloudflarePagesApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string
  ) {
    super(`Cloudflare API ${status} on ${path}: ${detail}`);
  }
}

function pagesApiToken(env: Env): string {
  const token = env.CLOUDFLARE_PAGES_D1_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Missing Cloudflare Pages resource credential. Configure CLOUDFLARE_PAGES_D1_TOKEN or the legacy CLOUDFLARE_API_TOKEN fallback."
    );
  }
  return token;
}

function assertCloudflareConfig(env: Env): asserts env is Env & {
  CLOUDFLARE_ACCOUNT_ID: string;
} {
  if (!env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID Worker runtime variable.");
  }
  pagesApiToken(env);
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
    throw new CloudflarePagesApiError(
      response.status,
      path,
      "Cloudflare returned an empty response body."
    );
  }

  try {
    return JSON.parse(text) as CloudflareApiResponse<T>;
  } catch {
    throw new CloudflarePagesApiError(
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
  headers.set("Authorization", `Bearer ${pagesApiToken(env)}`);
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
    throw new CloudflarePagesApiError(response.status, path, detail);
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
      if (error instanceof CloudflarePagesApiError && error.status === 404) return null;
      if (
        error instanceof CloudflarePagesApiError &&
        (error.detail.includes("empty response body") ||
          error.detail.includes("malformed JSON")) &&
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
  const path =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID || "")}/pages/projects/${encodeURIComponent(project.name)}/deployments?per_page=1`;
  const deployments = await cloudflareRequest<CloudflarePagesDeployment[]>(env, path);
  return deployments[0] || null;
}

function resolveProjectOptions(
  repository: GitHubRepository,
  options: PagesProjectOptions
): Required<PagesProjectOptions> {
  return {
    projectName: options.projectName || repository.name,
    productionBranch: options.productionBranch || repository.default_branch || "main",
    buildCommand: options.buildCommand || "npm run build",
    destinationDir: options.destinationDir || "dist",
    rootDir: options.rootDir || "/",
    previewDeploymentSetting: options.previewDeploymentSetting || "all"
  };
}

function desiredProjectPayload(
  repository: GitHubRepository,
  options: Required<PagesProjectOptions>
) {
  const source = expectedGitHubSource(repository);

  return {
    name: options.projectName,
    production_branch: options.productionBranch,
    build_config: {
      build_command: options.buildCommand,
      destination_dir: options.destinationDir,
      root_dir: options.rootDir
    },
    source: {
      type: "github" as const,
      config: {
        owner: source.owner,
        owner_id: source.ownerId,
        repo_id: source.repoId,
        repo_name: source.repoName,
        production_branch: options.productionBranch,
        production_deployments_enabled: true,
        preview_deployment_setting: options.previewDeploymentSetting,
        pr_comments_enabled: true
      }
    }
  };
}

function projectNeedsReconcile(
  project: CloudflarePagesProject,
  options: Required<PagesProjectOptions>
): boolean {
  const source = project.source?.config;
  const build = project.build_config;

  return (
    project.production_branch !== options.productionBranch ||
    build?.build_command !== options.buildCommand ||
    build?.destination_dir !== options.destinationDir ||
    build?.root_dir !== options.rootDir ||
    source?.production_branch !== options.productionBranch ||
    source?.production_deployments_enabled !== true ||
    source?.preview_deployment_setting !== options.previewDeploymentSetting ||
    source?.pr_comments_enabled !== true
  );
}

async function reconcilePagesProject(
  env: Env,
  projectPath: string,
  project: CloudflarePagesProject,
  repository: GitHubRepository,
  options: Required<PagesProjectOptions>
): Promise<CloudflarePagesProject> {
  if (!projectNeedsReconcile(project, options)) return project;

  const desired = desiredProjectPayload(repository, options);
  const updated = await cloudflareRequest<CloudflarePagesProject>(env, projectPath, {
    method: "PATCH",
    body: JSON.stringify({
      production_branch: desired.production_branch,
      build_config: desired.build_config,
      source: desired.source
    })
  });

  return verifyProjectSource(updated, repository);
}

export async function ensurePagesProject(
  env: Env,
  repository: GitHubRepository,
  options: PagesProjectOptions = {}
): Promise<CloudflarePagesProject> {
  assertCloudflareConfig(env);
  const resolved = resolveProjectOptions(repository, options);
  const projectPath =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(resolved.projectName)}`;
  const existing = await getPagesProjectIfPresent(env, projectPath, repository);

  if (existing) {
    return reconcilePagesProject(env, projectPath, existing, repository, resolved);
  }

  const collectionPath =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects`;
  const body = JSON.stringify(desiredProjectPayload(repository, resolved));
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
      if (!(error instanceof CloudflarePagesApiError)) throw error;

      const ambiguousSuccess =
        error.status >= 200 &&
        error.status < 300 &&
        (error.detail.includes("empty response body") ||
          error.detail.includes("malformed JSON"));

      if (
        ambiguousSuccess ||
        error.status === 400 ||
        error.status === 409 ||
        error.status >= 500
      ) {
        const created = await getPagesProjectIfPresent(env, projectPath, repository);
        if (created) {
          return reconcilePagesProject(env, projectPath, created, repository, resolved);
        }
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

export async function ensurePagesCustomDomain(
  env: Env,
  project: CloudflarePagesProject,
  domain: string
): Promise<CloudflarePagesDomain> {
  assertCloudflareConfig(env);
  const collectionPath =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(project.name)}/domains`;

  const domains = await cloudflareRequest<CloudflarePagesDomain[]>(env, collectionPath);
  const existing = domains.find(
    (candidate) => candidate.name.toLowerCase() === domain.toLowerCase()
  );
  if (existing) return existing;

  try {
    return await cloudflareRequest<CloudflarePagesDomain>(env, collectionPath, {
      method: "POST",
      body: JSON.stringify({ name: domain })
    });
  } catch (error) {
    if (
      error instanceof CloudflarePagesApiError &&
      (error.status === 400 || error.status === 409)
    ) {
      const refreshed = await cloudflareRequest<CloudflarePagesDomain[]>(
        env,
        collectionPath
      );
      const created = refreshed.find(
        (candidate) => candidate.name.toLowerCase() === domain.toLowerCase()
      );
      if (created) return created;
    }
    throw error;
  }
}

export async function triggerPagesDeployment(
  env: Env,
  project: CloudflarePagesProject,
  branch: string
): Promise<CloudflarePagesDeployment> {
  assertCloudflareConfig(env);

  const deploymentPath =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(project.name)}/deployments`;
  const form = new FormData();
  form.set("branch", branch);

  try {
    return await cloudflareRequest<CloudflarePagesDeployment>(env, deploymentPath, {
      method: "POST",
      body: form
    });
  } catch (error) {
    if (!(error instanceof CloudflarePagesApiError)) throw error;

    const ambiguousSuccess =
      error.status >= 200 &&
      error.status < 300 &&
      (error.detail.includes("empty response body") ||
        error.detail.includes("malformed JSON"));

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
