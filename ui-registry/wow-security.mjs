import fs from "node:fs";
import path from "node:path";
import { validateWowSources } from "./wow-contract.mjs";

const SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SPDX = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"]);
const MODES = new Set(["copy-adapt", "registry-install"]);
const SOURCE_PATHS = new Set(["src", "app", "components", "assets", "public", "styles", "pages", "lib", "ui", "views", "templates", "static"]);
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const unique = (xs) => new Set(xs).size === xs.length;
const ownKeys = (value, allowed, name, errors) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(name + ": unexpected field " + key);
};
const validDate = (d) => {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const actual = new Date(d + "T00:00:00Z");
  return Number.isFinite(actual.valueOf()) && actual.toISOString().slice(0, 10) === d;
};
const safePath = (value, roots) =>
  typeof value === "string" && value.length <= 240 &&
  /^[A-Za-z0-9_.@/-]+$/.test(value) &&
  !value.startsWith("/") && !value.includes("//") &&
  value.split("/").every((s) => s !== "." && s !== "..") &&
  (!roots || roots.has(value.split("/")[0])) &&
  !value.split("/").some((s) => s.toLowerCase() === "node_modules" || s.toLowerCase() === ".git");

const allowedEvidenceURL = (repository, commit, url) => {
  if (typeof url !== "string") return false;
  const prefix = repository + "/blob/" + commit + "/";
  if (!url.startsWith(prefix)) return false;
  const file = url.slice(prefix.length);
  return safePath(file) && /(^|\/)(LICENSE(\.[A-Za-z0-9-]+)?|COPYING(\.[A-Za-z0-9-]+)?)$/i.test(file);
};
const byId = (inventory, id) => inventory.sources.find((s) => s.id === id);
const approvalsFor = (policy, id) => policy.approvals.filter((a) => a.sourceId === id);

export function validateWowReviewPolicy(policy, inventory) {
  const inventoryErrors = validateWowSources(inventory);
  if (inventoryErrors.length) return inventoryErrors.map((x) => "invalid source inventory: " + x);
  const errors = [];
  if (!object(policy)) return ["review policy must be an object"];
  ownKeys(policy, ["version", "defaultDisposition", "blocked", "approvals"], "policy", errors);
  if (policy.version !== 1) errors.push("policy.version must be 1");
  if (policy.defaultDisposition !== "reference-only") errors.push("policy.defaultDisposition must be reference-only");
  if (!Array.isArray(policy.blocked)) errors.push("policy.blocked must be an array");
  else {
    if (!unique(policy.blocked)) errors.push("policy.blocked has duplicates");
    for (const id of policy.blocked) if (!byId(inventory, id)) errors.push("policy.blocked unknown source: " + String(id));
  }
  if (!Array.isArray(policy.approvals)) return [...errors, "policy.approvals must be an array"];
  const seen = new Set();
  for (const [i, a] of policy.approvals.entries()) {
    const label = "approvals[" + i + "]";
    if (!object(a)) { errors.push(label + " must be an object"); continue; }
    ownKeys(a, ["sourceId", "repository", "commit", "spdx", "licenseEvidenceUrl",
      "reviewer", "reviewedOn", "allowedModes", "noticeFile"], label, errors);
    const source = byId(inventory, a.sourceId);
    if (!source) errors.push(label + " unknown source id");
    if (!source || a.repository !== source.repository) errors.push(label + " repository mismatch");
    if (seen.has(a.sourceId)) errors.push(label + " duplicate approval");
    seen.add(a.sourceId);
    if (Array.isArray(policy.blocked) && policy.blocked.includes(a.sourceId)) errors.push(label + " blocked sources cannot be approved");
    if (!SHA.test(a.commit ?? "")) errors.push(label + " immutable 40-character commit SHA required");
    if (!SPDX.has(a.spdx)) errors.push(label + " unsupported or unreviewed SPDX license");
    if (!allowedEvidenceURL(a.repository, a.commit, a.licenseEvidenceUrl))
      errors.push(label + " license evidence must be an immutable upstream LICENSE/COPYING URL");
    if (typeof a.reviewer !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(a.reviewer))
      errors.push(label + " reviewer must be a GitHub login");
    if (!validDate(a.reviewedOn)) errors.push(label + " invalid review date");
    if (!Array.isArray(a.allowedModes) || !a.allowedModes.length ||
      !unique(a.allowedModes) || a.allowedModes.some((m) => !MODES.has(m)))
      errors.push(label + " modes must be unique reviewed copy-adapt/registry-install");
    if (!safePath(a.noticeFile) || !/^(?:THIRD_PARTY_NOTICES\.md|licenses\/[A-Za-z0-9_.@/-]+)$/.test(a.noticeFile ?? ""))
      errors.push(label + " noticeFile must be THIRD_PARTY_NOTICES.md or licenses/...");
    if (source && (source.kind === "mcp" || source.kind === "guidelines"))
      errors.push(label + " tool/guideline sources cannot grant component reuse");
  }
  return errors;
}

