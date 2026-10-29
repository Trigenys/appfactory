import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source=fs.readFileSync("src/interservice-secret.ts","utf8");
const authSource=fs.readFileSync("src/auth.ts","utf8");
const router=fs.readFileSync("src/index.ts","utf8");
const transpile=s=>ts.transpileModule(s,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;
const {validateInterserviceInput,provisionInterserviceSecret}=await import(
  "data:text/javascript;base64,"+Buffer.from(transpile(source)).toString("base64")
);
const {authorizeInterserviceSecretClaims}=await import(
  "data:text/javascript;base64,"+Buffer.from(transpile(authSource)).toString("base64")
);
const repo="EagleFox31/atelier2026",ref="refs/heads/main";
const workflow=repo+"/.github/workflows/appfactory-interservice-secrets.yml@"+ref;
const claims={repository:repo,workflow_ref:workflow,event_name:"workflow_dispatch",ref};
const key="d".repeat(64);
const env={CLOUDFLARE_ACCOUNT_ID:"28007ba3301ed34cfeb04c2a19b68e9f"};
const body={contract:"atelier-notify:staging-v1",repository:repo,key};
function dependencies({existing=false,authenticated=true}={}){
  const writes=[],requests=[];
  return {writes,requests,
    listSecretNames:async(_env,worker)=>{
      assert.equal(worker,"trigenys-notify-staging-api");
      return new Set(existing?["ATELIER_NOTIFY_INGEST_KEY"]:[]);
    },
    putSecret:async(_env,worker,name,value)=>{
      writes.push({worker,name,value});
    },
    fetch:async(url,options)=>{
      requests.push({url,options});
      assert.equal(url,"https://trigenys-notify-staging-api.lawrynnjennifer.workers.dev/v1/dispatch/atelier/credential-check");
      assert.equal(options.headers["x-notify-auth"],key);
      return new Response(null,{status:authenticated?204:401});
    }
  };
}
test("OIDC scope requires exact repository, canonical workflow, main, manual event",()=>{
  assert.doesNotThrow(()=>authorizeInterserviceSecretClaims(claims,ref));
  for(const invalid of [
    {...claims,repository:"Trigenys/trigenys-notify"},
    {...claims,workflow_ref:workflow.replace("appfactory-interservice-secrets","deploy")},
    {...claims,workflow_ref:workflow.replace("refs/heads/main","refs/heads/dev")},
    {...claims,event_name:"pull_request"},
    {...claims,event_name:"push"},
    {...claims,ref:"refs/heads/dev"}
  ]){
    assert.throws(()=>authorizeInterserviceSecretClaims(invalid,ref));
  }
  assert.throws(()=>authorizeInterserviceSecretClaims(claims,"refs/heads/dev"));
  assert.match(authSource,/ENVIRONMENT:"production"/);
  assert.match(authSource,/verifyOidcToken\(request/);
});
test("strict non-selectable binding and target, strong key, default fail closed",()=>{
  assert.deepEqual(validateInterserviceInput(body,claims,env),body);
  for(const input of [
    {...body,worker:"appfactory-api"},
    {...body,secretName:"META_CLOUD_ACCESS_TOKEN"},
    {...body,accountId:"somewhere-else"},
    {...body,contract:"other"},
    {...body,repository:"Trigenys/trigenys-notify"},
    {...body,key:"short"},
    {...body,key:"G".repeat(64)},
    {...body,key:"d".repeat(65)},
    null,[],{}
  ])assert.throws(()=>validateInterserviceInput(input,claims,env));
  assert.throws(()=>validateInterserviceInput(body,{...claims,repository:"Trigenys/other"},env));
  assert.throws(()=>validateInterserviceInput(body,claims,{}));
});
test("first installation writes one Cloudflare secret and probes only the Notify private route",async()=>{
  const d=dependencies();
  const result=await provisionInterserviceSecret(env,claims,body,d);
  assert.equal(result.status,"PROVISIONED");
  assert.deepEqual(d.writes,[{
    worker:"trigenys-notify-staging-api",name:"ATELIER_NOTIFY_INGEST_KEY",value:key
  }]);
  assert.equal(d.requests.length,1);
  assert.equal(JSON.stringify(result).includes(key),false);
});
test("rerun does not overwrite existing secret and proves it matches AWS SSM key",async()=>{
  const d=dependencies({existing:true});
  const result=await provisionInterserviceSecret(env,claims,body,d);
  assert.equal(result.status,"ALREADY_CONFIGURED");
  assert.deepEqual(d.writes,[]);
  assert.equal(d.requests.length,1);
});
test("mismatched Worker key is never rotated or silently accepted",async()=>{
  const d=dependencies({existing:true,authenticated:false});
  await assert.rejects(provisionInterserviceSecret(env,claims,body,d),
    e=>e.status===409&&e.code==="SECRET_MISMATCH_OR_UNVERIFIED");
  assert.deepEqual(d.writes,[]);
});
test("post-write verification failures are safe to retry, with no secret echoed",async()=>{
  const d=dependencies({authenticated:false});
  await assert.rejects(provisionInterserviceSecret(env,claims,body,d),
    e=>e.status===503&&e.code==="SECRET_WRITTEN_PROOF_PENDING"&&!e.message.includes(key));
  assert.equal(d.writes.length,1);
});
test("API never returns credentials, logs payloads, or exposes arbitrary secret destinations",()=>{
  assert.match(router,/url.pathname === "\/infrastructure\/interservice-secret"/);
  assert.match(router,/authenticateInterserviceSecret\(request,env\)/);
  assert.doesNotMatch(source,/console\.(log|error|warn)/);
  assert.doesNotMatch(router,/console\.log\(.*interservice/i);
});
