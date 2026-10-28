import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const code = fs.readFileSync("src/d1-document-broker.ts","utf8");
const src = ts.transpileModule(code,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
}}).outputText;
const {handleD1DocumentRequest,authorizeD1DocumentClaims} =
  await import("data:text/javascript;base64,"+Buffer.from(src).toString("base64"));
const env={CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_PAGES_D1_TOKEN:"dummy-not-a-real-key"};
const repository="EagleFox31/project-registry",ref="refs/heads/main";
const valid=(workflow="refresh.yml",event_name="push")=>({
  repository,ref,event_name,
  workflow_ref:repository+"/.github/workflows/"+workflow+"@"+ref,
});
const json=(value)=>new Response(JSON.stringify({
  success:true,result:[{success:true,...value}],
}),{status:200,headers:{"Content-Type":"application/json"}});
const audit={generatedAt:"2026-10-26T08:00:00Z",projects:[]};
function mockApi(existing=null){
  const state={value:existing,version:existing===null?null:3,calls:[]};
  async function fetchImpl(url,init){
    const request=JSON.parse(init.body);state.calls.push(request);
    assert.match(url,/\/d1\/database\/bf1864e7-5f64-4063-8761-38bcbb6a8437\/query$/);
    assert.equal(init.headers.Authorization,"Bearer "+env.CLOUDFLARE_PAGES_D1_TOKEN);
    if(request.sql.startsWith("SELECT")) {
      return json({results:state.version===null?[]:[{
        value:JSON.stringify(state.value),version:state.version,
      }]});
    }
    if(request.sql.startsWith("INSERT")) {
      if(state.version!==null)return json({results:[],meta:{changes:0}});
      state.value=JSON.parse(request.params[1]);state.version=0;
      return json({results:[],meta:{changes:1}});
    }
    if(request.sql.startsWith("UPDATE")) {
      if(state.version!==Number(request.params[4]))return json({results:[],meta:{changes:0}});
      state.value=JSON.parse(request.params[0]);state.version++;
      return json({results:[],meta:{changes:1}});
    }
    throw new Error("unknown SQL");
  }
  return {state,fetchImpl};
}
test("RAIDER OIDC grants are pinned to exact repository, workflow, event and main",()=>{
  assert.ok(authorizeD1DocumentClaims(valid(),ref));
  assert.ok(authorizeD1DocumentClaims(valid("command-center-reports.yml","schedule"),ref));
  for (const bad of [
    {...valid(),repository:"Trigenys/appfactory"},
    {...valid(),ref:"refs/heads/feature"},
    {...valid(),event_name:"pull_request"},
    {...valid(),workflow_ref:repository+"/.github/workflows/ci.yml@"+ref},
    {...valid(),workflow_ref:repository+"/.github/workflows/refresh.yml@refs/heads/dev"},
  ]) assert.throws(()=>authorizeD1DocumentClaims(bad,ref),/trusted main-branch/);
});
test("canonical goals are read-only for GitHub workflows",async()=>{
  const f=mockApi({schemaVersion:1,revision:2,goals:[],events:[]});
  const read=await handleD1DocumentRequest(env,valid(),ref,{action:"read",document:"goals"},f.fetchImpl);
  assert.equal(read.exists,true);assert.equal(read.value.revision,2);
  await assert.rejects(handleD1DocumentRequest(env,valid(),ref,{
    action:"put",document:"goals",expectedVersion:3,
    value:{schemaVersion:1,revision:0,goals:[],events:[]},
  },f.fetchImpl),e=>e.code==="D1_DOCUMENT_PERMISSION_DENIED");
  assert.equal(f.state.calls.length,1);
});
test("audit can be inserted once and then conditionally updated using D1 CAS",async()=>{
  const f=mockApi();
  const first=await handleD1DocumentRequest(env,valid(),ref,{
    action:"put",document:"audit",expectedVersion:null,value:audit,
  },f.fetchImpl);
  assert.equal(first.changes,1);
  const repeat=await handleD1DocumentRequest(env,valid(),ref,{
    action:"put",document:"audit",expectedVersion:null,value:audit,
  },f.fetchImpl);
  assert.equal(repeat.changes,0);
  const next=await handleD1DocumentRequest(env,valid(),ref,{
    action:"put",document:"audit",expectedVersion:0,
    value:{...audit,generatedAt:"2026-10-26T09:00:00Z"},
  },f.fetchImpl);
  assert.equal(next.changes,1);
  assert.equal(f.state.version,1);
});
test("invalid keys, arbitrary SQL, extra fields and forged target database are rejected",async()=>{
  const f=mockApi();
  for(const body of [
    {action:"query",document:"audit",sql:"DROP TABLE cc_documents"},
    {action:"read",document:"audit",databaseId:"attacker"},
    {action:"read",document:"secrets"},
    {action:"put",document:"audit",expectedVersion:null,value:{arbitrary:true}},
  ]) await assert.rejects(handleD1DocumentRequest(env,valid(),ref,body,f.fetchImpl));
  assert.equal(f.state.calls.length,0);
});
test("already finalized reports cannot be downgraded to drafts",async()=>{
  const done={
    schemaVersion:1,id:"command-center:weekly-plan:week:2026-10-26",
    generatedAt:"2026-10-26T08:00:00Z",lifecycle:"sent",
    audiences:{ownerPrivate:{},team:{autoSend:false}},
  };
  const f=mockApi([done]);
  await assert.rejects(handleD1DocumentRequest(env,valid(),ref,{
    action:"put",document:"reports",expectedVersion:3,
    value:[{...done,lifecycle:"draft"}],
  },f.fetchImpl),e=>e.code==="D1_DOCUMENT_FINALIZED");
});
test("provider credentials are held by AppFactory only, not forwarded to callers",async()=>{
  const f=mockApi();
  const res=await handleD1DocumentRequest(env,valid(),ref,{
    action:"read",document:"audit",
  },f.fetchImpl);
  assert.equal(res.exists,false);
  assert.equal(JSON.stringify(res).includes(env.CLOUDFLARE_PAGES_D1_TOKEN),false);
});
test("router verifies OIDC before handling any private D1 document",()=>{
  const index=fs.readFileSync("src/index.ts","utf8");
  const auth=fs.readFileSync("src/auth.ts","utf8");
  assert.match(index,/authenticateD1Documents\(request, env\)/);
  assert.match(index,/handleD1DocumentRequest\(env, claims, expectedRef, body\)/);
  assert.match(auth,/return verifyOidcToken\(request,/);
  assert.doesNotMatch(index,/D1_DOCUMENT.*?console.log/);
});

test("native D1 binding serves allowed documents without any Cloudflare API token",async()=>{
  const current={schemaVersion:1,revision:3,goals:[],events:[]};
  const calls=[];
  const envWithBinding={
    COMMAND_CENTER_DB:{
      prepare(sql){return {bind(...params){calls.push({sql,params});return {
        async first(){return {value:JSON.stringify(current),version:3};},
        async run(){return {meta:{changes:1}};},
      };}};},
    },
  };
  const failFetch=async()=>{throw new Error("Cloudflare REST must not be called");};
  const result=await handleD1DocumentRequest(envWithBinding,valid(),ref,
    {action:"read",document:"goals"},failFetch);
  assert.equal(result.value.revision,3);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/SELECT value, version FROM cc_documents/);
  const put=await handleD1DocumentRequest(envWithBinding,valid(),ref,
    {action:"put",document:"audit",expectedVersion:3,
      value:{generatedAt:"2026-10-26T11:56:00Z",projects:[]}},failFetch);
  assert.equal(put.changes,1);
  assert.equal(calls.some(x=>x.sql.startsWith("UPDATE")),true);
});

