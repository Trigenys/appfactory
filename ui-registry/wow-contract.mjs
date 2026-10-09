import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const TOKEN = /^[a-z][a-z0-9-]{0,47}$/;
const KINDS = new Set(["mcp","component","block","guidelines"]);
const RISKS = new Set(["low","medium","high"]);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keysOnly = (v, allowed, prefix, errors) => {
  for (const key of Object.keys(v)) if (!allowed.includes(key)) errors.push(prefix + ": unknown " + key);
};
const properRepo = (value) => {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "github.com" && !u.username &&
      !u.password && !u.search && !u.hash && !u.port &&
      /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(u.pathname);
  } catch { return false; }
};
const stringList = (items, label, errors) => {
  if (!Array.isArray(items) || items.length === 0) {
    errors.push(label + " must be a nonempty array"); return;
  }
  const seen = new Set();
  for (const item of items) {
    if (typeof item !== "string" || !TOKEN.test(item)) errors.push(label + " has invalid token");
    if (seen.has(item)) errors.push(label + " has duplicate token");
    seen.add(item);
  }
};

// Distinct from existing ui-registry/registry.json, which is the native component catalog.
// This is research metadata; V1 permits no source-code copying, installation or execution.
export function validateWowSources(data) {
  const errors = [];
  if (!isObject(data)) return ["source inventory must be an object"];
  keysOnly(data, ["version","purpose","description","sources"], "inventory", errors);
  if (data.version !== 1) errors.push("inventory.version must be 1");
  if (data.purpose !== "discovery-only") errors.push("inventory.purpose must be discovery-only");
  if (typeof data.description !== "string" || !data.description.trim()) errors.push("inventory.description required");
  if (!Array.isArray(data.sources) || !data.sources.length) return [...errors,"inventory.sources required"];
  const seen = new Set();
  data.sources.forEach((source,index) => {
    const name = "sources[" + index + "]";
    if (!isObject(source)) { errors.push(name + " must be an object"); return; }
    keysOnly(source,["id","repository","kind","frameworks","styling","license",
      "reuse","reviewedCommit","executionAllowed","risk","reviewedOn"],name,errors);
    if (typeof source.id !== "string" || !ID.test(source.id)) errors.push(name + ".id invalid");
    else { if (seen.has(source.id)) errors.push("duplicate source id " + source.id); seen.add(source.id); }
    if (!properRepo(source.repository)) errors.push(name + ".repository invalid");
    if (!KINDS.has(source.kind)) errors.push(name + ".kind invalid");
    stringList(source.frameworks,name + ".frameworks",errors);
    stringList(source.styling,name + ".styling",errors);
    if (!isObject(source.license)) errors.push(name + ".license required");
    else {
      keysOnly(source.license,["spdx","verification"],name + ".license",errors);
      if (source.license.spdx !== null &&
          (typeof source.license.spdx !== "string" || !/^[A-Za-z0-9.+-]{2,40}$/.test(source.license.spdx)))
        errors.push(name + ".license.spdx invalid");
      if (!["metadata-only","unverified"].includes(source.license.verification))
        errors.push(name + ".license.verification invalid");
      if (source.license.verification === "unverified" && source.license.spdx !== null)
        errors.push(name + ".license must use null SPDX when unverified");
    }
    if (source.reuse !== "reference-only") errors.push(name + ".reuse: only reference-only allowed in v1");
    if (source.reviewedCommit !== null) errors.push(name + ".reviewedCommit must be null in v1");
    if (source.executionAllowed !== false) errors.push(name + ".executionAllowed must be false");
    if (!RISKS.has(source.risk)) errors.push(name + ".risk invalid");
    if (typeof source.reviewedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(source.reviewedOn) ||
        Number.isNaN(Date.parse(source.reviewedOn + "T00:00:00Z")))
      errors.push(name + ".reviewedOn invalid");
  });
  return errors;
}

const LIMITS = {
  desktopViewport:[800,3840,true], mobileViewport:[320,768,true],
  maxLcpMs:[100,10000,true], maxCls:[0,1,false], maxTotalBlockingTimeMs:[0,5000,true]
};

