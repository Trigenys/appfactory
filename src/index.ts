import { ensurePagesProject, pagesProjectUrl, triggerPagesDeployment } from "./cloudflare";
import { createRepositoryFromTemplate, getInstallationToken, replaceManifest } from "./github";
import { buildLandingManifest } from "./manifest";
import type { Env } from "./types";
import { validateCreateProject } from "./validation";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function runtimeConfig(env: Env) {
  return {
    github: {
      appId: Boolean(env.GITHUB_APP_ID),
      installationId: Boolean(env.GITHUB_INSTALLATION_ID),
      privateKey: Boolean(env.GITHUB_PRIVATE_KEY || env.GITHUB_PRIVATE_KEY_PKCS8)
    },
    cloudflare: {
      accountId: Boolean(env.CLOUDFLARE_ACCOUNT_ID),
      apiToken: Boolean(env.CLOUDFLARE_API_TOKEN)
    }
  };
}

function assertRuntimeConfig(env: Env): void {
  const config = runtimeConfig(env);
  const missing: string[] = [];

  if (!config.github.appId) missing.push("GITHUB_APP_ID");
  if (!config.github.installationId) missing.push("GITHUB_INSTALLATION_ID");
  if (!config.github.privateKey) missing.push("GITHUB_PRIVATE_KEY");
  if (!config.cloudflare.accountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!config.cloudflare.apiToken) missing.push("CLOUDFLARE_API_TOKEN");

  if (missing.length > 0) {
    throw new Error(`Missing Worker runtime configuration: ${missing.join(", ")}.`);
  }
}

function runtimeReady(env: Env): boolean {
  const config = runtimeConfig(env);
  return (
    config.github.appId &&
    config.github.installationId &&
    config.github.privateKey &&
    config.cloudflare.accountId &&
    config.cloudflare.apiToken
  );
}

async function createProject(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "INVALID_JSON", message: "Request body must contain valid JSON." }, 400);
  }

  let input;
  try {
    input = validateCreateProject(payload);
  } catch (error) {
    return json(
      {
        error: "INVALID_PROJECT",
        message: error instanceof Error ? error.message : "Invalid project request."
      },
      400
    );
  }

  try {
    assertRuntimeConfig(env);
    const token = await getInstallationToken(env);
    const repository = await createRepositoryFromTemplate(token, env, input);
    const manifest = buildLandingManifest(input);
    const manifestCommitSha = await replaceManifest(token, env, repository, manifest);
    const pagesProject = await ensurePagesProject(env, repository);
    const productionBranch = repository.default_branch || pagesProject.production_branch || "main";
    const deployment = await triggerPagesDeployment(env, pagesProject, productionBranch);

    return json(
      {
        status: "PROVISIONED",
        repository: repository.full_name,
        repositoryUrl: repository.html_url,
        defaultBranch: repository.default_branch,
        manifestCommitSha,
        manifestVersion: 2,
        deployment: {
          provider: "cloudflare-pages",
          project: pagesProject.name,
          siteUrl: pagesProjectUrl(pagesProject),
          productionBranch,
          deploymentId: deployment.id,
          deploymentUrl: deployment.url || null,
          stage: deployment.latest_stage?.name || "queued",
          state: deployment.latest_stage?.status || "active",
          skipped: Boolean(deployment.is_skipped)
        }
      },
      201
    );
  } catch (error) {
    console.error("Project creation failed", error);
    const message =
      env.ENVIRONMENT === "production"
        ? "Project creation failed. Check AppFactory logs for details."
        : error instanceof Error
          ? error.message
          : "Project creation failed.";

    return json({ error: "PROJECT_CREATION_FAILED", message }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const config = runtimeConfig(env);
      return json({
        status: runtimeReady(env) ? "ok" : "degraded",
        service: "appfactory-api",
        milestone: "M3-modular-renderer",
        manifestVersion: 2,
        runtimeConfig: config
      });
    }

    if (request.method === "POST" && url.pathname === "/projects") {
      return createProject(request, env);
    }

    return json({ error: "NOT_FOUND" }, 404);
  }
};
