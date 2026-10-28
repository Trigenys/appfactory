import type { Env } from "./types";
import type { GitHubOidcClaims } from "./auth";

type DocKey = "goals" | "audit" | "history" | "snapshot" | "snapshots" | "reports" | "missions";
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
      "command-center-reports.yml": ["push", "schedule", "workflow_dispatch"],
      "command-center-mission-preflight.yml": ["workflow_dispatch"]
    },
    readable: ["goals", "audit", "history", "snapshot", "snapshots", "reports", "missions"],
    writable: ["audit", "history", "snapshot", "snapshots", "reports"]
  },
  "Trigenys/appfactory-smoke-test-20260914": {
    databaseId: "bf1864e7-5f64-4063-8761-38bcbb6a8437",
    workflows: {"command-center-runner-proof.yml": ["workflow_dispatch"]},
    readable: [],
    writable: []
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
      !["goals","audit","history","snapshot","snapshots","reports","missions"].includes(data.document)) {
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
        ["draft","approved","sent","error"].includes(v.lifecycle) && v.audiences?.team?.autoSend === false); break;
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
  // Native Cloudflare D1 binding avoids dependence on the scope of an API key.
  // The broker's repository/workflow/document ACL is still authoritative.
  if (env.COMMAND_CENTER_DB &&
      databaseId === "bf1864e7-5f64-4063-8761-38bcbb6a8437") {
    const query = env.COMMAND_CENTER_DB.prepare(sql).bind(...params);
    try {
      if (sql.startsWith("SELECT ")) {
        const row = await query.first();
        return {success:true,results:row ? [row as Record<string,unknown>] : []};
      }
      const result = await query.run();
      return {success:true,results:[],meta:{changes:Number(result.meta?.changes??0)}};
    } catch {
      throw new D1BrokerError(502,"D1_DOCUMENT_BINDING_QUERY_FAILED",
        "Private bound database query failed.");
    }
  }
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
/**
 * Runner command channel is distinct from generic document put and fails
 * CLOSED unless a manually enabled AppFactory deployment permits it.
 * This adapter mirrors the canonical Project Registry mission event contract;
 * it cannot create missions or choose a repository.
 */