// V1 is optional and read-only. Enabling it cannot change the consumer's build stack.
export function validateWowConsumer(data,inventory) {
  const inventoryErrors = validateWowSources(inventory);
  if (inventoryErrors.length) return inventoryErrors.map((x) => "invalid inventory: " + x);
  const errors = [];
  if (!isObject(data)) return ["consumer contract must be an object"];
  keysOnly(data,["version","enabled","profile","stack","sources","motion","quality"],"consumer",errors);
  if (data.version !== 1) errors.push("consumer.version must be 1");
  if (typeof data.enabled !== "boolean") errors.push("consumer.enabled must be boolean");
  if (data.enabled === false && Object.keys(data).length === 2) return errors;
  if (typeof data.profile !== "string" || !TOKEN.test(data.profile)) errors.push("consumer.profile invalid");
  if (!isObject(data.stack)) errors.push("consumer.stack required");
  else {
    keysOnly(data.stack,["framework","styling","typescript"],"consumer.stack",errors);
    if (typeof data.stack.framework !== "string" || !TOKEN.test(data.stack.framework))
      errors.push("consumer.stack.framework invalid");
    if (typeof data.stack.styling !== "string" || !TOKEN.test(data.stack.styling))
      errors.push("consumer.stack.styling invalid");
    if (typeof data.stack.typescript !== "boolean") errors.push("consumer.stack.typescript invalid");
  }
  if (!isObject(data.sources)) errors.push("consumer.sources required");
  else {
    keysOnly(data.sources,["mode","allow"],"consumer.sources",errors);
    if (data.sources.mode !== "reference-only") errors.push("consumer.sources.mode must be reference-only");
    if (!Array.isArray(data.sources.allow)) errors.push("consumer.sources.allow must be array");
    else {
      const known = new Set(inventory.sources.map((s) => s.id)), seen = new Set();
      for (const id of data.sources.allow) {
        if (typeof id !== "string" || !ID.test(id)) errors.push("invalid allowed source id");
        else {
          if (!known.has(id)) errors.push("unknown source: " + id);
          if (seen.has(id)) errors.push("duplicate allowed source: " + id);
          seen.add(id);
        }
      }
    }
  }
  if (!isObject(data.motion)) errors.push("consumer.motion required");
  else {
    keysOnly(data.motion,["mode","reducedMotion"],"consumer.motion",errors);
    if (!["none","intentional"].includes(data.motion.mode)) errors.push("consumer.motion.mode invalid");
    if (data.motion.reducedMotion !== "required") errors.push("reducedMotion must be required");
  }
  if (data.quality !== undefined) {
    if (!isObject(data.quality)) errors.push("consumer.quality must be object");
    else {
      keysOnly(data.quality,[...Object.keys(LIMITS),"requireKeyboardPass","requireNoHorizontalOverflow"],"consumer.quality",errors);
      for (const [key,[min,max,integer]] of Object.entries(LIMITS)) {
        if (data.quality[key] === undefined) continue;
        const value = data.quality[key];
        if (typeof value !== "number" || !Number.isFinite(value) || value < min ||
          value > max || (integer && !Number.isInteger(value)))
          errors.push("consumer.quality." + key + " invalid");
      }
      for (const key of ["requireKeyboardPass","requireNoHorizontalOverflow"])
        if (data.quality[key] !== undefined && data.quality[key] !== true)
          errors.push("consumer.quality." + key + " cannot be disabled");
    }
  }
  return errors;
}

export function previewWowSources(consumer,inventory) {
  const errors = validateWowConsumer(consumer,inventory);
  if (errors.length) return {ok:false,errors,sources:[]};
  if (!consumer.enabled) return {ok:true,errors:[],sources:[]};
  const framework = consumer.stack.framework;
  const family = framework.startsWith("react-") ? "react" : framework.split("-")[0];
  return {ok:true,errors:[],sources:consumer.sources.allow.map((id) => {
    const item = inventory.sources.find((source) => source.id === id);
    const frameworkMatch = item.frameworks.includes("any") || item.frameworks.includes(family);
    const styleMatch = item.styling.includes("any") || item.styling.includes(consumer.stack.styling);
    return {id,mode:"reference-only",installAllowed:false,codeReuseAllowed:false,
      compatibility:!frameworkMatch ? "design-reference" : styleMatch ? "native-reference" : "adaptation-reference"};
  })};
}

export function readWowRegistry() {
  return JSON.parse(fs.readFileSync(path.join(ROOT,"wow-sources.json"),"utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const registry = readWowRegistry();
  const result = process.argv[2]
    ? previewWowSources(JSON.parse(fs.readFileSync(path.resolve(process.argv[2]),"utf8")),registry)
    : (() => { const errors = validateWowSources(registry); return {ok:!errors.length,errors,sources:registry.sources.length}; })();
  process.stdout.write(JSON.stringify(result,null,2) + "\n");
  if (!result.ok) process.exitCode = 1;
}
