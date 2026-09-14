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
  if (!text.trim()) return [];

  let payload: CloudflareApiResponse<CloudflarePagesDeployment[]>;
  try {
    payload = JSON.parse(text) as CloudflareApiResponse<CloudflarePagesDeployment[]>;
  } catch {
    return [];
  }

  if (!response.ok || !payload.success || !Array.isArray(payload.result)) return [];
  return payload.result;
}

function deploymentMatchesCommit(
  deployment: CloudflarePagesDeployment,
  commitSha: string
): boolean {
  const deployedCommit = deployment.deployment_trigger?.metadata?.commit_hash;
  if (!deployedCommit || deployedCommit !== commitSha) return false;
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
  for (let attempt = 0; attempt < (waitForGitPush ? 2 : 1); attempt += 1) {
    const deployments = await listDeployments(env, project);
    const match = deployments.find((deployment) => deploymentMatchesCommit(deployment, commitSha));
    if (match) return match;
    if (attempt === 0 && waitForGitPush) await sleep(1200);
  }
  return null;
}
