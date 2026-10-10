import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readWowRegistry } from "../ui-registry/wow-contract.mjs";
import {
  validateWowBrief, planWowFrontend, dryRunWowBriefFiles
} from "../scripts/wow-frontend-plan.mjs";

const read = (p) => fs.readFileSync(p,"utf8");
const clone = (x) => structuredClone(x);
const briefPath = "skills/wow-frontend/examples/commerce-factory.brief.json";
const consumerPath = "ui-registry/examples/wow-react-vite-css.json";
const brief = JSON.parse(read(briefPath));
const consumer = JSON.parse(read(consumerPath));
const inventory = readWowRegistry();
const policy = JSON.parse(read("ui-registry/wow-review-policy.json"));
const run = (b = brief,c = consumer,p = policy,i = inventory) =>
  planWowFrontend({brief:b,consumer:c,inventory:i,policy:p});

test("SKILL.md has discoverable metadata, required workflow and linked reference files", () => {
  const content = read("skills/wow-frontend/SKILL.md");
  assert.match(content,/^---\nname: wow-frontend\ndescription: /);
  assert.match(content,/SEARCH BEFORE BUILD/);
  assert.match(content,/RENDER BEFORE DONE/);
  assert.match(content,/prefers-reduced-motion/);
  assert.match(content,/RAIDER/);
  assert.match(content,/NO CODE COPY|do not copy/i);
  assert.match(content,/ui-registry\/wow-sources\.json/);
  assert.match(content,/ui-registry\/wow-review-policy\.json/);
  assert.match(content,/source.selection|source-selection/);
  for (const ref of ["source-selection.md","composition.md","motion.md","visual-qa.md"]) {
    const linked = "references/" + ref;
    assert.ok(content.includes(linked),linked + " not linked");
    assert.ok(fs.existsSync("skills/wow-frontend/" + linked),linked + " missing");
    const info = read("skills/wow-frontend/" + linked);
    assert.ok(info.length > 500, linked + " lacks actionable instructions");
  }
});

test("dry run uses real Commerce Factory planning fixture but does not mutate source files", () => {
  const before = [briefPath,consumerPath,"ui-registry/wow-sources.json",
    "ui-registry/wow-review-policy.json"].map((p) =>
      crypto.createHash("sha256").update(read(p)).digest("hex"));
  assert.deepEqual(validateWowBrief(brief),[]);
  const output = dryRunWowBriefFiles(briefPath,consumerPath);
  assert.equal(output.ok,true);
  assert.equal(output.status,"PLAN_ONLY");
  assert.equal(output.mode,"DRY_RUN");
  assert.equal(output.project,"Trigenys Commerce Factory");
  assert.equal(output.repository,"Trigenys/trigenys-commerce-factory");
  assert.equal(output.unchangedStack.framework,"react-vite");
  assert.equal(output.unchangedStack.styling,"css");
  assert.deepEqual(output.languages,["fr","en"]);
  assert.equal(output.operationsAllowed,false);
  assert.equal(output.guardrails.thirdPartyCodeCopy,false);
  assert.equal(output.guardrails.thirdPartyComponentInstall,false);
  assert.equal(output.evidence.browserScreenshots,"NOT RUN");
  assert.equal(output.evidence.deployment,"NOT VERIFIED");
  assert.ok(output.steps.length >= 8);
  assert.ok(output.steps.every((x) => x.status === "NOT RUN"));
  assert.equal(output.sources.length,consumer.sources.allow.length);
  assert.equal(output.adapterResolutions.length,consumer.sources.allow.length);
  assert.ok(output.adapterResolutions.every((x) => x.actions.installAutomatically === false));
  assert.ok(output.adapterResolutions.every((x) => x.actions.executeRemote === false));
  for (const source of output.sources) {
    assert.equal(source.mode,"reference-only");
    assert.equal(source.installAllowed,false);
    assert.equal(source.codeReuseAllowed,false);
    assert.equal(source.legalReuseDecision,"NO CODE COPY / NO INSTALL / NO EXECUTION");
  }
  const after = [briefPath,consumerPath,"ui-registry/wow-sources.json",
    "ui-registry/wow-review-policy.json"].map((p) =>
      crypto.createHash("sha256").update(read(p)).digest("hex"));
  assert.deepEqual(after,before);
});