test("mission preflight is explicit, main-only and never a write grant",async()=>{
  const workflow="command-center-mission-preflight.yml";
  const caller=valid(workflow,"workflow_dispatch");
  assert.ok(authorizeD1DocumentClaims(caller,ref));
  const sample={schemaVersion:1,revision:1,missions:[{
    id:"approved-mission",goalId:"g1",status:"planned",checkpoints:[],
  }],events:[]};
  const f=mockApi(sample);
  const read=await handleD1DocumentRequest(env,caller,ref,{
    action:"read",document:"missions",
  },f.fetchImpl);
  assert.equal(read.value.missions[0].id,"approved-mission");
  assert.equal(f.state.calls.length,1);
  await assert.rejects(handleD1DocumentRequest(env,caller,ref,{
    action:"put",document:"missions",expectedVersion:3,value:sample,
  },f.fetchImpl),e=>e.code==="D1_DOCUMENT_PERMISSION_DENIED");
  assert.equal(f.state.calls.length,1);

  for(const rejected of [
    valid("refresh.yml","push"),
    valid("command-center-reports.yml","schedule"),
    valid("command-center-reports.yml","workflow_dispatch"),
  ]){
    await assert.rejects(handleD1DocumentRequest(env,rejected,ref,{
      action:"read",document:"missions",
    },f.fetchImpl),e=>e.code==="D1_DOCUMENT_PERMISSION_DENIED");
  }
  assert.equal(f.state.calls.length,1);
  for(const bad of [
    valid(workflow,"push"),
    valid(workflow,"pull_request"),
    {...caller,ref:"refs/heads/feature"},
    {...caller,workflow_ref:repository+"/.github/workflows/"+workflow+"@refs/heads/dev"},
  ]){
    assert.throws(()=>authorizeD1DocumentClaims(bad,ref),/trusted main-branch/);
  }
});


