import type { Env } from "./types";
import type { GitHubOidcClaims } from "./auth";

type DocKey = "goals" | "audit" | "history" | "snapshot" | "snapshots" | "reports";
interface TrustedConsumer {
  workflows: Record<string, readonly string[]>;
  databaseId: string;
  readable: readonly DocKey[];
  writable: readonly DocKey[];
}
/** Consumer-specific grants, not caller-selected SQL, database, or token. */
const CONSUMERS: Record<string, TrustedConsumer> = {
  "EagleFox31/project-registry": {
    databaseId: "bf1864e7-5f64-4063-8761-38bcbb6a8437",
    workflows: {
      "refresh.yml": ["push", "schedule", "workflow_dispatch"],
      "command-center-reports.yml": ["push", "schedule", "workflow_dispatch"]
    },
    readable: ["goals", "audit", "history", "snapshot", "snapshots", "reports"],
    writable: ["audit", "history", "snapshot", "snapshots", "reports"]
  }
};
const MAX_DOCUMENT_BYTES = 1_800_000;

export class D1BrokerError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 413 | 502 | 503,
    readonly code: string, message: string) { super(message); }
}
export function authorizeD1DocumentClaims(
  claims: GitHubOidcClaims, expectedRef: string
): TrustedConsumer {
  const consumer = CONSUMERS[claims.repository ?? ""];
  const workflowPrefix = (claims.repository ?? "") + "/.github/workflows/";
  const workflowName = (claims.workflow_ref ?? "").startsWith(workflowPrefix)
    ? (claims.workflow_ref ?? "").slice(workflowPrefix.length).split("@")[0]
    : "";
  const allowedEvents = consumer?.workflows[workflowName];
  if (!consumer || !allowedEvents ||
      claims.workflow_ref !== workflowPrefix + workflowName + "@" + expectedRef ||
      !allowedEvents.includes(claims.event_name ?? "") ||
      claims.ref !== expectedRef || expectedRef !== "refs/heads/main") {
    throw new D1BrokerError(403, "D1_DOCUMENT_CALLER_FORBIDDEN",
      "Only a trusted main-branch workflow may access its D1 documents.");
  }
  return consumer;
}
function parseOperation(input: unknown): {
  action: "read" | "put"; document: DocKey; expectedVersion?: number | null; value?: unknown;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new D1BrokerError(400,"D1_DOCUMENT_BAD_REQUEST","Expected a JSON object.");
  }
  const data = input as Record<string,unknown>;
  if (Object.keys(data).some(k => !["action","document","expectedVersion","value"].includes(k)) ||
      (data.action !== "read" && data.action !== "put") ||
      typeof data.document !== "string" ||
      !["goals","audit","history","snapshot","snapshots","reports"].includes(data.document)) {
    throw new D1BrokerError(400,"D1_DOCUMENT_BAD_REQUEST","Unknown document or operation.");
  }
  if (data.action === "read" && Object.keys(data).some(k => k !== "action" && k !== "document")) {
    throw new D1BrokerError(400,"D1_DOCUMENT_BAD_REQUEST","Read does not accept fields.");
  }
  if (data.action === "put" &&
    (!(data.expectedVersion === null || (Number.isSafeInteger(data.expectedVersion) &&
      Number(data.expectedVersion) >= 0)) || !("value" in data))) {
    throw new D1BrokerError(400,"D1_DOCUMENT_BAD_REQUEST","Put requires value and expectedVersion.");
  }
  return data as ReturnType<typeof parseOperation>;
}
function requireDocumentShape(key: DocKey, value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value) &&
    !["reports","snapshots"].includes(key)) {
    throw new D1BrokerError(400,"D1_DOCUMENT_INVALID","Invalid document value.");
  }
  const obj = value as Record<string,unknown>;
  const isIso = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  let valid = false;
  switch (key) {
    case "audit": valid = isIso(obj.generatedAt) && Array.isArray(obj.projects); break;
    case "history": valid = ["compared","baseline-needed"].includes(String(obj.status)) && isIso(obj.to); break;
    case "snapshot": valid = obj.schemaVersion === 1 && isIso(obj.generatedAt) && Array.isArray(obj.projects); break;
    case "snapshots": valid = Array.isArray(value) && value.length <= 130 &&
      value.every((v: any) => v?.schemaVersion === 1 && isIso(v.generatedAt) && Array.isArray(v.projects)); break;
    case "reports": valid = Array.isArray(value) && value.length <= 240 &&
      value.every((v: any) => v?.schemaVersion === 1 &&
        typeof v.id === "string" && /^command-center:(weekly|monthly)-(plan|review):/.test(v.id) &&
        v.lifecycle === "draft" && v.audiences?.team?.autoSend === false); break;
    case "goals": valid = false; break; // never written by this broker
  }
  if (!valid) throw new D1BrokerError(400,"D1_DOCUMENT_INVALID","Document shape is not allowed.");
}
function preserveFinalizedReports(previous: unknown, incoming: unknown) {
  if (!Array.isArray(previous) || !Array.isArray(incoming)) return;
  const next = new Map((incoming as any[]).map((v) => [v.id,v]));
  for (const record of previous as any[]) {
    if (["approved","sent","error"].includes(record.lifecycle)) {
      const candidate = next.get(record.id);
      if (!candidate || JSON.stringify(candidate) !== JSON.stringify(record)) {
        throw new D1BrokerError(409,"D1_DOCUMENT_FINALIZED","A finalized report cannot be changed.");
      }
    }
  }
}
interface QueryResult { success?: boolean; results?: Record<string,unknown>[]; meta?: { changes?: number }; }
async function queryResource(env: Env, databaseId: string, sql: string, params: string[],
  fetchImpl: typeof fetch): Promise<QueryResult> {
  const token = env.CLOUDFLARE_PAGES_D1_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (!env.CLOUDFLARE_ACCOUNT_ID || !token) {
    throw new D1BrokerError(503,"D1_DOCUMENT_CREDENTIAL_UNAVAILABLE",
      "AppFactory resource credential is not configured.");
  }
  const endpoint = "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID) + "/d1/database/" +
    encodeURIComponent(databaseId) + "/query";
  let response: Response;
  try {
    response = await fetchImpl(endpoint,{
      method:"POST",redirect:"error",
      headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({sql,params})
    });
  } catch {
    throw new D1BrokerError(502,"D1_DOCUMENT_PROVIDER_UNREACHABLE","D1 resource request failed.");
  }
  if (!response.ok) {
    throw new D1BrokerError(response.status === 401 || response.status === 403 ? 503 : 502,
      "D1_DOCUMENT_PROVIDER_ERROR","AppFactory D1 permissions or upstream query failed.");
  }
  let payload: {success?:boolean;result?:QueryResult[]};
  try { payload = await response.json() as typeof payload; }
  catch { throw new D1BrokerError(502,"D1_DOCUMENT_PROVIDER_INVALID","D1 response invalid."); }
  const result = payload.result?.[0];
  if (!payload.success || !result || result.success === false) {
    throw new D1BrokerError(502,"D1_DOCUMENT_PROVIDER_ERROR","D1 provider rejected query.");
  }
  return result;
}
export async function handleD1DocumentRequest(
  env: Env, claims: GitHubOidcClaims, expectedRef: string, body: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<{document:DocKey; value?:unknown; version?:number; changes?:number; exists?:boolean}> {
  const consumer = authorizeD1DocumentClaims(claims,expectedRef);
  const operation = parseOperation(body);
  const document = operation.document;
  if (!(operation.action === "read" ? consumer.readable : consumer.writable).includes(document)) {
    throw new D1BrokerError(403,"D1_DOCUMENT_PERMISSION_DENIED","Document operation is forbidden.");
  }
  if (operation.action === "read") {
    const result = await queryResource(env,consumer.databaseId,
      "SELECT value, version FROM cc_documents WHERE id = ?",[document],fetchImpl);
    const row = result.results?.[0];
    return !row ? {document,exists:false} : {
      document,exists:true,value:JSON.parse(String(row.value)),version:Number(row.version)
    };
  }
  const value = operation.value;
  requireDocumentShape(document,value);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > MAX_DOCUMENT_BYTES) {
    throw new D1BrokerError(413,"D1_DOCUMENT_TOO_LARGE","Document exceeds capacity.");
  }
  const read = await queryResource(env,consumer.databaseId,
    "SELECT value, version FROM cc_documents WHERE id = ?",[document],fetchImpl);
  const current = read.results?.[0];
  const priorVersion = current ? Number(current.version) : null;
  if (priorVersion !== operation.expectedVersion) return {document,changes:0};
  if (document === "reports" && current) {
    preserveFinalizedReports(JSON.parse(String(current.value)),value);
  }
  if (current && String(current.value) === encoded) return {document,changes:0};
  const now = new Date().toISOString();
  const sql = operation.expectedVersion === null
    ? "INSERT OR IGNORE INTO cc_documents (id, value, version, updated_at) VALUES (?, ?, 0, ?)"
    : "UPDATE cc_documents SET value = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?";
  const params = operation.expectedVersion === null
    ? [document,encoded,now]
    : [encoded,String(operation.expectedVersion!+1),now,document,String(operation.expectedVersion)];
  const result = await queryResource(env,consumer.databaseId,sql,params,fetchImpl);
  return {document,changes:Number(result.meta?.changes??0)};
}
