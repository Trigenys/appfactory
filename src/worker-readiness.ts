export type WorkerReleaseState = "deployed" | "degraded" | "ready";

export interface WorkerReadinessEvidence {
  state: WorkerReleaseState;
  checked: boolean;
  endpoint: string | null;
  healthStatus: string | null;
  runtime: string | null;
  databaseConfigured: boolean | null;
  attempts: number;
  httpStatus: number | null;
  probeError: string | null;
}

interface HealthPayload {
  status?: unknown;
  runtime?: unknown;
  database_configured?: unknown;
}

interface ReadinessPayload {
  status?: unknown;
}

const DEFAULT_READINESS_ATTEMPTS = 6;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function probeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 240) || "unknown probe error";
}

export function classifyWorkerHealth(
  payload: HealthPayload,
  databaseRequired: boolean,
  endpoint: string,
  attempts: number,
  httpStatus: number | null = null
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
      attempts,
      httpStatus,
      probeError: null
    };
  }

  return {
    state: "degraded",
    checked: true,
    endpoint,
    healthStatus,
    runtime,
    databaseConfigured,
    attempts,
    httpStatus,
    probeError: null
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
    attempts: 0,
    httpStatus: null,
    probeError: null
  };
}

function deployedAfterFailedProbe(
  endpoint: string,
  attempts: number,
  httpStatus: number | null = null,
  probeError: string | null = null
): WorkerReadinessEvidence {
  return {
    state: "deployed",
    checked: true,
    endpoint,
    healthStatus: null,
    runtime: null,
    databaseConfigured: null,
    attempts,
    httpStatus,
    probeError
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
  const baseUrl = workerUrl.replace(/\/$/, "");
  const endpoint = `${baseUrl}/health`;
  const readinessEndpoint = `${baseUrl}/health/ready`;
  const maxAttempts = options.attempts ?? DEFAULT_READINESS_ATTEMPTS;
  const intervalMs = options.intervalMs ?? 2000;
  let lastEvidence = deployedAfterFailedProbe(endpoint, 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" }
      });
      const text = await response.text();

      if (!text) {
        lastEvidence = deployedAfterFailedProbe(
          endpoint,
          attempt,
          response.status,
          `empty health response (HTTP ${response.status})`
        );
      } else {
        try {
          const payload = JSON.parse(text) as HealthPayload;
          lastEvidence = classifyWorkerHealth(
            payload,
            databaseRequired,
            endpoint,
            attempt,
            response.status
          );
          if (lastEvidence.state === "ready") return lastEvidence;

          const healthStatus = asString(payload.status);
          const runtime = asString(payload.runtime);
          const databaseConfigured = asBoolean(payload.database_configured);

          if (
            databaseRequired &&
            healthStatus === "ok" &&
            databaseConfigured === null
          ) {
            try {
              const readinessResponse = await fetch(readinessEndpoint, {
                headers: { Accept: "application/json" }
              });
              const readinessText = await readinessResponse.text();

              if (!readinessText) {
                lastEvidence = {
                  state: "degraded",
                  checked: true,
                  endpoint: readinessEndpoint,
                  healthStatus,
                  runtime,
                  databaseConfigured: false,
                  attempts: attempt,
                  httpStatus: readinessResponse.status,
                  probeError: `empty readiness response (HTTP ${readinessResponse.status})`
                };
              } else {
                try {
                  const readinessPayload = JSON.parse(
                    readinessText
                  ) as ReadinessPayload;
                  const readinessStatus = asString(readinessPayload.status);

                  if (
                    readinessResponse.ok &&
                    (readinessStatus === "ready" || readinessStatus === "ok")
                  ) {
                    return {
                      state: "ready",
                      checked: true,
                      endpoint: readinessEndpoint,
                      healthStatus,
                      runtime,
                      databaseConfigured: true,
                      attempts: attempt,
                      httpStatus: readinessResponse.status,
                      probeError: null
                    };
                  }

                  lastEvidence = {
                    state: "degraded",
                    checked: true,
                    endpoint: readinessEndpoint,
                    healthStatus,
                    runtime,
                    databaseConfigured: false,
                    attempts: attempt,
                    httpStatus: readinessResponse.status,
                    probeError: `readiness status=${readinessStatus || "unknown"} (HTTP ${readinessResponse.status})`
                  };
                } catch (error) {
                  lastEvidence = {
                    state: "degraded",
                    checked: true,
                    endpoint: readinessEndpoint,
                    healthStatus,
                    runtime,
                    databaseConfigured: false,
                    attempts: attempt,
                    httpStatus: readinessResponse.status,
                    probeError: `invalid readiness JSON: ${probeErrorMessage(error)}`
                  };
                }
              }
            } catch (error) {
              lastEvidence = {
                state: "deployed",
                checked: true,
                endpoint: readinessEndpoint,
                healthStatus,
                runtime,
                databaseConfigured: null,
                attempts: attempt,
                httpStatus: null,
                probeError: probeErrorMessage(error)
              };
            }
          }
        } catch (error) {
          lastEvidence = deployedAfterFailedProbe(
            endpoint,
            attempt,
            response.status,
            `invalid health JSON: ${probeErrorMessage(error)}`
          );
        }
      }
    } catch (error) {
      lastEvidence = deployedAfterFailedProbe(
        endpoint,
        attempt,
        null,
        probeErrorMessage(error)
      );
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return lastEvidence;
}
