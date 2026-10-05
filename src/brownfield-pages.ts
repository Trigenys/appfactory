import {
  CloudflarePagesApiError,
  ensurePagesCustomDomain,
  ensurePagesProject,
  pagesProjectUrl,
  triggerPagesDeployment
} from "./cloudflare";
import { findReusablePagesDeployment } from "./deployment-idempotency";
import { getRepositoryHeadSha } from "./idempotency";
import type {
  CloudflarePagesDomain,
  Env,
  GitHubContentCommit,
  GitHubRepository
} from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MARKER_PATH = ".appfactory/pages-infrastructure.json";
const SCHEMA_VERSION = 1;

interface PagesInfrastructureMarker {
  schemaVersion: number;
  provider: "cloudflare-pages";
  repository: string;
  projectName: string;
  productionBranch: string;
  rootDirectory: string;
  buildCommand: string;
  outputDirectory: string;
  customDomain?: string;
}

export interface BrownfieldPagesRequest {
  repository: string;
  projectName?: string;
  productionBranch?: string;
  rootDirectory?: string;
  buildCommand?: string;
  outputDirectory?: string;
  customDomain?: string;
}

export interface BrownfieldPagesResult {
  repository: string;
  provider: "cloudflare-pages";
  marker: {
    path: string;
    changed: boolean;
  };
  pages: {
    project: string;
    url: string | null;
    productionBranch: string;
    rootDirectory: string;
    buildCommand: string;
    outputDirectory: string;
    deploymentId: string;
    deploymentUrl: string | null;
    reusedDeployment: boolean;
  };
  customDomain: {
    name: string;
    status: CloudflarePagesDomain["status"];
  } | null;
  dns: {
    managedByAppFactory: false;
    type: "CNAME";
    name: string;
    target: string | null;
  } | null;
}

export class BrownfieldPagesProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requiredPermissions: string[] = []
  ) {
    super(message);
  }
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
    throw new Error(
      `GitHub API ${response.status} on ${path}: ${(await response.text()).slice(0, 500)}`
    );
  }

  return await response.json() as T;
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function repositoryByFullName(
  token: string,
  fullName: string
): Promise<GitHubRepository> {
  const [owner, repo, ...extra] = fullName.split("/");
  if (!owner || !repo || extra.length > 0) {
    throw new BrownfieldPagesProvisioningError(
      "INVALID_REPOSITORY",
      "Repository must use owner/name form."
    );
  }

  return githubRequest<GitHubRepository>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  );
}

async function readMarker(
  token: string,
  repository: GitHubRepository
): Promise<{ marker: PagesInfrastructureMarker; sha: string } | null> {
  const [owner, repo] = repository.full_name.split("/");
  const path =
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${MARKER_PATH}`;
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "Trigenys-AppFactory"
    }
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status} on ${path}: ${(await response.text()).slice(0, 500)}`
    );
  }

  const file = await response.json() as {
    sha: string;
    content: string;
    encoding: string;
  };
  if (file.encoding !== "base64") {
    throw new Error(`Unsupported GitHub content encoding for ${MARKER_PATH}.`);
  }

  let marker: PagesInfrastructureMarker;
  try {
    marker = JSON.parse(decodeBase64(file.content)) as PagesInfrastructureMarker;
  } catch {
    throw new BrownfieldPagesProvisioningError(
      "INFRASTRUCTURE_MARKER_INVALID",
      `${MARKER_PATH} is not valid JSON.`
    );
  }

  return { marker, sha: file.sha };
}

function markerOwnershipMatches(
  marker: PagesInfrastructureMarker,
  repository: string,
  projectName: string
): boolean {
  return (
    marker.schemaVersion === SCHEMA_VERSION &&
    marker.provider === "cloudflare-pages" &&
    marker.repository === repository &&
    marker.projectName === projectName
  );
}