export function wowSourceDisposition(sourceId, inventory, policy) {
  const errors = validateWowReviewPolicy(policy, inventory);
  if (errors.length) return {status:"blocked",errors};
  const source = byId(inventory, sourceId);
  if (!source) return {status:"blocked",errors:["unknown source"]};
  if (policy.blocked.includes(sourceId)) return {status:"blocked",errors:["explicitly blocked"]};
  if (approvalsFor(policy, sourceId).length) return {status:"approved",errors:[]};
  if (source.license.verification === "unverified") return {status:"review-required",errors:[]};
  return {status:"reference-only",errors:[]};
}

// Pure planning gate. Even an eligible request NEVER copies, installs or executes.
export function assessWowAdoption(request, inventory, policy) {
  const errors = validateWowReviewPolicy(policy, inventory);
  if (!object(request)) return {eligible:false,executeAllowed:false,errors:[...errors,"request must be an object"]};
  ownKeys(request, ["sourceId", "repository", "commit", "mode", "component", "files"], "request", errors);
  const source = byId(inventory, request.sourceId);
  const approval = policy?.approvals?.find?.((a) => a.sourceId === request.sourceId);
  if (!source) errors.push("unknown source id");
  if (!ID.test(request.sourceId ?? "")) errors.push("invalid source id");
  if (!MODES.has(request.mode)) errors.push("mode must be copy-adapt or registry-install");
  if (!SHA.test(request.commit ?? "")) errors.push("an immutable 40-character commit SHA is required");
  if (!source || request.repository !== source.repository) errors.push("repository must match trusted inventory");
  if (policy?.blocked?.includes?.(request.sourceId)) errors.push("source is explicitly blocked");
  if (!approval) errors.push("no centrally reviewed source approval exists");
  else {
    if (request.commit !== approval.commit) errors.push("commit does not match reviewed immutable SHA");
    if (!approval.allowedModes.includes(request.mode)) errors.push("mode is not approved");
  }
  if (typeof request.component !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(request.component))
    errors.push("invalid component name");
  if (!Array.isArray(request.files) || !request.files.length || request.files.length > 50 ||
      !unique(request.files) || request.files.some((p) => !safePath(p, SOURCE_PATHS)))
    errors.push("files must be unique, safe project-owned paths");
  return {eligible:errors.length === 0,executeAllowed:false,errors};
}

const provenanceId = (entry) => entry.sourceId + ":" + entry.component;
const equals = (x,y) => JSON.stringify(x) === JSON.stringify(y);
export const emptyWowProvenance = () => ({version:1,entries:[]});

