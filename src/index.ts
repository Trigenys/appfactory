import { AuthenticationError, authenticateInfrastructureMutation, authenticateMutation, type GitHubOidcClaims } from "./auth";
import { ensurePagesProject, pagesProjectUrl, triggerPagesDeployment } from "./cloudflare";
import { findReusablePagesDeployment } from "./deployment-idempotency";
import {
  exportWithOpenPage,
  generateWithOpenPage,
  openPageConfigured
} from "./engines/openpage";
import { createRepositoryFromTemplate, getInstallationToken, provisionOrganizationProfileRepository, replaceManifest } from "./github";
import {
  getRepositoryHeadSha,
  projectContentHash,
  projectRequestHash,
  readProjectState,
  saveProjectState
} from "./idempotency";
import { buildLandingManifest } from "./manifest";
import { provisionDesktopRepository } from "./desktop-provisioning";
import { provisionWebAppRepository } from "./webapp-provisioning";
import { provisionMobileRepository } from "./mobile-provisioning";
import { provisionServiceRepository } from "./service-provisioning";
import { provisionServiceCloudflare, ServiceCloudflareProvisioningError } from "./service-cloudflare";
import { commitOpenPageSite, createOpenPageRepository } from "./openpage-repository";
import type { Env, GitHubRepository } from "./types";
import { validateCreateProject } from "./validation";
import { buildOrganizationProfileReadme } from "./profile";
import {
  BrownfieldWorkerProvisioningError,
  provisionBrownfieldWorker,
  type BrownfieldWorkerRequest
} from "./brownfield-worker";
import {
  BrownfieldPagesProvisioningError,
  provisionBrownfieldPages,
  type BrownfieldPagesRequest
} from "./brownfield-pages";
import {
  PagesD1ProvisioningError,
  provisionPagesD1,
  type PagesD1Request
} from "./pages-d1";
import {
  HyperdriveProvisioningError,
  provisionHyperdrive,
  type HyperdriveProvisioningRequest
} from "./hyperdrive";

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
      apiToken: Boolean(env.CLOUDFLARE_API_TOKEN),
      buildsApiToken: Boolean(env.CLOUDFLARE_API_TOKEN),
      resourceApiToken: Boolean(env.CLOUDFLARE_PAGES_D1_TOKEN),
      resourceApiTokenFallback: !env.CLOUDFLARE_PAGES_D1_TOKEN && Boolean(env.CLOUDFLARE_API_TOKEN),
      hyperdriveDatabaseProfiles: Boolean(env.HYPERDRIVE_DATABASE_PROFILES)
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

    if (input.projectType === "profile") {
      const provisioned = await provisionOrganizationProfileRepository(
        token,
        env,
        input,
        buildOrganizationProfileReadme()
      );
      return json(
        {
          status: "PROVISIONED",
          projectType: "profile",
          repository: provisioned.repository.full_name,
          repositoryUrl: provisioned.repository.html_url,
          defaultBranch: provisioned.repository.default_branch,
          commitSha: provisioned.commitSha,
          idempotency: {
            repositoryReplay: provisioned.replay
          }
        },
        provisioned.replay ? 200 : 201
      );
    }

    if (input.projectType === "webapp") {
      if (input.preset !== "react-vite") {
        throw new Error("Webapp preset is required after validation.");
      }
      const provisioned = await provisionWebAppRepository(token, env, {
        ...input,
        projectType: "webapp",
        preset: input.preset
      });
      return json(
        {
          status: "PROVISIONED",
          projectType: "webapp",
          preset: input.preset,
          repository: provisioned.repository.full_name,
          repositoryUrl: provisioned.repository.html_url,
          defaultBranch: provisioned.repository.default_branch,
          commitSha: provisioned.commitSha,
          idempotency: {
            repositoryReplay: provisioned.replay
          },
          quality: {
            frontend: "React + TypeScript + Vite",
            node: "24",
            projectAutomation: "AppFactory OIDC broker"
          },
          nextSteps: {
            projectAutomation: "Project Automation is preconfigured through GitHub Actions OIDC and the AppFactory broker; no repository PROJECT_TOKEN is required.",
            productBootstrap: "Add domain features and choose runtime/deployment infrastructure according to the product workload."
          }
        },
        provisioned.replay ? 200 : 201
      );
    }

    if (input.projectType === "desktop") {
      if (input.platform !== "windows" || input.preset !== "tauri-react") {
        throw new Error("Desktop platform and preset are required after validation.");
      }
      const provisioned = await provisionDesktopRepository(token, env, {
        ...input,
        projectType: "desktop",
        platform: input.platform,
        preset: input.preset
      });
      return json(
        {
          status: "PROVISIONED",
          projectType: "desktop",
          platform: input.platform,
          preset: input.preset,
          repository: provisioned.repository.full_name,
          repositoryUrl: provisioned.repository.html_url,
          defaultBranch: provisioned.repository.default_branch,
          commitSha: provisioned.commitSha,
          idempotency: {
            repositoryReplay: provisioned.replay
          },
          quality: {
            shell: "Tauri 2",
            frontend: "React + TypeScript + Vite",
            nativeBoundary: "Rust",
            filesystemPolicy: "privileged access stays behind narrow Rust commands"
          },
          nextSteps: {
            projectAutomation: "Project Automation is preconfigured through GitHub Actions OIDC and the AppFactory broker; no repository PROJECT_TOKEN is required.",
            productBootstrap: "Implement product-specific scanner, registry and health-engine features behind the generated native boundary."
          }
        },
        provisioned.replay ? 200 : 201
      );
    }

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
          idempotency: {
            repositoryReplay: provisioned.replay,
            blueprintUpgrade: provisioned.upgraded
              ? {
                  from: provisioned.previousBlueprintVersion,
                  to: provisioned.blueprintVersion
                }
              : null
          },
          quality: {
            architectureReference: "android/nowinandroid",
            visualRegression: "Roborazzi",
            composePreviews: true
          },
          nextSteps: {
            projectAutomation: "Project Automation is preconfigured through GitHub Actions OIDC and the AppFactory broker; no repository PROJECT_TOKEN is required.",
            productBootstrap: "Add product-specific features behind the generated design-system and feature boundaries."
          }
        },
        provisioned.replay ? 200 : 201
      );
    }

    if (input.projectType === "service") {
      if (input.preset !== "entitlements" && input.preset !== "typescript-api") {
        throw new Error("Service preset is required after validation.");
      }
      const provisioned = await provisionServiceRepository(token, env, {
        ...input,
        projectType: "service",
        preset: input.preset
      });

      if (input.preset === "typescript-api") {
        return json(
          {
            status: "PROVISIONED",
            projectType: "service",
            preset: input.preset,
            repository: provisioned.repository.full_name,
            repositoryUrl: provisioned.repository.html_url,
            defaultBranch: provisioned.repository.default_branch,
            commitSha: provisioned.commitSha,
            idempotency: {
              repositoryReplay: provisioned.replay,
              blueprintUpgrade: provisioned.upgraded
                ? {
                    from: provisioned.previousBlueprintVersion,
                    to: provisioned.blueprintVersion
                  }
                : null
            },
            infrastructure: {
              provider: null,
              managedByAppFactory: false
            },
            quality: {
              runtime: "Node.js 24",
              language: "TypeScript",
              projectAutomation: "AppFactory OIDC broker",
              hosting: "consumer-selected"
            },
            nextSteps: {
              projectAutomation: "Project Automation is preconfigured through GitHub Actions OIDC and the AppFactory broker; no repository PROJECT_TOKEN is required.",
              infrastructure: "Choose deployment, persistence and secret storage according to the service workload; the generic preset intentionally makes no cloud or database assumption."
            }
          },
          provisioned.replay ? 200 : 201
        );
      }

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
            infrastructureReplay: infrastructure.replay,
            blueprintUpgrade: provisioned.upgraded
              ? {
                  from: provisioned.previousBlueprintVersion,
                  to: provisioned.blueprintVersion
                }
              : null
          },
          infrastructure: {
            provider: "cloudflare-workers",
            database: infrastructure.database,
            worker: infrastructure.worker,
            builds: infrastructure.builds
          },
          nextSteps: {
            projectAutomation: "Project Automation is preconfigured through GitHub Actions OIDC and the AppFactory broker; no repository PROJECT_TOKEN is required.",
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

async function provisionExistingPages(
  request: Request,
  env: Env,
  claims: GitHubOidcClaims
): Promise<Response> {
  if (!claims.repository) {
    return json(
      {
        error: "OIDC_REPOSITORY_REQUIRED",
        message: "GitHub OIDC token does not identify a repository."
      },
      403
    );
  }

  let payload: BrownfieldPagesRequest;
  try {
    payload = await request.json() as BrownfieldPagesRequest;
  } catch {
    return json(
      {
        error: "INVALID_JSON",
        message: "Request body must contain valid JSON."
      },
      400
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.repository !== "string" ||
    typeof payload.buildCommand !== "string"
  ) {
    return json(
      {
        error: "INVALID_INFRASTRUCTURE_REQUEST",
        message: "Pages request must include repository and buildCommand."
      },
      400
    );
  }

  try {
    const token = await getInstallationToken(env);
    const result = await provisionBrownfieldPages(
      token,
      env,
      claims.repository,
      payload
    );
    return json(
      {
        status: "PROVISIONED",
        infrastructure: result
      },
      200
    );
  } catch (error) {
    console.error(
      "Brownfield Pages provisioning failed",
      error instanceof Error ? error.message : "unknown error"
    );

    if (error instanceof BrownfieldPagesProvisioningError) {
      const conflictCodes = new Set([
        "REPOSITORY_MISMATCH",
        "PAGES_PROJECT_NAME_FORBIDDEN",
        "INFRASTRUCTURE_MARKER_MISMATCH",
        "CLOUDFLARE_PAGES_CONFLICT"
      ]);

      return json(
        {
          error: error.code,
          message: error.message,
          requiredPermissions: error.requiredPermissions
        },
        error.code === "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED"
          ? 502
          : conflictCodes.has(error.code)
            ? 409
            : 400
      );
    }

    return json(
      {
        error: "PAGES_PROVISIONING_FAILED",
        message:
          env.ENVIRONMENT === "production"
            ? "Pages provisioning failed. Check AppFactory logs for details."
            : error instanceof Error
              ? error.message
              : "Pages provisioning failed."
      },
      500
    );
  }
}

async function provisionExistingPagesD1(
  request: Request,
  env: Env,
  claims: GitHubOidcClaims
): Promise<Response> {
  if (!claims.repository) {
    return json(
      {
        error: "OIDC_REPOSITORY_REQUIRED",
        message: "GitHub OIDC token does not identify a repository."
      },
      403
    );
  }

  let payload: PagesD1Request;
  try {
    payload = await request.json() as PagesD1Request;
  } catch {
    return json(
      {
        error: "INVALID_JSON",
        message: "Request body must contain valid JSON."
      },
      400
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.repository !== "string" ||
    typeof payload.recipe !== "string"
  ) {
    return json(
      {
        error: "INVALID_INFRASTRUCTURE_REQUEST",
        message: "Pages D1 request must include repository and recipe."
      },
      400
    );
  }

  try {
    const result = await provisionPagesD1(
      env,
      claims.repository,
      payload
    );
    return json(
      {
        status: "PROVISIONED",
        infrastructure: result
      },
      200
    );
  } catch (error) {
    console.error(
      "Pages D1 provisioning failed",
      error instanceof Error ? error.message : "unknown error"
    );

    if (error instanceof PagesD1ProvisioningError) {
      const conflictCodes = new Set([
        "REPOSITORY_MISMATCH",
        "UNSUPPORTED_PAGES_D1_RECIPE"
      ]);

      return json(
        {
          error: error.code,
          message: error.message,
          requiredPermissions: error.requiredPermissions
        },
        (error.code === "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED" ||
          error.code === "CLOUDFLARE_ACCESS_DENIED")
          ? 502
          : conflictCodes.has(error.code)
            ? 409
            : 400
      );
    }

    return json(
      {
        error: "PAGES_D1_PROVISIONING_FAILED",
        message:
          env.ENVIRONMENT === "production"
            ? "Pages D1 provisioning failed. Check AppFactory logs for details."
            : error instanceof Error
              ? error.message
              : "Pages D1 provisioning failed."
      },
      500
    );
  }
}

async function provisionExistingHyperdrive(
  request: Request,
  env: Env,
  claims: GitHubOidcClaims
): Promise<Response> {
  if (!claims.repository) {
    return json(
      {
        error: "OIDC_REPOSITORY_REQUIRED",
        message: "GitHub OIDC token does not identify a repository."
      },
      403
    );
  }

  let payload: HyperdriveProvisioningRequest;
  try {
    payload = await request.json() as HyperdriveProvisioningRequest;
  } catch {
    return json(
      {
        error: "INVALID_JSON",
        message: "Request body must contain valid JSON."
      },
      400
    );
  }

  if (!payload || typeof payload !== "object" || typeof payload.repository !== "string") {
    return json(
      {
        error: "INVALID_INFRASTRUCTURE_REQUEST",
        message: "Hyperdrive request must identify its repository."
      },
      400
    );
  }

  try {
    const token = await getInstallationToken(env);
    const result = await provisionHyperdrive(
      token,
      env,
      claims.repository,
      payload
    );
    return json(
      {
        status: "PROVISIONED",
        infrastructure: result
      },
      200
    );
  } catch (error) {
    console.error(
      "Hyperdrive provisioning failed",
      error instanceof Error ? error.message : "unknown error"
    );

    if (error instanceof HyperdriveProvisioningError) {
      const conflictCodes = new Set([
        "REPOSITORY_MISMATCH",
        "WORKER_NAME_FORBIDDEN",
        "DATABASE_PROFILE_FORBIDDEN",
        "HYPERDRIVE_NAME_FORBIDDEN",
        "HYPERDRIVE_BINDING_FORBIDDEN",
        "BROWNFIELD_WORKER_UNCLAIMED",
        "INFRASTRUCTURE_MARKER_MISMATCH",
        "HYPERDRIVE_MARKER_MISMATCH",
        "BROWNFIELD_HYPERDRIVE_UNCLAIMED",
        "HYPERDRIVE_NAME_AMBIGUOUS",
        "HYPERDRIVE_BINDING_CONFLICT"
      ]);

      return json(
        {
          error: error.code,
          message: error.message,
          requiredPermissions: error.requiredPermissions
        },
        error.code === "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED"
          ? 502
          : conflictCodes.has(error.code)
            ? 409
            : 400
      );
    }

    return json(
      {
        error: "HYPERDRIVE_PROVISIONING_FAILED",
        message:
          env.ENVIRONMENT === "production"
            ? "Hyperdrive provisioning failed. Check AppFactory logs for details."
            : error instanceof Error
              ? error.message
              : "Hyperdrive provisioning failed."
      },
      500
    );
  }
}

async function provisionExistingWorker(
  request: Request,
  env: Env,
  claims: GitHubOidcClaims
): Promise<Response> {
  if (!claims.repository) {
    return json(
      {
        error: "OIDC_REPOSITORY_REQUIRED",
        message: "GitHub OIDC token does not identify a repository."
      },
      403
    );
  }

  let payload: BrownfieldWorkerRequest;
  try {
    payload = await request.json() as BrownfieldWorkerRequest;
  } catch {
    return json(
      {
        error: "INVALID_JSON",
        message: "Request body must contain valid JSON."
      },
      400
    );
  }

  if (!payload || typeof payload !== "object" || typeof payload.repository !== "string") {
    return json(
      {
        error: "INVALID_INFRASTRUCTURE_REQUEST",
        message: "Infrastructure request must identify its repository."
      },
      400
    );
  }

  try {
    const token = await getInstallationToken(env);
    const result = await provisionBrownfieldWorker(
      token,
      env,
      claims.repository,
      payload
    );
    return json(
      {
        status: "PROVISIONED",
        infrastructure: result
      },
      200
    );
  } catch (error) {
    console.error(
      "Brownfield Worker provisioning failed",
      error instanceof Error ? error.message : "unknown error"
    );

    if (error instanceof BrownfieldWorkerProvisioningError) {
      const conflictCodes = new Set([
        "REPOSITORY_MISMATCH",
        "WORKER_NAME_FORBIDDEN",
        "ROOT_DIRECTORY_FORBIDDEN",
        "BUILD_COMMAND_FORBIDDEN",
        "MIGRATION_RECIPE_FORBIDDEN",
        "MIGRATION_PROFILE_FORBIDDEN",
        "MIGRATION_DATABASE_ENV_FORBIDDEN",
        "SECRET_NAME_FORBIDDEN",
        "INFRASTRUCTURE_MARKER_MISMATCH",
        "BROWNFIELD_WORKER_UNCLAIMED"
      ]);
      return json(
        {
          error: error.code,
          message: error.message,
          requiredPermissions: error.requiredPermissions,
          ...(error.evidence ? { evidence: error.evidence } : {})
        },
        (error.code === "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED" ||
          error.code === "CLOUDFLARE_WORKERS_BUILD_FAILED" ||
          error.code === "CLOUDFLARE_WORKERS_BUILD_TIMEOUT")
          ? 502
          : (error.code === "HYPERDRIVE_BINDING_NOT_READY" ||
            error.code === "WORKER_DATABASE_NOT_READY")
            ? 503
          : conflictCodes.has(error.code)
            ? 409
            : 400
      );
    }

    return json(
      {
        error: "INFRASTRUCTURE_PROVISIONING_FAILED",
        message:
          env.ENVIRONMENT === "production"
            ? "Infrastructure provisioning failed. Check AppFactory logs for details."
            : error instanceof Error
              ? error.message
              : "Infrastructure provisioning failed."
      },
      500
    );
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
    let infrastructureClaims: GitHubOidcClaims | null = null;

    if (request.method === "GET" && url.pathname === "/health") {
      const config = runtimeConfig(env);
      return json({
        status: runtimeReady(env) ? "ok" : "degraded",
        service: "appfactory-api",
        milestone: "M3-openpage-end-to-end",
        manifestVersion: 2,
        idempotencyVersion: 1,
        serviceBlueprintVersion: 3,
        mobileBlueprintVersion: 3,
        desktopBlueprintVersion: 1,
        webappBlueprintVersion: 1,
        runtimeConfig: config
      });
    }

    if (
      request.method === "POST" &&
      (
        url.pathname === "/infrastructure/worker" ||
        url.pathname === "/infrastructure/pages" ||
        url.pathname === "/infrastructure/pages-d1" ||
        url.pathname === "/infrastructure/hyperdrive"
      )
    ) {
      try {
        infrastructureClaims = await authenticateInfrastructureMutation(request, env);
      } catch (error) {
        if (error instanceof AuthenticationError) {
          return json({ error: error.code, message: error.message }, error.status);
        }
        console.error("Infrastructure authentication failed", error);
        return json(
          { error: "AUTHENTICATION_FAILED", message: "Unable to authenticate infrastructure request." },
          401
        );
      }
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/projects" || url.pathname === "/engines/openpage/generate")
    ) {
      try {
        await authenticateMutation(request, env);
      } catch (error) {
        if (error instanceof AuthenticationError) {
          return json({ error: error.code, message: error.message }, error.status);
        }
        console.error("Mutation authentication failed", error);
        return json(
          { error: "AUTHENTICATION_FAILED", message: "Unable to authenticate request." },
          401
        );
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/infrastructure/pages" &&
      infrastructureClaims
    ) {
      return provisionExistingPages(request, env, infrastructureClaims);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/infrastructure/pages-d1" &&
      infrastructureClaims
    ) {
      return provisionExistingPagesD1(request, env, infrastructureClaims);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/infrastructure/hyperdrive" &&
      infrastructureClaims
    ) {
      return provisionExistingHyperdrive(request, env, infrastructureClaims);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/infrastructure/worker" &&
      infrastructureClaims
    ) {
      return provisionExistingWorker(request, env, infrastructureClaims);
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