function validateProjectName(repository: GitHubRepository, value?: string): string {
  const projectName = (value || repository.name).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectName)) {
    throw new BrownfieldPagesProvisioningError(
      "PAGES_PROJECT_NAME_INVALID",
      "Pages project name must start with a lowercase letter or digit and contain only lowercase letters, digits and hyphens."
    );
  }

  const repoName = repository.name.toLowerCase();
  if (projectName !== repoName && !projectName.startsWith(`${repoName}-`)) {
    throw new BrownfieldPagesProvisioningError(
      "PAGES_PROJECT_NAME_FORBIDDEN",
      `Brownfield Pages project names must be ${repoName} or begin with ${repoName}-.`
    );
  }

  return projectName;
}

function validatePath(value: string, field: string, fallback: string): string {
  const normalized = (value || fallback).trim();
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized.includes("\0") ||
    normalized.includes("\\") ||
    normalized.split("/").includes("..")
  ) {
    throw new BrownfieldPagesProvisioningError(
      "PAGES_PATH_INVALID",
      `${field} must be a safe repository-relative path without traversal.`
    );
  }
  return normalized;
}

function validateBuildCommand(value?: string): string {
  const command = (value || "").trim();
  if (!command || command.length > 1000 || /[\r\n\0]/.test(command)) {
    throw new BrownfieldPagesProvisioningError(
      "PAGES_BUILD_COMMAND_INVALID",
      "buildCommand must be a single non-empty shell command of at most 1000 characters."
    );
  }
  return command;
}

function validateBranch(repository: GitHubRepository, value?: string): string {
  const branch = (value || repository.default_branch || "main").trim();
  const forbidden = ["~", "^", ":", "?", "*", "[", "\\"];
  const invalidSegment = branch
    .split("/")
    .some((segment) => !segment || segment === "." || segment === ".." || segment.endsWith(".lock"));

  if (
    !branch ||
    branch.length > 240 ||
    /[\r\n\0]/.test(branch) ||
    branch.startsWith("-") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    invalidSegment ||
    forbidden.some((character) => branch.includes(character))
  ) {
    throw new BrownfieldPagesProvisioningError(
      "PAGES_BRANCH_INVALID",
      "productionBranch is not a safe Git branch name."
    );
  }
  return branch;
}

function validateCustomDomain(value?: string): string | undefined {
  if (!value) return undefined;
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    domain.length > 253 ||
    !domain.includes(".") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
    domain.split(".").some(
      (label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-")
    )
  ) {
    throw new BrownfieldPagesProvisioningError(
      "PAGES_CUSTOM_DOMAIN_INVALID",
      "customDomain must be a valid fully-qualified hostname."
    );
  }
  return domain;
}

async function writeMarker(
  token: string,
  repository: GitHubRepository,
  marker: PagesInfrastructureMarker,
  current: { marker: PagesInfrastructureMarker; sha: string } | null
): Promise<boolean> {
  const content = `${JSON.stringify(marker, null, 2)}\n`;
  if (current && `${JSON.stringify(current.marker, null, 2)}\n` === content) {
    return false;
  }

  const [owner, repo] = repository.full_name.split("/");
  const result = await githubRequest<GitHubContentCommit>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${MARKER_PATH}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: current
          ? "chore(appfactory): reconcile Pages infrastructure"
          : "chore(appfactory): claim Pages infrastructure",
        content: encodeBase64(content),
        branch: repository.default_branch || "main",
        ...(current ? { sha: current.sha } : {})
      })
    }
  );

  return Boolean(result.commit.sha);
}

function mapCloudflareError(error: unknown, operation: string): never {
  if (error instanceof CloudflarePagesApiError) {
    if (error.status === 401 || error.status === 403) {
      throw new BrownfieldPagesProvisioningError(
        "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED",
        `Cloudflare denied ${operation} (HTTP ${error.status}; ${error.detail.slice(0, 200)}).`,
        ["Cloudflare Pages Write"]
      );
    }

    if (error.status === 400 || error.status === 409) {
      throw new BrownfieldPagesProvisioningError(
        "CLOUDFLARE_PAGES_CONFLICT",
        `Cloudflare rejected ${operation} (HTTP ${error.status}; ${error.detail.slice(0, 200)}).`
      );
    }
  }
  throw error;
}