export function validateWowProvenance(data) {
  const errors = [];
  if (!object(data)) return ["provenance must be an object"];
  ownKeys(data,["version","entries"],"provenance",errors);
  if (data.version !== 1) errors.push("provenance.version must be 1");
  if (!Array.isArray(data.entries)) return [...errors,"provenance.entries must be an array"];
  const ids = new Set(), targets = new Set();
  for (const [i, entry] of data.entries.entries()) {
    if (!object(entry)) { errors.push("entry must be object"); continue; }
    const name = "entries[" + i + "]";
    ownKeys(entry,["sourceId","repository","commit","component","spdx","mode","files",
      "noticeFile","reviewer","licenseEvidenceUrl"],name,errors);
    if (!ID.test(entry.sourceId ?? "")) errors.push(name + " invalid sourceId");
    if (!SHA.test(entry.commit ?? "")) errors.push(name + " invalid commit");
    if (!MODES.has(entry.mode)) errors.push(name + " invalid mode");
    if (!SPDX.has(entry.spdx)) errors.push(name + " invalid SPDX");
    if (typeof entry.component !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(entry.component))
      errors.push(name + " invalid component");
    if (typeof entry.repository !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry.repository))
      errors.push(name + " invalid repository");
    if (!allowedEvidenceURL(entry.repository,entry.commit,entry.licenseEvidenceUrl))
      errors.push(name + " license evidence invalid");
    if (typeof entry.reviewer !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(entry.reviewer))
      errors.push(name + " reviewer invalid");
    if (!safePath(entry.noticeFile) || !/^(?:THIRD_PARTY_NOTICES\.md|licenses\/[A-Za-z0-9_.@/-]+)$/.test(entry.noticeFile ?? ""))
      errors.push(name + " noticeFile invalid");
    if (!Array.isArray(entry.files) || !entry.files.length || !unique(entry.files))
      errors.push(name + " files invalid");
    else for (const file of entry.files) {
      if (!safePath(file,SOURCE_PATHS)) errors.push(name + " unsafe file " + String(file));
      if (targets.has(file)) errors.push("duplicate destination path " + file);
      targets.add(file);
    }
    const id = provenanceId(entry);
    if (ids.has(id)) errors.push("duplicate provenance entry " + id);
    ids.add(id);
  }
  return errors;
}

export function reconcileWowProvenance(existing, request, inventory, policy) {
  const current = existing ?? emptyWowProvenance();
  const currentErrors = validateWowProvenance(current);
  const decision = assessWowAdoption(request,inventory,policy);
  const errors = [...currentErrors, ...decision.errors];
  if (errors.length) return {ok:false,changed:false,errors,provenance:current};
  const approval = policy.approvals.find((a) => a.sourceId === request.sourceId);
  const entry = {
    sourceId:request.sourceId,repository:request.repository,commit:request.commit,
    component:request.component,spdx:approval.spdx,mode:request.mode,
    files:[...request.files].sort(),noticeFile:approval.noticeFile,
    reviewer:approval.reviewer,licenseEvidenceUrl:approval.licenseEvidenceUrl
  };
  const matching = current.entries.find((x) => provenanceId(x) === provenanceId(entry));
  if (matching) {
    if (equals(matching,entry)) return {ok:true,changed:false,errors:[],provenance:current};
    return {ok:false,changed:false,errors:["existing component provenance differs; explicit migration/review required"],provenance:current};
  }
  const next = {
    version:1,
    entries:[...current.entries,entry].sort((a,b) => provenanceId(a).localeCompare(provenanceId(b)))
  };
  const validation = validateWowProvenance(next);
  if (validation.length) return {ok:false,changed:false,errors:validation,provenance:current};
  return {ok:true,changed:true,errors:[],provenance:next};
}

/**
 * Verify copied sources and license notices in a checked-out consumer repo.
 * No auto-copy occurs here; refuse symlinks that could escape the root.
 */
export function verifyWowProvenanceFiles(provenance, consumerRoot) {
  const errors = validateWowProvenance(provenance);
  if (errors.length) return errors;
  const root = fs.realpathSync(consumerRoot);
  for (const entry of provenance.entries) for (const rel of [...entry.files,entry.noticeFile]) {
    const target = path.resolve(root,rel);
    if (!target.startsWith(root + path.sep)) { errors.push("path escaped checkout: " + rel); continue; }
    try {
      const actual = fs.realpathSync(target);
      if (!actual.startsWith(root + path.sep) || !fs.statSync(actual).isFile()) {
        errors.push("untrusted or non-file path: " + rel); continue;
      }
      if (!fs.readFileSync(actual).length) errors.push("empty file/notice: " + rel);
    } catch {
      errors.push("missing adopted file/notice: " + rel);
    }
  }
  return errors;
}

/** Signal production external media hotlinks for review. Not a replacement for browser QA. */
export function findExternalMediaHotlinks(code) {
  const hits = [];
  const regex = /https?:\/\/[^\s"'\`()<>\[\]]+/gi;
  for (const match of String(code).matchAll(regex)) {
    const raw = match[0].replace(/[;,}]+$/,"");
    if (/\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(raw))
      hits.push(raw);
  }
  return [...new Set(hits)].sort();
}
