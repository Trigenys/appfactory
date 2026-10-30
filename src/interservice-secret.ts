import type {GitHubOidcClaims} from "./auth";
import type {Env} from "./types";

/**
 * Single-purpose, write-once credential synchronizer.
 * The caller writes a strong random key to its OWN AWS SSM SecureString FIRST,
 * then hands that same key to AppFactory over signed GitHub OIDC + HTTPS.
 * AppFactory never exposes, caches, persists or logs the plaintext key.
 */
const WORKER="trigenys-notify-staging-api";
const SECRET="ATELIER_NOTIFY_INGEST_KEY";
const ACCOUNT_ID="28007ba3301ed34cfeb04c2a19b68e9f";
const CHECK_URL=
  "https://trigenys-notify-staging-api.lawrynnjennifer.workers.dev/v1/dispatch/atelier/credential-check";
const CONTRACT="atelier-notify:staging-v1";
const REPOSITORY="EagleFox31/atelier2026";

export class InterserviceSecretError extends Error {
  constructor(readonly status:400|403|409|503,readonly code:string) {
    super(code);
    this.name="InterserviceSecretError";
  }
}
export interface InterserviceInput {
  contract:string;repository:string;key:string;
}
export interface InterserviceDependencies {
  listSecretNames:(env:Env,worker:string)=>Promise<Set<string>>;
  putSecret:(env:Env,worker:string,name:string,value:string)=>Promise<void>;
  fetch:(url:string,init:RequestInit)=>Promise<Response>;
}

export function validateInterserviceInput(
  body:unknown,claims:GitHubOidcClaims,env:Env
): InterserviceInput {
  if(!body||typeof body!=="object"||Array.isArray(body)) {
    throw new InterserviceSecretError(400,"INVALID_CONTRACT");
  }
  const input=body as Record<string,unknown>;
  const keys=Object.keys(input).sort();
  if(keys.join(",")!=="contract,key,repository"||
     input.contract!==CONTRACT||input.repository!==REPOSITORY||
     claims.repository!==REPOSITORY) {
    throw new InterserviceSecretError(403,"INTERSERVICE_TARGET_FORBIDDEN");
  }
  if(env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT_ID) {
    throw new InterserviceSecretError(503,"CLOUDFLARE_TARGET_NOT_CONFIGURED");
  }
  if(typeof input.key!=="string"||!/^[a-f0-9]{64}$/.test(input.key)) {
    throw new InterserviceSecretError(400,"INVALID_SECRET_FORMAT");
  }
  return input as unknown as InterserviceInput;
}

/** Never send a test WhatsApp message; proof of key possession is a 204-only route. */
async function checkKey(
  key:string,fetcher:InterserviceDependencies["fetch"]
):Promise<number> {
  try {
    const response=await fetcher(CHECK_URL,{
      method:"POST",
      headers:{"x-notify-auth":key,"cache-control":"no-store"},
      redirect:"error",
      signal:AbortSignal.timeout(10000),
    });
    return response.status;
  } catch {
    // 0 denotes a transport failure. Never include HTTP body, headers or key.
    return 0;
  }
}

function proofFailure(status:number, existing:boolean):InterserviceSecretError {
  if(status===401)
    return new InterserviceSecretError(existing?409:503,
      existing?"SECRET_MISMATCH":"SECRET_WRITTEN_PROOF_REJECTED");
  if(status===0)
    return new InterserviceSecretError(503,"SECRET_PROOF_TRANSPORT");
  // Limited numeric code is safe to expose; never return upstream payloads.
  return new InterserviceSecretError(503,"SECRET_PROOF_HTTP_"+String(status));
}

export async function provisionInterserviceSecret(
  env:Env,claims:GitHubOidcClaims,body:unknown,dependencies:InterserviceDependencies
):Promise<{status:"PROVISIONED"|"ALREADY_CONFIGURED";contract:string;worker:string}> {
  const input=validateInterserviceInput(body,claims,env);
  const names=await dependencies.listSecretNames(env,WORKER);
  if(names.has(SECRET)){
    const proof=await checkKey(input.key,dependencies.fetch);
    if(proof!==204){
      // Never overwrite an existing Worker key or infer a mismatch from an
      // upstream HTTP failure.
      throw proofFailure(proof,true);
    }
    return {status:"ALREADY_CONFIGURED",contract:CONTRACT,worker:WORKER};
  }
  await dependencies.putSecret(env,WORKER,SECRET,input.key);
  const proof=await checkKey(input.key,dependencies.fetch);
  if(proof!==204){
    // A retry can prove the same key after Worker rollout; never rotate here.
    throw proofFailure(proof,false);
  }
  return {status:"PROVISIONED",contract:CONTRACT,worker:WORKER};
}
