export type WorkerReleaseState = "deployed" | "degraded" | "ready";

export interface WorkerReadinessEvidence {
  state: WorkerReleaseState;
  checked: boolean;
  endpoint: string | null;
  healthStatus: string | null;
  runtime: string | null;
  databaseConfigured: boolean | null;
  attempts: number;
}

interface HealthPayload {
  status?: unknown;
  runtime?: unknown;
  database_configured?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function classifyWorkerHealth(
  payload: HealthPayload,
  databaseRequired: boolean,
  endpoint: string,
  attempts: number
): WorkerReadinessEvidence {
  const healthStatus = asString(payload.status);
  const runtime = asString(payload.runtime);
  const databaseConfigured = asBoolean(payload.database_configured);

  if (
    healthStatus === "ok" &&
    (!databaseRequired || databaseConfigured === true)
  ) {
    return {
      state: "ready",
      checked: true,
      endpoint,
      healthStatus,
      runtime,
      databaseConfigured,
      attempts
    };
  }

  return {
    state: "degraded",
    checked: true,
    endpoint,
    healthStatus,
    runtime,
    databaseConfigured,
    attempts
  };
}

export function deploymentOnlyReadiness(): WorkerReadinessEvidence {
  return {
    state: "deployed",
    checked: false,
    endpoint: null,
    healthStatus: null,
    runtime: null,
    databaseConfigured: null,
    attempts: 0
  };
}

function deployedAfterFailedProbe(
  endpoint: string,
  attempts: number
): WorkerReadinessEvidence {
  return {
    state: "deployed",
    checked: true,
    endpoint,
    healthStatus: null,
    runtime: null,
    databaseConfigured: null,
    attempts
  };
}

export async function probeWorkerReadiness(
  workerUrl: string,
  databaseRequired: boolean,
  options: {
    attempts?: number;
    intervalMs?: number;
  } = {}
): Promise<WorkerReadinessEvidence> {
  const endpoint = `${workerUrl.replace(/\/$/, "")}/health`;
  const maxAttempts = options.attempts ?? 24;
  const intervalMs = options.intervalMs ?? 2000;
  let lastEvidence = deployedAfterFailedProbe(endpoint, 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" }
      });
      const text = await response.text();
      if (text) {
        const payload = JSON.parse(text) as HealthPayload;
        lastEvidence = classifyWorkerHealth(
          payload,
          databaseRequired,
          endpoint,
          attempt
        );
        if (lastEvidence.state === "ready") return lastEvidence;
      } else {
        lastEvidence = deployedAfterFailedProbe(endpoint, attempt);
      }
    } catch {
      lastEvidence = deployedAfterFailedProbe(endpoint, attempt);
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return lastEvidence;
}