test("command-line dry run emits valid JSON without executing builds, network or writing files", () => {
  const script = read("scripts/wow-frontend-plan.mjs");
  assert.doesNotMatch(script,/\b(?:writeFileSync|writeFile|spawn|execSync|fetch\s*\(|axios|import\s*\([^)]*https?:|child_process)\b/);
  const stdout = execFileSync(process.execPath,["scripts/wow-frontend-plan.mjs",briefPath,consumerPath],{
    encoding:"utf8",timeout:10000
  });
  const report = JSON.parse(stdout);
  assert.equal(report.ok,true);
  assert.equal(report.mode,"DRY_RUN");
  assert.equal(report.status,"PLAN_ONLY");
});

test("the skill rejects fabricated proof and unsupported configs before planning", () => {
  const evil = clone(brief);
  evil.constraints.truthfulProofOnly = false;
  evil.constraints.merchants = "publicize-real-partners";
  evil.canRunCommands = true;
  const report = run(evil);
  assert.equal(report.ok,false);
  assert.match(report.errors.join(" "),/truthfulProofOnly/);
  assert.match(report.errors.join(" "),/merchant branding/);
  assert.match(report.errors.join(" "),/unknown brief field/);
  assert.deepEqual(report.steps,[]);
  assert.deepEqual(report.sources,[]);
});

test("source discovery fails closed for unknown source, untrusted approval or forced installation", () => {
  const bad = clone(consumer);
  bad.sources.allow = ["unknown-plugin"];
  assert.equal(run(brief,bad).ok,false);
  const badMode = clone(consumer);
  badMode.sources.mode = "install";
  assert.match(run(brief,badMode).errors.join(" "),/reference-only/);
  const corrupt = clone(policy);
  corrupt.defaultDisposition = "install-all";
  const report = run(brief,consumer,corrupt);
  assert.equal(report.ok,false);
  assert.match(report.errors.join(" "),/defaultDisposition/);
});

test("a configured but disabled consumer produces no source plan or side effects", () => {
  const disabled = {version:1,enabled:false};
  const result = run(brief,disabled);
  assert.equal(result.ok,true);
  assert.equal(result.status,"DISABLED");
  assert.deepEqual(result.sources,[]);
  assert.deepEqual(result.steps,[]);
  assert.equal(result.operationsAllowed,false);
});

test("different product language and stack stay supported without Commerce Factory-specific assumptions", () => {
  const project = clone(brief);
  project.project = "Roadmap Mentor";
  project.repository = "Trigenys/roadmap-mentor";
  project.constraints.languages = ["fr"];
  delete project.constraints.merchants;
  const config = clone(consumer);
  config.stack.framework = "vue-vite";
  config.stack.styling = "css";
  const result = run(project,config);
  assert.equal(result.ok,true);
  assert.equal(result.unchangedStack.framework,"vue-vite");
  assert.deepEqual(result.languages,["fr"]);
  assert.ok(result.sources.some((s) => s.compatibility === "design-reference"));
  assert.ok(result.sources.every((s) => s.installAllowed === false));
});

test("source selection and visual QA references explicitly distinguish planned from verified", () => {
  const selection = read("skills/wow-frontend/references/source-selection.md");
  const visual = read("skills/wow-frontend/references/visual-qa.md");
  const composition = read("skills/wow-frontend/references/composition.md");
  const motion = read("skills/wow-frontend/references/motion.md");
  assert.match(selection,/reference-only/);
  assert.match(selection,/zero approvals/);
  assert.match(selection,/no code copy|no code.*install/i);
  assert.match(visual,/NOT RUN/);
  assert.match(visual,/browser|Playwright/);
  assert.match(composition,/FR\/EN/);
  assert.match(motion,/prefers-reduced-motion/);
  assert.match(motion,/scroll-jacking/);
});
