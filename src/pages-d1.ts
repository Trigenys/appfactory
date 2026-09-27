import type { CloudflareApiResponse, CloudflarePagesDeployment, CloudflarePagesProject, Env } from "./types";
import { pagesProjectUrl, triggerPagesDeployment } from "./cloudflare";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const EARLY_ACCESS_RECIPE = "early-access-leads";
const EARLY_ACCESS_BINDING = "LEADS_DB";

interface D1Database {
  uuid: string;
  name: string;
}

interface D1QueryResult {
  success?: boolean;
  results?: Array<Record<string, unknown>>;
}

export interface PagesD1Request {
  repository: string;
  recipe: typeof EARLY_ACCESS_RECIPE;
}

export interface PagesD1Result {
  repository: string;
  recipe: string;
  database: {
    id: string;
    name: string;
    created: boolean;
  };
  pages: {
    project: string;
    url: string | null;
    binding: string;
    deploymentId: string;
  };
}

export class PagesD1ProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requiredPermissions: string[] = []
  ) {
    super(message);
  }
}

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
    throw new PagesD1ProvisioningError(
      "CLOUDFLARE_ACCOUNT_ID_REQUIRED",
      "Pages D1 provisioning requires CLOUDFLARE_ACCOUNT_ID."
    );
  }
  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new PagesD1ProvisioningError(
      "CLOUDFLARE_API_TOKEN_REQUIRED",
      "Pages D1 provisioning requires the existing AppFactory CLOUDFLARE_API_TOKEN."
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

  const raw = await response.text();
  let payload: CloudflareApiResponse<T> | null = null;

  try {
    payload = raw ? JSON.parse(raw) as CloudflareApiResponse<T> : null;
  } catch {
    throw new CloudflareApiError(
      response.status,
      path,
      `Malformed response: ${raw.slice(0, 240)}`
    );
  }

  if (!response.ok || !payload?.success) {
    const detail =
      payload?.errors?.map((item) => `${item.code}: ${item.message}`).join("; ") ||
      `HTTP ${response.status}`;
    throw new CloudflareApiError(response.status, path, detail);
  }

  return payload.result;
}

function permissionError(error: unknown, operation: string, permissions: string[]): never {
  if (error instanceof CloudflareApiError && (error.status === 401 || error.status === 403)) {
    throw new PagesD1ProvisioningError(
      "CLOUDFLARE_TOKEN_PERMISSION_REQUIRED",
      `The existing AppFactory Cloudflare token cannot ${operation}. Extend that token instead of creating a duplicate credential.`,
      permissions
    );
  }
  throw error;
}

function repositoryName(repository: string): string {
  const [owner, name, ...extra] = repository.split("/");
  if (!owner || !name || extra.length > 0) {
    throw new PagesD1ProvisioningError(
      "INVALID_REPOSITORY",
      "Repository must use owner/name form."
    );
  }
  return name;
}

function earlyAccessMigration(): string {
  return `
CREATE TABLE IF NOT EXISTS early_access_leads (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  release_frequency TEXT NOT NULL CHECK (
    release_frequency IN ('weekly', 'monthly', 'quarterly', 'occasionally')
  ),
  source TEXT,
  campaign TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_early_access_created_at
  ON early_access_leads(created_at DESC);

CREATE TABLE IF NOT EXISTS conversion_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES early_access_leads(id) ON DELETE CASCADE,
  UNIQUE (lead_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_conversion_events_type_created_at
  ON conversion_events(event_type, created_at DESC);
`.trim();
}

async function ensureDatabase(
  env: Env,
  name: string
): Promise<{ database: D1Database; created: boolean }> {
  assertCloudflareConfig(env);

  try {
    const databases = await cloudflareRequest<D1Database[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database?name=${encodeURIComponent(name)}&per_page=100`
    );
    const existing = databases.find((database) => database.name === name);
    if (existing) return { database: existing, created: false };

    const database = await cloudflareRequest<D1Database>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database`,
      {
        method: "POST",
        body: JSON.stringify({ name })
      }
    );
    return { database, created: true };
  } catch (error) {
    permissionError(error, "read or create D1 databases", ["D1 Edit"]);
  }
}

