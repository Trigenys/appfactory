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
