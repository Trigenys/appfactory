import type { Env } from "./types";
import type { GitHubOidcClaims } from "./auth";

export interface DatabaseLease {
  status: "READY";
  repository: string;
  database: "seo_monitor";
  databaseUrl: string;
}

export class DatabaseLeaseError extends Error {
  constructor(
    readonly status: 400 | 403 | 503,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Scoped lease for a private GitHub Actions collector. No caller can choose
 * a database, role, URL, secret name, or connection profile.
 */
export function issueDatabaseLease(
  env: Env,
  claims: GitHubOidcClaims,
  payload: unknown
): DatabaseLease {
  const repository = "Trigenys/trigenys-seo-monitor";
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DatabaseLeaseError(400, "DATABASE_LEASE_INVALID_REQUEST", "Expected a repository request.");
  }
  const body = payload as Record<string, unknown>;
  if (body.repository !== repository || claims.repository !== repository) {
    throw new DatabaseLeaseError(403, "DATABASE_LEASE_REPOSITORY_MISMATCH", "Repository identity mismatch.");
  }
  if (Object.keys(body).some((key) => key !== "repository")) {
    throw new DatabaseLeaseError(400, "DATABASE_LEASE_FIELDS_FORBIDDEN", "Caller cannot select database credentials.");
  }

  const connectionString = env.APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL?.trim();
  if (!connectionString) {
    throw new DatabaseLeaseError(
      503,
      "DATABASE_LEASE_NOT_CONFIGURED",
      "The SEO Monitor database connection is not configured in AppFactory."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new DatabaseLeaseError(503, "DATABASE_LEASE_INVALID_PROFILE", "AppFactory database profile is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname.endsWith(".neon.tech") ||
    parsed.username !== "seo_monitor_owner" ||
    decodeURIComponent(parsed.pathname) !== "/seo_monitor" ||
    !parsed.password ||
    Boolean(parsed.hash) ||
    (parsed.port !== "" && parsed.port !== "5432")
  ) {
    throw new DatabaseLeaseError(
      503,
      "DATABASE_LEASE_INVALID_PROFILE",
      "The configured connection is not the dedicated SEO Monitor Neon database."
    );
  }
  // pg Pool supplies SSL with verified certificates. URL SSL parameters
  // can override that Pool option, so remove only those parameters.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    parsed.searchParams.delete(key);
  }
  return { status: "READY", repository, database: "seo_monitor", databaseUrl: parsed.toString() };
}
