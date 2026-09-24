import { ensurePagesProject, pagesProjectUrl, triggerPagesDeployment } from "./cloudflare";
import { findReusablePagesDeployment } from "./deployment-idempotency";
import {
  exportWithOpenPage,
  generateWithOpenPage,
  openPageConfigured
} from "./engines/openpage";
import { createRepositoryFromTemplate, getInstallationToken, replaceManifest } from "./github";
import {
  getRepositoryHeadSha,
  projectContentHash,
  projectRequestHash,
  readProjectState,
  saveProjectState
} from "./idempotency";
import { buildLandingManifest } from "./manifest";
import { provisionServiceRepository } from "./service-provisioning";
import { provisionServiceCloudflare, ServiceCloudflareProvisioningError } from "./service-cloudflare";
import { commitOpenPageSite, createOpenPageRepository } from "./openpage-repository";
import type { Env, GitHubRepository } from "./types";
import { validateCreateProject } from "./validation";

type ValidatedProjectInput = ReturnType<typeof validateCreateProject>;
type ProjectInputResult =
  | { input: ValidatedProjectInput }
  | { response: Response };

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
    },
    engines: {
      native: { configured: true },
      openpage: {
        configured: openPageConfigured(env),
        generatorUrl: Boolean(env.OPENPAGE_GENERATOR_URL),
        exportUrl: Boolean(env.OPENPAGE_EXPORT_URL),
        apiToken: Boolean(env.OPENPAGE_API_TOKEN)
      }
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

async function readProjectInput(request: Request): Promise<ProjectInputResult> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return {
      response: json({ error: "INVALID_JSON", message: "Request body must contain valid JSON." }, 400)
    };
  }

  try {
    return { input: validateCreateProject(payload) };
  } catch (error) {
    return {
      response: json(
        {
          error: "INVALID_PROJECT",
          message: error instanceof Error ? error.message : "Invalid project request."
        },
        400
      )
    };
  }
}

async function provisionDeployment(
  env: Env,
  repository: GitHubRepository,
  commitSha: string
) {
  const pagesProject = await ensurePagesProject(env, repository);
  const productionBranch = repository.default_branch || pagesProject.production_branch || "main";
  const existing = await findReusablePagesDeployment(env, pagesProject, commitSha, true);
  const deployment = existing || await triggerPagesDeployment(env, pagesProject, productionBranch);

  return {
    provider: "cloudflare-pages" as const,
    project: pagesProject.name,
    siteUrl: pagesProjectUrl(pagesProject),
    productionBranch,
    deploymentId: deployment.id,
    deploymentUrl: deployment.url || null,
    stage: deployment.latest_stage?.name || "queued",
    state: deployment.latest_stage?.status || "active",
    skipped: Boolean(deployment.is_skipped),
    reused: Boolean(existing)
  };
}

async function createNativeProject(
  env: Env,
  token: string,
  input: ValidatedProjectInput
): Promise<Response> {
  const normalizedInput = { ...input, engine: "native" as const };
  const repository = await createRepositoryFromTemplate(token, env, normalizedInput);
  const requestHash = await projectRequestHash(normalizedInput);
  const previousState = await readProjectState(token, repository);

  if (previousState?.engine === "native" && previousState.requestHash === requestHash) {
    const siteCommitSha = await getRepositoryHeadSha(token, repository);
    const deployment = await provisionDeployment(env, repository, siteCommitSha);
    return json(
      {
        status: "PROVISIONED",
        generationEngine: "native",
        repository: repository.full_name,
        repositoryUrl: repository.html_url,
        defaultBranch: repository.default_branch,
        siteCommitSha,
        manifestVersion: 2,
        idempotency: {
          key: requestHash,
          replay: true,
          contentChanged: false
        },
        deployment
      },
      200
    );
  }

  const manifest = buildLandingManifest(normalizedInput);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const contentHash = await projectContentHash([manifestText]);

  let manifestCommitSha: string;
  let contentChanged = true;
  if (previousState?.engine === "native" && previousState.contentHash === contentHash) {
    manifestCommitSha = await getRepositoryHeadSha(token, repository);
    contentChanged = false;
  } else {
    manifestCommitSha = await replaceManifest(token, env, repository, manifest);
  }

  const checkpoint = await saveProjectState(token, env, repository, {
    schemaVersion: 1,
    engine: "native",
    requestHash,
    contentHash,
    complete: true
  });
  const siteCommitSha = checkpoint.commitSha;
  const deployment = await provisionDeployment(env, repository, siteCommitSha);

  return json(
    {
      status: "PROVISIONED",
      generationEngine: "native",
      repository: repository.full_name,
      repositoryUrl: repository.html_url,
      defaultBranch: repository.default_branch,
      manifestCommitSha,
      siteCommitSha,
      manifestVersion: 2,
      idempotency: {
        key: requestHash,
        replay: false,
        contentChanged,
        checkpointChanged: checkpoint.changed
      },
      deployment
    },
    201
  );
}

