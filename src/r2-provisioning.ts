import type { CloudflareApiResponse, Env } from "./types";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const PRIVATE_MEDIA_RECIPE = "private-media";

interface R2Bucket {
  name: string;
  creation_date?: string;
  jurisdiction?: string;
  location?: string;
  storage_class?: string;
}

interface ManagedDomain {
  bucketId: string;
  domain: string;
  enabled: boolean;
}

export interface R2ProvisioningRequest {
  repository: string;
  recipe: typeof PRIVATE_MEDIA_RECIPE;
}

export interface R2ProvisioningResult {
  repository: string;
  recipe: typeof PRIVATE_MEDIA_RECIPE;
  bucket: {
    name: string;
    created: boolean;
    publicManagedDomainEnabled: false;
  };
  workerBinding: {
    binding: "MEDIA_BUCKET";
    bucketName: string;
  };
}

export interface R2Dependencies {
  fetch: typeof fetch;
}

export class R2ProvisioningError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requiredPermissions: string[] = []
  ) {
    super(message);
  }
}

class CloudflareR2ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string
  ) {
    super(`Cloudflare API ${status} on ${path}: ${detail}`);
  }
}

function preferredResourceToken(env: Env): string {
  const token = env.CLOUDFLARE_PAGES_D1_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new R2ProvisioningError(
      "CLOUDFLARE_R2_TOKEN_REQUIRED",
      "R2 provisioning requires an AppFactory Cloudflare resource token.",
      ["Workers R2 Storage Edit"]
    );
  }
  return token;
}

function assertConfig(env: Env): asserts env is Env & {
  CLOUDFLARE_ACCOUNT_ID: string;
} {
  if (!env.CLOUDFLARE_ACCOUNT_ID) {
    throw new R2ProvisioningError(
      "CLOUDFLARE_ACCOUNT_ID_REQUIRED",
      "R2 provisioning requires CLOUDFLARE_ACCOUNT_ID."
    );
  }
  preferredResourceToken(env);
}

async function cloudflareRequestWithToken<T>(
  token: string,
  deps: R2Dependencies,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + token);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await deps.fetch(CLOUDFLARE_API + path, {
      ...init,
      headers
    });
  } catch {
    throw new R2ProvisioningError(
      "CLOUDFLARE_R2_REQUEST_FAILED",
      "Cloudflare R2 API request failed."
    );
  }

  const raw = await response.text();
  let payload: CloudflareApiResponse<T> | null = null;
  try {
    payload = raw ? JSON.parse(raw) as CloudflareApiResponse<T> : null;
  } catch {
    throw new R2ProvisioningError(
      "CLOUDFLARE_R2_RESPONSE_INVALID",
      "Cloudflare R2 returned malformed JSON."
    );
  }

  if (!response.ok || !payload?.success) {
    const detail =
      payload?.errors
        ?.map((item) => String(item.code) + ": " + item.message)
        .join("; ") ||
      "HTTP " + response.status;
    throw new CloudflareR2ApiError(response.status, path, detail);
  }

  return payload.result;
}

async function cloudflareRequest<T>(
  env: Env,
  deps: R2Dependencies,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  assertConfig(env);

  const preferredToken = preferredResourceToken(env);
  try {
    return await cloudflareRequestWithToken<T>(
      preferredToken,
      deps,
      path,
      init
    );
  } catch (error) {
    const fallbackToken = env.CLOUDFLARE_API_TOKEN;
    const canRetryWithFallback =
      error instanceof CloudflareR2ApiError &&
      (error.status === 401 || error.status === 403) &&
      Boolean(env.CLOUDFLARE_PAGES_D1_TOKEN) &&
      Boolean(fallbackToken) &&
      fallbackToken !== preferredToken;

    if (!canRetryWithFallback || !fallbackToken) throw error;

    return cloudflareRequestWithToken<T>(
      fallbackToken,
      deps,
      path,
      init
    );
  }
}

function mapCloudflareError(error: unknown, operation: string): never {
  if (
    error instanceof CloudflareR2ApiError &&
    (error.status === 401 || error.status === 403)
  ) {
    throw new R2ProvisioningError(
      "CLOUDFLARE_R2_ACCESS_DENIED",
      `Cloudflare rejected ${operation}. Check the AppFactory resource token scope.`,
      ["Workers R2 Storage Edit"]
    );
  }
  if (error instanceof CloudflareR2ApiError) {
    throw new R2ProvisioningError(
      "CLOUDFLARE_R2_API_ERROR",
      `Cloudflare could not ${operation}.`
    );
  }
  throw error;
}

function repositorySlug(repository: string): string {
  const [owner, name, ...extra] = repository.split("/");
  if (
    !owner ||
    !name ||
    extra.length > 0 ||
    !/^Trigenys\/[A-Za-z0-9_.-]{1,90}$/.test(repository)
  ) {
    throw new R2ProvisioningError(
      "INVALID_REPOSITORY",
      "Repository must be a Trigenys owner/name repository."
    );
  }

  return name;
}

