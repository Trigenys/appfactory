import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { previewWowSources, validateWowSources } from "./wow-contract.mjs";
import { validateWowReviewPolicy, wowSourceDisposition } from "./wow-security.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const INTERFACES = new Set(["external-tool","component-pattern","registry-block","guidance"]);
const RUNTIMES = new Set(["none","motion","gsap","three"]);
const KINDS = {
  mcp:"external-tool",
  component:"component-pattern",
  block:"registry-block",
  guidelines:"guidance"
};
const safeToken = /^[a-z0-9][a-z0-9-]{1,63}$/;
const keysOnly = (value, allowed, name, errors) => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(name + ": unexpected field " + key);
  }
};

export function readWowAdapters() {
  return JSON.parse(fs.readFileSync(path.join(DIR,"wow-adapters.json"),"utf8"));
}

// Verify that the adapter layer describes ONLY the sources in the immutable
// discovery inventory. No source can insert commands, URLs or permissions here.
export function validateWowAdapters(data, inventory) {
  const errors = validateWowSources(inventory);
  if (errors.length) return errors.map((e) => "invalid source inventory: " + e);
  if (!isObject(data)) return ["adapter inventory must be an object"];
  keysOnly(data,["version","description","adapters"],"adapter inventory",errors);
  if (data.version !== 1) errors.push("adapter inventory.version must be 1");
  if (typeof data.description !== "string" || !data.description.trim()) errors.push("adapter inventory.description required");
  if (!Array.isArray(data.adapters)) return [...errors,"adapter inventory.adapters must be an array"];
  const byId = new Map(inventory.sources.map((s) => [s.id,s]));
  const seen = new Set();
  data.adapters.forEach((adapter,index) => {
    const label = "adapters[" + index + "]";
    if (!isObject(adapter)) {errors.push(label + " must be an object");return;}
    keysOnly(adapter,[
      "sourceId","interfaceKind","optionalService","motionHints","executable","autoInstall","notes"
    ],label,errors);
    if (typeof adapter.sourceId !== "string" || !safeToken.test(adapter.sourceId))
      errors.push(label + ".sourceId invalid");
    if (seen.has(adapter.sourceId)) errors.push(label + " duplicate adapter " + adapter.sourceId);
    seen.add(adapter.sourceId);
    const source = byId.get(adapter.sourceId);
    if (!source) errors.push(label + " unknown source " + String(adapter.sourceId));
    if (!INTERFACES.has(adapter.interfaceKind)) errors.push(label + " interfaceKind invalid");
    else if (source && KINDS[source.kind] !== adapter.interfaceKind)
      errors.push(label + " interface does not match canonical source kind");
    if (typeof adapter.optionalService !== "boolean" ||
        (source && adapter.optionalService !== (source.kind === "mcp")))
      errors.push(label + " optionalService mismatch");
    if (adapter.executable !== false || adapter.autoInstall !== false)
      errors.push(label + " execution and automatic installation are forbidden");
    if (!Array.isArray(adapter.motionHints) || !adapter.motionHints.length ||
        new Set(adapter.motionHints).size !== adapter.motionHints.length ||
        adapter.motionHints.some((s) => !RUNTIMES.has(s)) ||
        (adapter.motionHints.includes("none") && adapter.motionHints.length > 1))
      errors.push(label + " motionHints invalid");
    if (typeof adapter.notes !== "string" || adapter.notes.length < 10 ||
        adapter.notes.length > 400) errors.push(label + " notes invalid");
    if (source?.kind === "guidelines" &&
        (!Array.isArray(adapter.motionHints) || adapter.motionHints.length !== 1 ||
         adapter.motionHints[0] !== "none"))
      errors.push(label + " guideline source may not suggest runtime dependencies");
  });
  for (const id of byId.keys()) if (!seen.has(id)) errors.push("missing adapter for " + id);
  return errors;
}

function listOptions(items, allowed, label, errors) {
  if (!Array.isArray(items) || new Set(items).size !== items.length ||
      items.some((x) => typeof x !== "string" || !allowed.has(x)))
    errors.push(label + " must be a unique list of known tokens");
}