export async function provisionBrownfieldPages(
  token: string,
  env: Env,
  oidcRepository: string,
  request: BrownfieldPagesRequest
): Promise<BrownfieldPagesResult> {
  if (request.repository !== oidcRepository) {
    throw new BrownfieldPagesProvisioningError(
      "REPOSITORY_MISMATCH",
      "OIDC repository does not match the requested Pages repository."
    );
  }

  const repository = await repositoryByFullName(token, oidcRepository);
  const projectName = validateProjectName(repository, request.projectName);
  const productionBranch = validateBranch(repository, request.productionBranch);
  const rootDirectory = validatePath(request.rootDirectory || "/", "rootDirectory", "/");
  const outputDirectory = validatePath(
    request.outputDirectory || "dist",
    "outputDirectory",
    "dist"
  );
  const buildCommand = validateBuildCommand(request.buildCommand);
  const customDomain = validateCustomDomain(request.customDomain);

  const currentMarker = await readMarker(token, repository);
  if (
    currentMarker &&
    !markerOwnershipMatches(currentMarker.marker, repository.full_name, projectName)
  ) {
    throw new BrownfieldPagesProvisioningError(
      "INFRASTRUCTURE_MARKER_MISMATCH",
      `${MARKER_PATH} exists but does not claim Cloudflare Pages project ${projectName} for ${repository.full_name}.`
    );
  }

  let project;
  try {
    project = await ensurePagesProject(env, repository, {
      projectName,
      productionBranch,
      buildCommand,
      destinationDir: outputDirectory,
      rootDir: rootDirectory,
      previewDeploymentSetting: "all"
    });
  } catch (error) {
    mapCloudflareError(error, "provision or reconcile the Pages project");
  }

  let domain: CloudflarePagesDomain | null = null;
  if (customDomain) {
    try {
      domain = await ensurePagesCustomDomain(env, project, customDomain);
    } catch (error) {
      mapCloudflareError(error, "associate the Pages custom domain");
    }
  }

  const marker: PagesInfrastructureMarker = {
    schemaVersion: SCHEMA_VERSION,
    provider: "cloudflare-pages",
    repository: repository.full_name,
    projectName,
    productionBranch,
    rootDirectory,
    buildCommand,
    outputDirectory,
    ...(customDomain ? { customDomain } : {})
  };

  const markerChanged = await writeMarker(token, repository, marker, currentMarker);
  const headSha = await getRepositoryHeadSha(token, repository);
  const reusable = await findReusablePagesDeployment(env, project, headSha, true);
  let deployment = reusable;

  if (!deployment) {
    try {
      deployment = await triggerPagesDeployment(env, project, productionBranch);
    } catch (error) {
      mapCloudflareError(error, "trigger the Pages deployment");
    }
  }

  const pagesTarget = project.subdomain || null;

  return {
    repository: repository.full_name,
    provider: "cloudflare-pages",
    marker: {
      path: MARKER_PATH,
      changed: markerChanged
    },
    pages: {
      project: project.name,
      url: pagesProjectUrl(project),
      productionBranch,
      rootDirectory,
      buildCommand,
      outputDirectory,
      deploymentId: deployment.id,
      deploymentUrl: deployment.url || null,
      reusedDeployment: Boolean(reusable)
    },
    customDomain: domain
      ? {
          name: domain.name,
          status: domain.status
        }
      : null,
    dns: customDomain
      ? {
          managedByAppFactory: false,
          type: "CNAME",
          name: customDomain,
          target: pagesTarget
        }
      : null
  };
}