async function migrateDatabase(env: Env, databaseId: string): Promise<void> {
  assertCloudflareConfig(env);

  try {
    const migration = await cloudflareRequest<D1QueryResult[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database/${encodeURIComponent(databaseId)}/query`,
      {
        method: "POST",
        body: JSON.stringify({ sql: earlyAccessMigration() })
      }
    );

    if (migration.some((result) => result.success === false)) {
      throw new Error("D1 migration returned an unsuccessful query result.");
    }

    const verification = await cloudflareRequest<D1QueryResult[]>(
      env,
      `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database/${encodeURIComponent(databaseId)}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('early_access_leads', 'conversion_events') ORDER BY name"
        })
      }
    );

    const names = new Set(
      verification
        .flatMap((result) => result.results || [])
        .map((row) => String(row.name || ""))
    );

    for (const required of ["early_access_leads", "conversion_events"]) {
      if (!names.has(required)) {
        throw new Error(`D1 migration verification failed: missing ${required}`);
      }
    }
  } catch (error) {
    permissionError(error, "execute D1 migrations", ["D1 Edit"]);
  }
}

function sanitizeD1Bindings(
  bindings: Record<string, { id?: string }> | undefined
): Record<string, { id: string }> {
  const result: Record<string, { id: string }> = {};

  for (const [name, value] of Object.entries(bindings || {})) {
    if (value?.id) result[name] = { id: value.id };
  }

  return result;
}

async function bindDatabaseToPages(
  env: Env,
  projectName: string,
  databaseId: string
): Promise<CloudflarePagesProject> {
  assertCloudflareConfig(env);
  const path =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(projectName)}`;

  try {
    const project = await cloudflareRequest<CloudflarePagesProject>(env, path);
    const production = sanitizeD1Bindings(project.deployment_configs?.production?.d1_databases);
    const preview = sanitizeD1Bindings(project.deployment_configs?.preview?.d1_databases);

    production[EARLY_ACCESS_BINDING] = { id: databaseId };
    preview[EARLY_ACCESS_BINDING] = { id: databaseId };

    await cloudflareRequest<CloudflarePagesProject>(env, path, {
      method: "PATCH",
      body: JSON.stringify({
        deployment_configs: {
          production: { d1_databases: production },
          preview: { d1_databases: preview }
        }
      })
    });

    const updated = await cloudflareRequest<CloudflarePagesProject>(env, path);
    const productionId =
      updated.deployment_configs?.production?.d1_databases?.[EARLY_ACCESS_BINDING]?.id;
    const previewId =
      updated.deployment_configs?.preview?.d1_databases?.[EARLY_ACCESS_BINDING]?.id;

    if (productionId !== databaseId || previewId !== databaseId) {
      throw new Error(
        `Pages D1 binding verification failed: production=${productionId || "missing"}, preview=${previewId || "missing"}`
      );
    }

    return updated;
  } catch (error) {
    permissionError(error, "configure Cloudflare Pages D1 bindings", ["Cloudflare Pages Edit"]);
  }
}

export async function provisionPagesD1(
  env: Env,
  repository: string,
  request: PagesD1Request
): Promise<PagesD1Result> {
  if (request.repository !== repository) {
    throw new PagesD1ProvisioningError(
      "REPOSITORY_MISMATCH",
      "OIDC repository does not match the requested Pages D1 repository."
    );
  }

  if (request.recipe !== EARLY_ACCESS_RECIPE) {
    throw new PagesD1ProvisioningError(
      "UNSUPPORTED_PAGES_D1_RECIPE",
      `Unsupported Pages D1 recipe: ${request.recipe}`
    );
  }

  const projectName = repositoryName(repository);
  const databaseName = `${projectName}-leads`;

  const { database, created } = await ensureDatabase(env, databaseName);
  await migrateDatabase(env, database.uuid);

  const project = await bindDatabaseToPages(env, projectName, database.uuid);
  const deployment = await triggerPagesDeployment(
    env,
    project,
    project.production_branch || "main"
  ) as CloudflarePagesDeployment;

  return {
    repository,
    recipe: request.recipe,
    database: {
      id: database.uuid,
      name: database.name,
      created
    },
    pages: {
      project: project.name,
      url: pagesProjectUrl(project),
      binding: EARLY_ACCESS_BINDING,
      deploymentId: deployment.id
    }
  };
}