// A deterministic recommendation layer, never an installer or a replacement
// for the trusted policy. "Native" and "adapt" refer to technical suitability.
export function resolveWowAdapters({
  consumer, inventory, policy, adapters,
  installedMotionRuntimes = [], connectedExternalTools = []
}) {
  const errors = [
    ...validateWowAdapters(adapters,inventory),
    ...validateWowReviewPolicy(policy,inventory)
  ];
  const sourcePreview = previewWowSources(consumer,inventory);
  if (!sourcePreview.ok) errors.push(...sourcePreview.errors.map((e) => "consumer: " + e));
  listOptions(installedMotionRuntimes,new Set(["motion","gsap","three"]),"installedMotionRuntimes",errors);
  listOptions(connectedExternalTools,new Set(["21st-magic-mcp"]),"connectedExternalTools",errors);
  if (errors.length) return {ok:false,errors,sources:[],operationsAllowed:false};
  if (!consumer.enabled) return {ok:true,status:"DISABLED",errors:[],sources:[],operationsAllowed:false};

  const records = new Map(inventory.sources.map((s) => [s.id,s]));
  const adapterMap = new Map(adapters.adapters.map((a) => [a.sourceId,a]));
  const approvals = new Map(policy.approvals.map((a) => [a.sourceId,a]));
  const installed = new Set(installedMotionRuntimes);
  const connected = new Set(connectedExternalTools);

  const sources = consumer.sources.allow.map((id) => {
    const source = records.get(id);
    const adapter = adapterMap.get(id);
    const disposition = wowSourceDisposition(id,inventory,policy).status;
    const family = consumer.stack.framework.startsWith("react-")
      ? "react" : consumer.stack.framework.split("-")[0];
    const sameFramework = source.frameworks.includes("any") || source.frameworks.includes(family);
    const sameStyling = source.styling.includes("any") || source.styling.includes(consumer.stack.styling);

    let technicalFit = "reference-only";
    if (adapter.interfaceKind !== "external-tool" && adapter.interfaceKind !== "guidance") {
      if (sameFramework) technicalFit = sameStyling ? "native" : "adapt";
    }
    // The central license review and source family are checked BEFORE any
    // technical-fit recommendation is surfaced as a candidate for manual adoption.
    const decision = disposition === "blocked" ? "unsupported" :
      disposition !== "approved" ? "reference-only" : technicalFit;

    const approval = approvals.get(id);
    const approvedModes = decision === "native" || decision === "adapt"
      ? (approval?.allowedModes || []).filter((mode) =>
          mode === "copy-adapt" || (mode === "registry-install" &&
            decision === "native" && adapter.interfaceKind === "registry-block"))
      : [];

    const possibleRuntimes = adapter.motionHints.filter((runtime) => runtime !== "none");
    const reuseExisting = possibleRuntimes.filter((runtime) => installed.has(runtime));
    const needsDependencyReview = possibleRuntimes.filter((runtime) => !installed.has(runtime));
    const externalServiceConnected = adapter.optionalService && connected.has(id);

    const reasons = [];
    if (adapter.optionalService) reasons.push(
      externalServiceConnected ? "optional external discovery tool is declared connected" :
        "external discovery service not connected; the rest of AppFactory still works");
    if (!sameFramework && !source.frameworks.includes("any")) reasons.push(
      "framework mismatch: design reference only, no framework migration");
    else if (!sameStyling) reasons.push("styling mismatch: adapt in existing styling system; no Tailwind installation");
    if (decision === "reference-only") reasons.push("central source permission is not approved for copying/installing");
    if (decision === "unsupported") reasons.push("source blocked by central policy");
    if (needsDependencyReview.length) reasons.push("motion libraries are only hints; explicit per-component dependency review required");
    if (decision === "adapt") reasons.push("manual adaptation only; registry installation not allowed on this styling stack");
    if (decision === "native") reasons.push("stack appears compatible; component-specific review remains required");
    if (adapter.interfaceKind === "guidance") reasons.push("guideline source has no executable UI component");

    return {
      sourceId:id,repository:source.repository,interfaceKind:adapter.interfaceKind,
      decision,technicalFit,disposition,optionalService:adapter.optionalService,
      externalServiceConnected,
      approvedModes,
      runtime:{hints:possibleRuntimes,reuseExisting,needsDependencyReview,installAutomatically:false},
      actions:{research:true,copyAutomatically:false,installAutomatically:false,executeRemote:false},
      reasons
    };
  });
  return {ok:true,status:"PLAN_ONLY",errors:[],sources,operationsAllowed:false};
}
