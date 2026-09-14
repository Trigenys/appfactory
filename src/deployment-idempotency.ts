import type {
  CloudflareApiResponse,
  CloudflarePagesDeployment,
  CloudflarePagesProject,
  Env
} from "./types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

function assertConfig(env: Env): asserts env is Env & {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
} {
  if (!env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID Worker runtime variable.");
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("Missing CLOUDFLARE_API_TOKEN Worker secret.");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listDeployments(
  env: Env,
  project: CloudflarePagesProject
): Promise<CloudflarePagesDeployment[]> {
  assertConfig(env);
  const path = `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(project.name)}/deployments?per_page=25`;
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`Cloudflare returned an empty deployment-list response for ${project.name}.`);
  }

  let payload: CloudflareApiResponse<CloudflarePagesDeployment[]>;
  try {
    payload = JSON.parse(text) as CloudflareApiResponse<CloudflarePagesDeployment[]>;
  } catch {
    throw new Error(`Cloudflare returned malformed deployment-list JSON for ${project.name}.`);
  }

  if (!response.ok || !payload.success || !Array.isArray(payload.result)) {
    const detail = payload.errors?.map((error) => `${error.code}: ${error.message}`).join("; ") || `HTTP ${response.status}`;
    throw new Error(`Unable to inspect Cloudflare Pages deployments for ${project.name}: ${detail}`);
  }

  return payload.result;
}

function sameCommit(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function deploymentMatchesCommit(
  deployment: CloudflarePagesDeployment,
  commitSha: string
): boolean {
  const deployedCommit = deployment.deployment_trigger?.metadata?.commit_hash;
  if (!deployedCommit || !sameCommit(deployedCommit, commitSha)) return false;
  if (deployment.environment && deployment.environment !== "production") return false;

  const status = deployment.latest_stage?.status;
  return status !== "failure" && status !== "canceled";
}

export async function findReusablePagesDeployment(
  env: Env,
  project: CloudflarePagesProject,
  commitSha: string,
  waitForGitPush = true
): Promise<CloudflarePagesDeployment | null> {
  const attempts = waitForGitPush ? 4 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const deployments = await listDeployments(env, project);
    const match = deployments.find((deployment) => deploymentMatchesCommit(deployment, commitSha));
    if (match) return match;
    if (attempt < attempts - 1) await sleep(1000);
  }

  return null;
}