const smokeRepo="Trigenys/appfactory-smoke-test-20260914";
const smokeClaims={
  ...valid("command-center-runner-proof.yml","workflow_dispatch"),
  repository:smokeRepo,ref,
  workflow_ref:smokeRepo+"/.github/workflows/command-center-runner-proof.yml@"+ref,
  actor:"EagleFox31",iss:"https://token.actions.githubusercontent.com",
};
const smokeGoal={
  id:"approved-test-goal",status:"approved",approvedAt:"2026-10-28T09:00:00Z",
  products:["smoke-test"],
  links:["https://github.com/Trigenys/appfactory-smoke-test-20260914/issues/1"],
};
const smokeMission={
  id:"mission-bot-smoke",goalId:smokeGoal.id,repository:smokeRepo,
  kind:"github-executor",executorId:"cc-smoke-gha-runner",
  status:"planned",createdAt:"2026-10-28T09:01:00Z",
  updatedAt:"2026-10-28T09:01:00Z",
  checkpoints:[],lease:null,nextEligibleAt:null,blockedReason:null,
  completedAt:null,conversationUrl:null,remainingQuota:null,quotaRenewsAt:null,
};
function scopedD1(){
  const records=new Map([
    ["goals",{value:{schemaVersion:1,revision:1,goals:[smokeGoal],events:[]},version:2}],
    ["missions",{value:{schemaVersion:1,revision:1,missions:[smokeMission],events:[]},version:1}],
  ]);
  const queries=[];
  const e={...env,COMMAND_CENTER_RUNNER_ENABLED:"true",COMMAND_CENTER_DB:{
    prepare(sql){return{bind(...params){return{
      async first(){
        queries.push({sql,params});
        const record=records.get(params[0]);
        return record?{value:JSON.stringify(record.value),version:record.version}:null;
      },
      async run(){
        queries.push({sql,params});
        if(!sql.startsWith("UPDATE cc_documents"))throw Error("No direct inserts");
        const prior=records.get(params[3]);
        if(!prior || prior.version!==Number(params[4]))
          return {meta:{changes:0}};
        records.set(params[3],{value:JSON.parse(params[0]),version:Number(params[1])});
        return {meta:{changes:1}};
      },
    };}};}
  }};
  const send=(type,payload,{claims=smokeClaims,eventId="event-ccsmoke-"+type,expectedVersion,expectedRevision}={})=>{
    const doc=records.get("missions");
    return handleD1DocumentRequest(e,claims,ref,{
      action:"mission-command",document:"missions",
      expectedVersion:expectedVersion??doc?.version??0,
      command:{type,missionId:smokeMission.id,
        eventId,expectedRevision:expectedRevision??doc?.value.revision??0,
        payload},
    },async()=>{throw Error("Cloudflare REST unexpectedly used");});
  };
  return {records,queries,e,send};
}
const smokeLease="lease-ccsmoke-20261028-a";
test("smoke runner identity is exact, isolated and has no generic D1 document rights",async()=>{
  const f=scopedD1();
  const fields={leaseId:smokeLease,leaseSeconds:180};
  for(const claims of [
    {...smokeClaims,actor:"not-owner"},
    {...smokeClaims,repository:repository},
    {...smokeClaims,workflow_ref:smokeRepo+"/.github/workflows/untrusted.yml@"+ref},
    {...smokeClaims,event_name:"push"},
    {...smokeClaims,ref:"refs/heads/other"},
    {...smokeClaims,iss:"invalid"},
  ]) await assert.rejects(f.send("acquire",fields,{claims}),/trusted|forbidden|Forbidden|runner|main-branch|CALLER/iu);
  assert.equal(f.queries.length,0);
  await assert.rejects(f.send("acquire",fields,{claims:valid("refresh.yml","push")}),/forbidden|runner|trusted/iu);
  assert.equal(f.queries.length,0);
  for(const action of [
    {action:"read",document:"missions"},
    {action:"put",document:"missions",expectedVersion:1,value:f.records.get("missions").value},
    {action:"read",document:"goals"},
    {action:"put",document:"audit",expectedVersion:0,value:audit},
  ]) await assert.rejects(handleD1DocumentRequest(f.e,smokeClaims,ref,action),
    e=>e.code==="D1_DOCUMENT_PERMISSION_DENIED");
  assert.equal(f.queries.length,0);
});