async function createOpenPageProject(
  env: Env,
  token: string,
  input: ValidatedProjectInput
): Promise<Response> {
  if (!openPageConfigured(env)) {
    throw new Error(
      "OpenPage is not fully configured. Set OPENPAGE_GENERATOR_URL, OPENPAGE_EXPORT_URL and the OPENPAGE_API_TOKEN Worker secret."
    );
  }

  const normalizedInput = { ...input, engine: "openpage" as const };
  const { repository, created } = await createOpenPageRepository(token, env, normalizedInput);
  const requestHash = await projectRequestHash(normalizedInput);
  const previousState = await readProjectState(token, repository);

  if (previousState?.engine === "openpage" && previousState.requestHash === requestHash) {
    const siteCommitSha = await getRepositoryHeadSha(token, repository);
    const deployment = await provisionDeployment(env, repository, siteCommitSha);
    return json(
      {
        status: "PROVISIONED",
        generationEngine: "openpage",
        engineRepository: "Trigenys/appfactory-openpage-engine",
        repository: repository.full_name,
        repositoryUrl: repository.html_url,
        defaultBranch: repository.default_branch,
        siteCommitSha,
        openPageConfigVersion: 1,
        idempotency: {
          key: requestHash,
          replay: true,
          contentChanged: false
        },
        deployment
      },
      200
    );
  }

  const generation = await generateWithOpenPage(env, normalizedInput);
  const html = await exportWithOpenPage(env, normalizedInput, generation.config);
  const configText = `${JSON.stringify(generation.config, null, 2)}\n`;
  const contentHash = await projectContentHash([configText, html]);

  let siteContentCommitSha: string;
  let contentChanged = true;
  if (previousState?.engine === "openpage" && previousState.contentHash === contentHash) {
    siteContentCommitSha = await getRepositoryHeadSha(token, repository);
    contentChanged = false;
  } else {
    siteContentCommitSha = await commitOpenPageSite(
      token,
      env,
      repository,
      created,
      normalizedInput,
      generation.config,
      html
    );
  }

  const checkpoint = await saveProjectState(token, env, repository, {
    schemaVersion: 1,
    engine: "openpage",
    requestHash,
    contentHash,
    complete: true
  });
  const siteCommitSha = checkpoint.commitSha;
  const deployment = await provisionDeployment(env, repository, siteCommitSha);

  return json(
    {
      status: "PROVISIONED",
      generationEngine: "openpage",
      engineRepository: "Trigenys/appfactory-openpage-engine",
      repository: repository.full_name,
      repositoryUrl: repository.html_url,
      defaultBranch: repository.default_branch,
      siteContentCommitSha,
      siteCommitSha,
      openPageConfigVersion: 1,
      quality: generation.quality,
      idempotency: {
        key: requestHash,
        replay: false,
        contentChanged,
        checkpointChanged: checkpoint.changed
      },
      deployment
    },
    201
  );
}