async function handleScopedRunnerCommand(
  env: Env, claims: GitHubOidcClaims,
  body: Record<string,unknown>, fetchImpl: typeof fetch
): Promise<{document:DocKey;changes:number;version?:number}> {
  const identity="Trigenys/appfactory-smoke-test-20260914";
  const workflow=identity+"/.github/workflows/command-center-runner-proof.yml@refs/heads/main";
  if (env.COMMAND_CENTER_RUNNER_ENABLED !== "true" ||
      claims.iss !== "https://token.actions.githubusercontent.com" ||
      claims.repository !== identity || claims.ref !== "refs/heads/main" ||
      claims.workflow_ref !== workflow || claims.event_name !== "workflow_dispatch" ||
      claims.actor !== "EagleFox31" ||
      typeof claims.run_id !== "string" || !/^[1-9][0-9]{0,19}$/.test(claims.run_id) ||
      typeof claims.run_attempt !== "string" || !/^[1-9][0-9]{0,4}$/.test(claims.run_attempt)) {
    throw new D1BrokerError(403,"D1_MISSION_RUNNER_FORBIDDEN",
      "An explicitly enabled, authenticated smoke runner is required.");
  }
  if (Object.keys(body).some(k=>!["action","document","expectedVersion","command"].includes(k)) ||
      body.document !== "missions" || !Number.isSafeInteger(body.expectedVersion) ||
      Number(body.expectedVersion)<0 || !body.command ||
      typeof body.command!=="object" || Array.isArray(body.command)) {
    throw new D1BrokerError(400,"D1_MISSION_INVALID","Mission command envelope invalid.");
  }
  const cmd=body.command as Record<string,unknown>;
  if(Object.keys(cmd).some(k=>!["type","eventId","missionId","expectedRevision","payload"].includes(k)) ||
     !["acquire","reclaim","checkpoint","heartbeat","complete","pause"].includes(String(cmd.type)) ||
     typeof cmd.eventId!=="string" || !/^[a-zA-Z0-9._-]{8,100}$/.test(cmd.eventId) ||
     !cmd.eventId.startsWith("ghrun-"+claims.run_id+"-"+claims.run_attempt+"-") ||
     typeof cmd.missionId!=="string" || !/^[a-z][a-z0-9._-]{1,79}$/i.test(cmd.missionId) ||
     !Number.isSafeInteger(cmd.expectedRevision) || Number(cmd.expectedRevision)<0 ||
     !cmd.payload || typeof cmd.payload!=="object" || Array.isArray(cmd.payload)) {
    throw new D1BrokerError(400,"D1_MISSION_INVALID","Unknown mission command.");
  }
  const p=cmd.payload as Record<string,unknown>;
  const permitted=cmd.type==="checkpoint" ? ["leaseId","step","phase","commit","pullRequest","nextAction"] :
    cmd.type==="reclaim" ? ["leaseId","leaseSeconds","observedCheckpointCount"] :
    cmd.type==="acquire" || cmd.type==="heartbeat" ? ["leaseId","leaseSeconds"] :
    cmd.type==="pause" ? ["leaseId","reason"] : ["leaseId"];
  if(Object.keys(p).some(k=>!permitted.includes(k))) {
    throw new D1BrokerError(400,"D1_MISSION_INVALID","Unexpected mission payload.");
  }
  const database="bf1864e7-5f64-4063-8761-38bcbb6a8437";
  const read=async(id:DocKey)=>{
    const res=await queryResource(env,database,"SELECT value, version FROM cc_documents WHERE id = ?",[id],fetchImpl);
    const row=res.results?.[0];
    return row?{value:JSON.parse(String(row.value)) as Record<string,any>,version:Number(row.version)}:null;
  };
  const [goals,doc]=await Promise.all([read("goals"),read("missions")]);
  if(!goals || !doc || !Number.isSafeInteger(doc.version) ||
     doc.value.schemaVersion!==1 || !Array.isArray(doc.value.missions) ||
     !Array.isArray(doc.value.events) || !Number.isSafeInteger(doc.value.revision)) {
    throw new D1BrokerError(409,"D1_MISSION_UNREGISTERED","Mission must be registered by the owner first.");
  }
  // The browser/runner cannot register, reassign or change an approved goal.
  const mission=doc.value.missions.find((m:any)=>m.id===cmd.missionId);
  const goal=goals.value.goals?.find((g:any)=>g.id===mission?.goalId);
  const expectedRepository="Trigenys/appfactory-smoke-test-20260914";
  const allowedProof=(link:unknown)=>{
    if(typeof link!=="string")return false;
    try {
      const u=new URL(link);
      const path=u.pathname.split("/").filter(Boolean);
      return u.protocol==="https:"&&u.hostname==="github.com" &&
        !u.search&&!u.hash&&!u.username&&!u.password&&path.length===4 &&
        (path[0]+"/"+path[1]).toLowerCase()===expectedRepository.toLowerCase() &&
        ["issues","pull"].includes(path[2])&&/^[1-9][0-9]*$/.test(path[3]);
    } catch { return false; }
  };
  if(!mission || mission.kind!=="github-executor" ||
     mission.executorId!=="cc-smoke-gha-runner" ||
     mission.repository!==expectedRepository ||
     !goal?.approvedAt || !["approved","in-progress","blocked"].includes(goal.status) ||
     !Array.isArray(goal.links) || !goal.links.some(allowedProof) ||
     !Array.isArray(mission.checkpoints)) {
    throw new D1BrokerError(403,"D1_MISSION_NOT_APPROVED",
      "Only the approved smoke mission can be modified.");
  }
  const at=new Date().toISOString(), actor={id:"cc-smoke-gha-runner",role:"agent"};
  const prior=doc.value.events.find((e:any)=>e.id===cmd.eventId);
  const eventAt=prior?.at??at;
  const text=new TextEncoder().encode(JSON.stringify({
    type:cmd.type,at:eventAt,actor,missionId:cmd.missionId,payload:p,
  }));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",text)))
    .map(x=>x.toString(16).padStart(2,"0")).join("");
  if(prior) {
    if(prior.fingerprint!==digest)
      throw new D1BrokerError(409,"D1_MISSION_ID_COLLISION","Event key changed payload.");
    // A genuine same-event replay is idempotent even if the requester retained
    // the original stale CAS revision; always validate fingerprint first.
    return {document:"missions",changes:0,version:doc.version};
  }
  if(doc.version!==body.expectedVersion || doc.value.revision!==cmd.expectedRevision) {
    return {document:"missions",changes:0,version:doc.version};
  }
  const fail=(reason:string):never=>{
    throw new D1BrokerError(409,"D1_MISSION_STATE_CONFLICT",reason);
  };
  if(mission.updatedAt && Date.parse(at)<Date.parse(mission.updatedAt))fail("Out-of-order command.");
  const lease=p.leaseId;
  if(typeof lease!=="string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{15,79}$/.test(lease))fail("Invalid lease.");
  const seconds=p.leaseSeconds;
  const ttl=()=> {
    if(!Number.isSafeInteger(seconds)||Number(seconds)<60||Number(seconds)>600)
      fail("Bounded lease required.");
    return new Date(Date.parse(at)+Number(seconds)*1000).toISOString();
  };
  const anyRunning=doc.value.missions.some((m:any)=>m!==mission&&m.status==="running");
  if(cmd.type==="acquire"||cmd.type==="reclaim") {
    if(anyRunning)fail("Another mission is already active.");
    if(cmd.type==="acquire" && !["planned","paused"].includes(mission.status))
      fail("Mission not available.");
    if(cmd.type==="reclaim" &&
       (mission.status!=="interrupted" ||
        !Number.isSafeInteger(p.observedCheckpointCount) ||
        p.observedCheckpointCount!==mission.checkpoints.length))
      fail("Checkpoint reconciliation required.");
    if(mission.nextEligibleAt && Date.parse(at)<Date.parse(mission.nextEligibleAt))
      fail("Resume is not eligible.");
    mission.lease={id:lease,owner:actor.id,acquiredAt:at,expiresAt:ttl()};
    mission.status="running";mission.nextEligibleAt=null;
  } else {
    if(mission.status!=="running" || mission.lease?.owner!==actor.id ||
       mission.lease?.id!==lease || !(Date.parse(at)<Date.parse(mission.lease.expiresAt)))
      fail("An active owned lease is required.");
    if(cmd.type==="heartbeat")mission.lease.expiresAt=ttl();
    if(cmd.type==="checkpoint") {
      const step=p.step,phase=p.phase,last=mission.checkpoints.at(-1);
      if(typeof step!=="string" || step.length>80 ||
        !/^[a-z][a-z0-9._-]*$/.test(step) ||
        !["before","after"].includes(String(phase)))fail("Checkpoint invalid.");
      if(phase==="before" && (last?.phase==="before" ||
        mission.checkpoints.some((cp:any)=>cp.step===step)))
        fail("Step was already started.");
      if(phase==="after" && (!last||last.phase!=="before"||last.step!==step))
        fail("After checkpoint requires matching before.");
      if(mission.checkpoints.length>=200)fail("Checkpoint limit reached.");
      const commit=p.commit==null?null:p.commit;
      const pr=p.pullRequest==null?null:p.pullRequest;
      if(commit!==null && (typeof commit!=="string"||!/^[a-f0-9]{40}$/i.test(commit)))
        fail("Invalid commit evidence.");
      if(pr!==null && (!allowedProof(pr) || !String(pr).includes("/pull/")))
        fail("Invalid pull request evidence.");
      if(phase==="after" && !commit && !pr)fail("Proof is required.");
      if(p.nextAction!=null &&
        (typeof p.nextAction!=="string" || !p.nextAction.trim() ||
          p.nextAction.length>250))
        fail("Invalid next action.");
      mission.checkpoints.push({step,phase,at,commit,pullRequest:pr,
        nextAction:p.nextAction==null?null:String(p.nextAction).trim()});
    }
    if(cmd.type==="complete") {
      const last=mission.checkpoints.at(-1);
      if(!last||last.phase!=="after"||!(last.commit||last.pullRequest))
        fail("Completion needs a verified checkpoint.");
      mission.status="completed";mission.completedAt=at;mission.lease=null;
    }
    if(cmd.type==="pause") {
      if(typeof p.reason!=="string"||p.reason.trim().length===0||p.reason.length>350)
        fail("Pause reason is required.");
      mission.status="paused";mission.blockedReason=p.reason.trim();
      mission.lease=null;
    }
  }
  mission.updatedAt=at;
  doc.value.events.push({
    id:cmd.eventId,fingerprint:digest,missionId:mission.id,type:cmd.type,at,
    actorId:actor.id,actorRole:actor.role,
  });
  doc.value.revision++;
  const encoded=JSON.stringify(doc.value);
  if(new TextEncoder().encode(encoded).byteLength>MAX_DOCUMENT_BYTES)
    throw new D1BrokerError(413,"D1_DOCUMENT_TOO_LARGE","Mission ledger too large.");
  const result=await queryResource(env,database,
    "UPDATE cc_documents SET value = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?",
    [encoded,String(doc.version+1),at,"missions",String(doc.version)],fetchImpl);
  return {document:"missions",changes:Number(result.meta?.changes??0),
    version:result.meta?.changes===1?doc.version+1:doc.version};
}

export async function handleD1DocumentRequest(
  env: Env, claims: GitHubOidcClaims, expectedRef: string, body: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<{document:DocKey; value?:unknown; version?:number; changes?:number; exists?:boolean}> {
  const consumer = authorizeD1DocumentClaims(claims,expectedRef);
  if(body && typeof body==="object" && !Array.isArray(body) &&
      (body as Record<string,unknown>).action==="mission-command") {
    return handleScopedRunnerCommand(env,claims,body as Record<string,unknown>,fetchImpl);
  }
  const operation = parseOperation(body);
  const document = operation.document;
  // A mission can be read only by a manually dispatched, pinned main-branch
  // preflight workflow. Existing schedulers/report collectors must not see
  // mission history; this is NEVER a generic OIDC mission write permission.
  if (document === "missions" &&
      (operation.action !== "read" ||
       claims.workflow_ref !==
         "EagleFox31/project-registry/.github/workflows/command-center-mission-preflight.yml@refs/heads/main" ||
       claims.event_name !== "workflow_dispatch")) {
    throw new D1BrokerError(403,"D1_DOCUMENT_PERMISSION_DENIED",
      "Mission access requires the dedicated read-only preflight identity.");
  }
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
  if (document === "reports") {
    const existing = current ? JSON.parse(String(current.value)) : [];
    preserveFinalizedReports(existing,value);
    const known = new Set((existing as Array<{id:string}>).map(r => r.id));
    for (const incoming of value as Array<{id:string;lifecycle:string}>) {
      if (!known.has(incoming.id) && incoming.lifecycle !== "draft") {
        throw new D1BrokerError(403,"D1_DOCUMENT_LIFECYCLE_FORBIDDEN",
          "Only a draft report can be created by a CI collector.");
      }
    }
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