test("disabled feature flag denies runner write before any D1 access",async()=>{
 const f=scopedD1();
 const disabled={...f.e,COMMAND_CENTER_RUNNER_ENABLED:undefined};
 await assert.rejects(handleD1DocumentRequest(disabled,smokeClaims,ref,{
   action:"mission-command",document:"missions",expectedVersion:1,
   command:{type:"acquire",eventId:"event-disabled-1",
    missionId:smokeMission.id,expectedRevision:1,
    payload:{leaseId:smokeLease,leaseSeconds:180}},
 }),e=>e.code==="D1_MISSION_RUNNER_FORBIDDEN");
 assert.equal(f.queries.length,0);
});

test("approved registered smoke mission acquires one CAS lease, checkpoints and finishes",async()=>{
 const f=scopedD1();
 const acquire=await f.send("acquire",{leaseId:smokeLease,leaseSeconds:180});
 assert.equal(acquire.changes,1);
 const lease=f.records.get("missions");
 assert.equal(lease.value.missions[0].status,"running");
 assert.equal(lease.value.missions[0].lease.owner,"cc-smoke-gha-runner");
 assert.equal(lease.version,2);
 const retry=await f.send("acquire",{leaseId:smokeLease,leaseSeconds:180},
  {eventId:"event-ccsmoke-acquire",expectedVersion:2,expectedRevision:2});
 assert.equal(retry.changes,0);
 assert.equal(f.records.get("missions").version,2);
 const before=await f.send("checkpoint",{
  leaseId:smokeLease,step:"create-branch",phase:"before"});
 assert.equal(before.changes,1);
 const after=await f.send("checkpoint",{
  leaseId:smokeLease,step:"create-branch",phase:"after",
  commit:"a".repeat(40)},{eventId:"event-ccsmoke-after-branch"});
 assert.equal(after.changes,1);
 const complete=await f.send("complete",{leaseId:smokeLease});
 assert.equal(complete.changes,1);
 const finished=f.records.get("missions").value.missions[0];
 assert.equal(finished.status,"completed");
 assert.equal(finished.lease,null);
 assert.equal(finished.checkpoints.length,2);
 assert.deepEqual(f.queries.filter(x=>x.sql.startsWith("UPDATE")).map(x=>x.params[3]),
  ["missions","missions","missions","missions"]);
 assert.equal(f.records.get("goals").version,2);
});

test("CAS races, invalid goal, absent mission and lease forgery are rejected without modification",async()=>{
 const f=scopedD1();
 const stale=await f.send("acquire",{leaseId:smokeLease,leaseSeconds:180},{
   expectedVersion:0,expectedRevision:1});
 assert.equal(stale.changes,0);
 assert.equal(f.records.get("missions").version,1);
 await assert.rejects(f.send("checkpoint",{leaseId:smokeLease,step:"x",phase:"before"}),
  e=>e.code==="D1_MISSION_STATE_CONFLICT");
 await assert.rejects(f.send("acquire",{leaseId:smokeLease,leaseSeconds:9999}),
  e=>e.code==="D1_MISSION_STATE_CONFLICT");
 await assert.rejects(f.send("acquire",{leaseId:smokeLease,leaseSeconds:180},{
   claims:{...smokeClaims,actor:"stranger"}}),e=>e.code==="D1_MISSION_RUNNER_FORBIDDEN");
 f.records.delete("missions");
 await assert.rejects(f.send("acquire",{leaseId:smokeLease,leaseSeconds:180}),
  e=>e.code==="D1_MISSION_UNREGISTERED");
 assert.equal(f.queries.some(x=>x.sql.startsWith("INSERT")),false);
 f.records.set("missions",{value:{schemaVersion:1,revision:1,missions:[smokeMission],events:[]},version:1});
 f.records.set("goals",{value:{schemaVersion:1,revision:2,goals:[],events:[]},version:3});
 await assert.rejects(f.send("acquire",{leaseId:smokeLease,leaseSeconds:180}),
   e=>e.code==="D1_MISSION_NOT_APPROVED");
 assert.equal(f.records.get("missions").version,1);
});