async function createProject(request: Request, env: Env): Promise<Response> {
  const parsed = await readProjectInput(request);
  if ("response" in parsed) return parsed.response;
  const { input } = parsed;

  try {
    const token = await getInstallationToken(env);

    if (input.projectType === "mobile") {
      if (input.platform !== "android" || input.preset !== "android-compose") {
        throw new Error("Mobile platform and preset are required after validation.");
      }
      const provisioned = await provisionMobileRepository(token, env, {
        ...input,
        projectType: "mobile",
        platform: input.platform,
        preset: input.preset
      });
      return json(
        {
          status: "PROVISIONED",
          projectType: "mobile",
          platform: input.platform,
          preset: input.preset,
          repository: provisioned.repository.full_name,
          repositoryUrl: provisioned.repository.html_url,
          defaultBranch: provisioned.repository.default_branch,
          commitSha: provisioned.commitSha,
          idempotency: { repositoryReplay: provisioned.replay },
          quality: {
            architectureReference: "android/nowinandroid",
            visualRegression: "Roborazzi",
            composeCatalog: true
          },
          nextSteps: {
            projectAutomation: "Reuse an existing project-capable PROJECT_TOKEN if available, then run Project automation once with an empty issue number.",
            productBootstrap: "Add product-specific features behind the generated design-system and feature boundaries."
          }
        },
        provisioned.replay ? 200 : 201
      );
    }

    if (input.projectType === "service") {
      if (!input.preset) throw new Error("Service preset is required after validation.");
      const provisioned = await provisionServiceRepository(token, env, {
        ...input,
        projectType: "service",
        preset: input.preset
      });
      const infrastructure = await provisionServiceCloudflare(token, env, provisioned.repository);
      return json(
        {
          status: "PROVISIONED",
          projectType: "service",
          preset: input.preset,
          repository: provisioned.repository.full_name,
          repositoryUrl: provisioned.repository.html_url,
          defaultBranch: provisioned.repository.default_branch,
          commitSha: infrastructure.configCommitSha,
          idempotency: {
            repositoryReplay: provisioned.replay,
            infrastructureReplay: infrastructure.replay
          },
          infrastructure: {
            provider: "cloudflare-workers",
            database: infrastructure.database,
            worker: infrastructure.worker,
            builds: infrastructure.builds
          },
          nextSteps: {
            projectAutomation: "Reuse an existing project-capable PROJECT_TOKEN if available, then run Project automation once with an empty issue number.",
            runtimeSecrets: [
              "ADMIN_API_KEY",
              "SERVICE_API_KEY",
              "LICENSE_PRIVATE_KEY_PKCS8_B64",
              "LICENSE_PUBLIC_KEY_SPKI_B64"
            ]
          }
        },
        provisioned.replay && infrastructure.replay ? 200 : 201
      );
    }

    assertRuntimeConfig(env);
    return input.engine === "openpage"
      ? await createOpenPageProject(env, token, input)
      : await createNativeProject(env, token, input);
  } catch (error) {
    console.error("Project creation failed", error);
    if (error instanceof ServiceCloudflareProvisioningError) {
      return json(
        {
          error: error.code,
          message: error.message,
          requiredPermissions: error.requiredPermissions
        },
        error.code === "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED" ? 502 : 500
      );
    }
    const message =
      env.ENVIRONMENT === "production"
        ? "Project creation failed. Check AppFactory logs for details."
        : error instanceof Error
          ? error.message
          : "Project creation failed.";

    return json({ error: "PROJECT_CREATION_FAILED", message }, 500);
  }
}

async function generateOpenPage(request: Request, env: Env): Promise<Response> {
  const parsed = await readProjectInput(request);
  if ("response" in parsed) return parsed.response;

  try {
    const result = await generateWithOpenPage(env, {
      ...parsed.input,
      engine: "openpage"
    });

    return json(
      {
        status: "GENERATED",
        engine: result.engine,
        upstream: result.upstream,
        config: result.config,
        quality: result.quality
      },
      200
    );
  } catch (error) {
    console.error("OpenPage generation failed", error);
    const message = error instanceof Error ? error.message : "OpenPage generation failed.";
    return json({ error: "OPENPAGE_GENERATION_FAILED", message }, 502);
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
        milestone: "M3-openpage-end-to-end",
        manifestVersion: 2,
        idempotencyVersion: 1,
        serviceBlueprintVersion: 2,
        runtimeConfig: config
      });
    }

    if (request.method === "POST" && url.pathname === "/projects") {
      return createProject(request, env);
    }

    if (request.method === "POST" && url.pathname === "/engines/openpage/generate") {
      return generateOpenPage(request, env);
    }

    return json({ error: "NOT_FOUND" }, 404);
  }
};
