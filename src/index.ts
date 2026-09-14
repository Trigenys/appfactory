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
    appId: Boolean(env.GITHUB_APP_ID),
    installationId: Boolean(env.GITHUB_INSTALLATION_ID),
    privateKey: Boolean(env.GITHUB_PRIVATE_KEY || env.GITHUB_PRIVATE_KEY_PKCS8)
  };
}

function assertRuntimeConfig(env: Env): void {
  const config = runtimeConfig(env);
  const missing: string[] = [];

  if (!config.appId) missing.push("GITHUB_APP_ID");
  if (!config.installationId) missing.push("GITHUB_INSTALLATION_ID");
  if (!config.privateKey) missing.push("GITHUB_PRIVATE_KEY");

  if (missing.length > 0) {
    throw new Error(`Missing Worker runtime configuration: ${missing.join(", ")}.`);
  }
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
    const manifestCommitSha = await replaceManifest(token, repository, manifest);

    return json(
      {
        status: "CREATED",
        repository: repository.full_name,
        repositoryUrl: repository.html_url,
        defaultBranch: repository.default_branch,
        manifestCommitSha
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
        status: config.appId && config.installationId && config.privateKey ? "ok" : "degraded",
        service: "appfactory-api",
        milestone: "M1-repository-factory",
        runtimeConfig: config
      });
    }

    if (request.method === "POST" && url.pathname === "/projects") {
      return createProject(request, env);
    }

    return json({ error: "NOT_FOUND" }, 404);
  }
};