export function r2BucketName(repository: string): string {
  const raw = repositorySlug(repository)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const suffix = "-media";
  const base = raw.slice(0, 64 - suffix.length).replace(/-$/g, "");
  const name = base + suffix;

  if (
    name.length < 3 ||
    name.length > 64 ||
    !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)
  ) {
    throw new R2ProvisioningError(
      "R2_BUCKET_NAME_INVALID",
      "Repository cannot be mapped to a valid deterministic R2 bucket name."
    );
  }

  return name;
}

async function getBucket(
  env: Env,
  deps: R2Dependencies,
  bucketName: string
): Promise<R2Bucket | null> {
  assertConfig(env);
  const path =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/r2/buckets/${encodeURIComponent(bucketName)}`;

  try {
    return await cloudflareRequest<R2Bucket>(env, deps, path);
  } catch (error) {
    if (error instanceof CloudflareR2ApiError && error.status === 404) {
      return null;
    }
    mapCloudflareError(error, "read the R2 bucket");
  }
}

async function ensureBucket(
  env: Env,
  deps: R2Dependencies,
  bucketName: string
): Promise<{ bucket: R2Bucket; created: boolean }> {
  const existing = await getBucket(env, deps, bucketName);
  if (existing) return { bucket: existing, created: false };

  assertConfig(env);
  const collection =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/r2/buckets`;

  try {
    const bucket = await cloudflareRequest<R2Bucket>(
      env,
      deps,
      collection,
      {
        method: "POST",
        body: JSON.stringify({
          name: bucketName,
          storageClass: "Standard"
        })
      }
    );
    return { bucket, created: true };
  } catch (error) {
    if (error instanceof CloudflareR2ApiError && error.status === 409) {
      const concurrent = await getBucket(env, deps, bucketName);
      if (concurrent) return { bucket: concurrent, created: false };
    }
    mapCloudflareError(error, "create the R2 bucket");
  }
}

async function ensureManagedDomainDisabled(
  env: Env,
  deps: R2Dependencies,
  bucketName: string
): Promise<void> {
  assertConfig(env);
  const path =
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`;

  try {
    const current = await cloudflareRequest<ManagedDomain>(env, deps, path);
    if (!current.enabled) return;

    const updated = await cloudflareRequest<ManagedDomain>(
      env,
      deps,
      path,
      {
        method: "PUT",
        body: JSON.stringify({ enabled: false })
      }
    );
    if (updated.enabled) {
      throw new R2ProvisioningError(
        "R2_PUBLIC_ACCESS_NOT_DISABLED",
        "AppFactory could not verify that the R2 managed public domain is disabled."
      );
    }
  } catch (error) {
    if (error instanceof R2ProvisioningError) throw error;
    mapCloudflareError(error, "verify private R2 bucket delivery");
  }
}

export async function provisionR2(
  env: Env,
  oidcRepository: string,
  request: R2ProvisioningRequest,
  deps: R2Dependencies = {
    fetch: (input, init) => fetch(input, init)
  }
): Promise<R2ProvisioningResult> {
  if (!request || typeof request !== "object") {
    throw new R2ProvisioningError(
      "INVALID_R2_REQUEST",
      "R2 request must be an object."
    );
  }

  const keys = Object.keys(request).sort();
  if (
    keys.join(",") !== ["recipe", "repository"].sort().join(",") ||
    typeof request.repository !== "string" ||
    typeof request.recipe !== "string"
  ) {
    throw new R2ProvisioningError(
      "INVALID_R2_REQUEST",
      "R2 request must include only repository and recipe."
    );
  }

  if (request.repository !== oidcRepository) {
    throw new R2ProvisioningError(
      "REPOSITORY_MISMATCH",
      "OIDC repository does not match the requested R2 repository."
    );
  }

  if (request.recipe !== PRIVATE_MEDIA_RECIPE) {
    throw new R2ProvisioningError(
      "UNSUPPORTED_R2_RECIPE",
      "Only the private-media R2 recipe is supported."
    );
  }

  const bucketName = r2BucketName(request.repository);
  const { bucket, created } = await ensureBucket(env, deps, bucketName);
  if (bucket.name !== bucketName) {
    throw new R2ProvisioningError(
      "R2_BUCKET_MISMATCH",
      "Cloudflare returned an unexpected R2 bucket."
    );
  }

  await ensureManagedDomainDisabled(env, deps, bucketName);

  return {
    repository: request.repository,
    recipe: PRIVATE_MEDIA_RECIPE,
    bucket: {
      name: bucketName,
      created,
      publicManagedDomainEnabled: false
    },
    workerBinding: {
      binding: "MEDIA_BUCKET",
      bucketName
    }
  };
}
