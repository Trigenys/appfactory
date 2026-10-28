import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import {applyMissionCommand} from "./reference/command-center-mission-ledger.mjs";

// The canonical oracle is from EagleFox31/project-registry, NEVER compiled into the Worker.
const source=fs.readFileSync("src/d1-document-broker.ts","utf8");
const code=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
}}).outputText;
const {handleD1DocumentRequest}=await import("data:text/javascript;base64,"+
  Buffer.from(code).toString("base64"));

const repository="Trigenys/appfactory-smoke-test-20260914";
const now=new Date().toISOString();
const claims={
  repository,ref:"refs/heads/main",event_name:"workflow_dispatch",
  workflow_ref:repository+"/.github/workflows/command-center-runner-proof.yml@refs/heads/main",
  iss:"https://token.actions.githubusercontent.com",actor:"EagleFox31",
  run_id:"40694270657",run_attempt:"1",
};
const actor={id:"cc-smoke-gha-runner",role:"agent"};
const options={enabledExecutors:[actor.id],authorizedRepos:[repository]};
const goal={id:"smoke-approved",status:"approved",approvedAt:"2026-10-27T10:00:00Z",
  products:["smoke-test"],
  links:["https://github.com/"+repository+"/pull/4"]};
const goals={schemaVersion:1,revision:3,goals:[goal],events:[]};
const mission={
  id:"mission-real-bridge-smoke",goalId:goal.id,repository,
  kind:"github-executor",executorId:actor.id,status:"planned",
  createdAt:"2026-10-27T10:01:00Z",updatedAt:"2026-10-27T10:01:00Z",
  checkpoints:[],lease:null,nextEligibleAt:null,blockedReason:null,
  completedAt:null,conversationUrl:null,remainingQuota:null,quotaRenewsAt:null,
};
const ledger=()=>({schemaVersion:1,revision:1,events:[],missions:[structuredClone(mission)]});
const validLease="lease-parity-40694270657-a";
function fixture(start=ledger()){
  const docs=new Map([
    ["goals",{value:structuredClone(goals),version:2}],
    ["missions",{value:structuredClone(start),version:start.revision}],
  ]);
  let writes=0;
  const env={COMMAND_CENTER_RUNNER_ENABLED:"true",COMMAND_CENTER_DB:{
    prepare(sql){return {bind(...args){return {
      async first(){
        assert.match(sql,/^SELECT value, version FROM cc_documents WHERE id = \?$/);
        const found=docs.get(args[0]);
        return found?{value:JSON.stringify(found.value),version:found.version}:null;
      },
      async run(){
        assert.match(sql,/^UPDATE cc_documents SET value =/);
        const row=docs.get(args[3]);
        if(!row||row.version!==Number(args[4]))return {meta:{changes:0}};
        docs.set(args[3],{value:JSON.parse(args[0]),version:Number(args[1])});
        writes++;return {meta:{changes:1}};
      },
    };}};}
  }};
  const apply=async(type,payload,{
    eventId,expectedVersion,expectedRevision,
  }={})=>{
    const original=structuredClone(docs.get("missions")?.value);
    const version=docs.get("missions")?.version??0;
    const id=eventId??"ghrun-"+claims.run_id+"-"+claims.run_attempt+"-"+
      type+"-"+original.revision;
    const command={type,missionId:mission.id,eventId:id,
      expectedRevision:expectedRevision??original.revision,payload};
    const result=await handleD1DocumentRequest(
      env,claims,"refs/heads/main",{
        action:"mission-command",document:"missions",
        expectedVersion:expectedVersion??version,command,
      },async()=>{throw Error("Unexpected Cloudflare network fetch");});
    const actual=docs.get("missions").value;
    if(result.changes===1){
      const event=actual.events.at(-1);
      const reference=applyMissionCommand(original,{
        ...command,actor,at:event.at,
      },{...options,goalLedger:goals});
      assert.deepEqual(actual,reference,
        "AppFactory state or SHA-256 fingerprint differs from Project Registry reducer for "+type);
    }
    return {result,actual,original,command};
  };
  return {docs,env,apply,get writes(){return writes;}};
}
test("broker parity: acquire → before → after → heartbeat → pause → resume → complete",async()=>{
  const f=fixture();
  await f.apply("acquire",{leaseId:validLease,leaseSeconds:180});
  await f.apply("checkpoint",{leaseId:validLease,step:"create-branch",phase:"before"});
  await f.apply("checkpoint",{leaseId:validLease,step:"create-branch",phase:"after",
    commit:"a".repeat(40),nextAction:"Review existing PR"});
  await f.apply("heartbeat",{leaseId:validLease,leaseSeconds:180});
  await f.apply("pause",{leaseId:validLease,reason:"   manual verification   "});
  const newLease="lease-parity-40694270657-b";
  await f.apply("acquire",{leaseId:newLease,leaseSeconds:180});
  await f.apply("checkpoint",{leaseId:newLease,step:"open-pr",phase:"before"});
  await f.apply("checkpoint",{leaseId:newLease,step:"open-pr",phase:"after",
    pullRequest:"https://github.com/"+repository+"/pull/4"});
  await f.apply("complete",{leaseId:newLease});
  const m=f.docs.get("missions").value.missions[0];
  assert.equal(m.status,"completed");
  assert.equal(m.lease,null);
  assert.equal(m.checkpoints.length,4);
  assert.equal(f.writes,9);
  assert.equal(f.docs.get("goals").version,2);
});
test("same signed run event replay is idempotent even with old expectedRevision/version",async()=>{
  const f=fixture();
  const id="ghrun-"+claims.run_id+"-"+claims.run_attempt+"-stable-acquire";
  const first=await f.apply("acquire",{leaseId:validLease,leaseSeconds:180},{eventId:id});
  assert.equal(first.result.changes,1);
  const again=await f.apply("acquire",{leaseId:validLease,leaseSeconds:180},{
    eventId:id,expectedVersion:1,expectedRevision:1,
  });
  assert.equal(again.result.changes,0);
  assert.equal(f.docs.get("missions").version,2);
  assert.equal(f.writes,1);
});
test("canonical rejects oversized steps, blank nextAction and invalid proof",async()=>{
  const cases=[
    {step:"x".repeat(81),phase:"before"},
    {step:"review",phase:"before",nextAction:"   "},
    {step:"review",phase:"after",commit:"a".repeat(40)},
  ];
  for(const p of cases){
    const f=fixture();await f.apply("acquire",{leaseId:validLease,leaseSeconds:180});
    const before=f.writes;
    await assert.rejects(f.apply("checkpoint",{leaseId:validLease,...p}),
      /D1_MISSION_STATE_CONFLICT|Checkpoint|invalid|State/);
    assert.equal(f.writes,before);
  }
});
test("reclaim after owner-recorded expiry follows canonical reducer with checkpoint count",async()=>{
  const state=ledger();
  const expiredAt="2026-10-27T10:05:00Z";
  state.missions[0].status="interrupted";
  state.missions[0].blockedReason="lease-expired";
  state.missions[0].updatedAt=expiredAt;
  state.missions[0].checkpoints=[{
    step:"create-branch",phase:"before",at:"2026-10-27T10:03:00Z",
    commit:null,pullRequest:null,nextAction:"Inspect remote branch",
  }];
  state.revision=4;
  const f=fixture(state);
  const result=await f.apply("reclaim",{
    leaseId:validLease,leaseSeconds:180,observedCheckpointCount:1,
  });
  assert.equal(result.actual.missions[0].status,"running");
  assert.equal(result.actual.missions[0].checkpoints[0].phase,"before");
  assert.equal(f.writes,1);
  const other=fixture(state);
  await assert.rejects(other.apply("reclaim",{
    leaseId:validLease,leaseSeconds:180,observedCheckpointCount:0,
  }),/D1_MISSION_STATE_CONFLICT|Checkpoint/);
  assert.equal(other.writes,0);
});
