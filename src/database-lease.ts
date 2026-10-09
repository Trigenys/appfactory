import type { Env } from "./types";
import type { GitHubOidcClaims } from "./auth";

interface LeaseTarget {
  repository: string;
  database: string;
  roleName: string;
  envKey:
    | "APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL"
    | "HYPERDRIVE_DATABASE_URL__TRIGENYS_EDITORIAL_OS_STAGING";
}

const LEASE_TARGETS: Record<string, LeaseTarget> = {
  "Trigenys/trigenys-seo-monitor": {
    repository: "Trigenys/trigenys-seo-monitor",
    database: "seo_monitor",
    roleName: "seo_monitor_owner",
    envKey: "APPFACTORY_DATABASE_TRIGENYS_SEO_MONITOR_URL"
  },
  "Trigenys/trigenys-editorial-os": {
    repository: "Trigenys/trigenys-editorial-os",
    database: "editorial_os_staging",
    roleName: "editorial_os_staging",
    envKey: "HYPERDRIVE_DATABASE_URL__TRIGENYS_EDITORIAL_OS_STAGING"
  }
};

export interface DatabaseLease {
  status: "READY";
  repository: string;
  database: string;
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

function leaseTarget(repository: string | undefined): LeaseTarget {
  const target = repository ? LEASE_TARGETS[repository] : undefined;
  if (!target) {
    throw new DatabaseLeaseError(
      403,
      "DATABASE_LEASE_REPOSITORY_FORBIDDEN",
      "Repository has no approved database lease."
    );
  }
  return target;
}

/**
 * Scoped lease for private GitHub Actions collectors. No caller can choose
 * a database, role, URL, secret name, or connection profile.
 */
export function issueDatabaseLease(
  env: Env,
  claims: GitHubOidcClaims,
  payload: unknown
): DatabaseLease {
  const target = leaseTarget(claims.repository);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DatabaseLeaseError(
      400,
      "DATABASE_LEASE_INVALID_REQUEST",
      "Expected a repository request."
    );
  }
  const body = payload as Record<string, unknown>;
  if (body.repository !== target.repository || claims.repository !== target.repository) {
    throw new DatabaseLeaseError(
      403,
      "DATABASE_LEASE_REPOSITORY_MISMATCH",
      "Repository identity mismatch."
    );
  }
  if (Object.keys(body).some((key) => key !== "repository")) {
    throw new DatabaseLeaseError(
      400,
      "DATABASE_LEASE_FIELDS_FORBIDDEN",
      "Caller cannot select database credentials."
    );
  }

  const connectionString = env[target.envKey]?.trim();
  if (!connectionString) {
    throw new DatabaseLeaseError(
      503,
      "DATABASE_LEASE_NOT_CONFIGURED",
      "The approved database connection is not configured in AppFactory."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new DatabaseLeaseError(
      503,
      "DATABASE_LEASE_INVALID_PROFILE",
      "AppFactory database profile is invalid."
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname.endsWith(".neon.tech") ||
    parsed.username !== target.roleName ||
    decodeURIComponent(parsed.pathname) !== "/" + target.database ||
    !parsed.password ||
    Boolean(parsed.hash) ||
    (parsed.port !== "" && parsed.port !== "5432")
  ) {
    throw new DatabaseLeaseError(
      503,
      "DATABASE_LEASE_INVALID_PROFILE",
      "The configured connection does not match the approved Neon database."
    );
  }

  // The runner configures verified TLS itself. URL SSL parameters can override
  // that setting, so strip only those parameters before the short-lived lease.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    parsed.searchParams.delete(key);
  }

  return {
    status: "READY",
    repository: target.repository,
    database: target.database,
    databaseUrl: parsed.toString()
  };
}
