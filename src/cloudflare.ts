import type {
  CloudflareApiResponse,
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

async function cloudflareRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  assertCloudflareConfig(env);

  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const payload = (await response.json()) as CloudflareApiResponse<T>;
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

export async function ensurePagesProject(
  env: Env,
  repository: GitHubRepository
): Promise<CloudflarePagesProject> {
  assertCloudflareConfig(env);
  const source = expectedGitHubSource(repository);
  const projectName = repository.name;
  const projectPath = `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(projectName)}`;

  try {
    const existing = await cloudflareRequest<CloudflarePagesProject>(env, projectPath);
    return verifyProjectSource(existing, repository);
  } catch (error) {
    if (!(error instanceof CloudflareApiError) || error.status !== 404) throw error;
  }

  const collectionPath = `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects`;
  try {
    return await cloudflareRequest<CloudflarePagesProject>(env, collectionPath, {
      method: "POST",
      body: JSON.stringify({
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
      })
    });
  } catch (error) {
    // A retry may race with an already-created Pages project. Resume safely.
    if (error instanceof CloudflareApiError && (error.status === 409 || error.status === 400)) {
      const existing = await cloudflareRequest<CloudflarePagesProject>(env, projectPath);
      return verifyProjectSource(existing, repository);
    }
    throw error;
  }
}

export function pagesProjectUrl(project: CloudflarePagesProject): string | null {
  return project.subdomain ? `https://${project.subdomain}` : null;
}
