#!/usr/bin/env node
// Read-only agent planning helper. No network, writes, copying, package installation or browser QA.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { previewWowSources, readWowRegistry } from "../ui-registry/wow-contract.mjs";
import { validateWowReviewPolicy, wowSourceDisposition } from "../ui-registry/wow-security.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(ROOT, "ui-registry", "wow-review-policy.json");
const record = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const normalize = (s) => typeof s === "string" ? s.trim() : "";
const nonEmpty = (s) => normalize(s).length > 0;
const ISO_LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export function validateWowBrief(brief) {
  const errors = [];
  if (!record(brief)) return ["brief must be an object"];
  const fields = ["version","project","repository","audience","primaryConversion","artDirection","narrative","constraints","notes"];
  for (const field of Object.keys(brief)) if (!fields.includes(field)) errors.push("unknown brief field: " + field);
  if (brief.version !== 1) errors.push("brief.version must be 1");
  for (const field of ["project","audience","primaryConversion","artDirection"]) {
    if (!nonEmpty(brief[field]) || normalize(brief[field]).length > 500) errors.push(field + " must be concise nonempty text");
  }
  if (typeof brief.repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(brief.repository)) {
    errors.push("repository must use owner/name");
  }
  if (!Array.isArray(brief.narrative) || brief.narrative.length < 2 || brief.narrative.length > 10 ||
    brief.narrative.some((s) => !nonEmpty(s) || s.length > 400)) {
    errors.push("narrative must contain 2-10 concise product story steps");
  }
  if (!record(brief.constraints)) errors.push("constraints must be an object");
  else {
    const allowed = ["preserveStack","languages","assets","merchants","truthfulProofOnly","reducedMotion","thirdPartyBranding"];
    for (const key of Object.keys(brief.constraints)) if (!allowed.includes(key)) errors.push("unknown constraint: " + key);
    for (const flag of ["preserveStack","truthfulProofOnly","reducedMotion"]) {
      if (brief.constraints[flag] !== true) errors.push(flag + " must be true");
    }
    const languages = brief.constraints.languages;
    if (!Array.isArray(languages) || !languages.length || new Set(languages).size !== languages.length ||
      languages.some((s) => typeof s !== "string" || !ISO_LANG.test(s))) {
      errors.push("languages must be distinct language tags");
    }
    if (!["self-hosted","rights-reviewed"].includes(brief.constraints.assets)) errors.push("assets must be self-hosted or rights-reviewed");
    if (brief.constraints.merchants !== undefined &&
        brief.constraints.merchants !== "fictional-demo-only-unless-approved") {
      errors.push("real merchant branding requires explicit approval");
    }
    if (brief.constraints.thirdPartyBranding !== undefined &&
        brief.constraints.thirdPartyBranding !== "explicit-permission") {
      errors.push("thirdPartyBranding must require explicit-permission");
    }
  }
  if (brief.notes !== undefined && (typeof brief.notes !== "string" || brief.notes.length > 3000))
    errors.push("notes must be short text");
  return errors;
}

const phases = [
  {id:"audit", action:"Inspect real consumer routes, package dependencies, existing components and asset ownership",status:"NOT RUN"},
  {id:"art-direction",action:"Define typography, hierarchy, composition, focal imagery and alternate directions",status:"NOT RUN"},
  {id:"source-selection",action:"Search existing consumer/native components before proposing original code",status:"NOT RUN"},
  {id:"compose",action:"Implement original/native responsive layout in the unchanged consumer stack",status:"NOT RUN"},
  {id:"motion",action:"Add meaningful transitions with keyboard and reduced-motion alternatives",status:"NOT RUN"},
  {id:"render",action:"Capture and inspect real 1440px/390px browser screenshots",status:"NOT RUN"},
  {id:"verify",action:"Run typecheck/build, accessibility, keyboard, reduced motion and measured performance checks",status:"NOT RUN"},
  {id:"provenance",action:"Verify licenses/notices and record adopted code only under future central approvals",status:"NOT RUN"}
];

export function planWowFrontend({brief,consumer,inventory,policy}) {
  const errors = [
    ...validateWowBrief(brief),
    ...validateWowReviewPolicy(policy,inventory)
  ];
  const sources = previewWowSources(consumer,inventory);
  if (!sources.ok) errors.push(...sources.errors.map((e) => "consumer/source: " + e));
  if (errors.length) return {ok:false,mode:"DRY_RUN",errors,steps:[],sources:[],evidence:{}};
  if (!consumer.enabled) {
    return {ok:true,mode:"DRY_RUN",status:"DISABLED",project:brief.project,
      repository:brief.repository,steps:[],sources:[],evidence:{},operationsAllowed:false};
  }
  const candidates = sources.sources.map((candidate) => ({
    ...candidate,
    disposition:wowSourceDisposition(candidate.id,inventory,policy).status,
    legalReuseDecision:"NO CODE COPY / NO INSTALL / NO EXECUTION"
  }));
  return {
    ok:true,
    mode:"DRY_RUN",
    status:"PLAN_ONLY",
    project:brief.project,
    repository:brief.repository,
    audience:brief.audience,
    primaryConversion:brief.primaryConversion,
    artDirection:brief.artDirection,
    narrative:[...brief.narrative],
    unchangedStack:{...consumer.stack},
    languages:[...brief.constraints.languages],
    sources:candidates,
    steps:phases.map((phase) => ({...phase})),
    guardrails:{
      preserveStack:true,truthfulProofOnly:true,reducedMotionRequired:true,
      thirdPartyComponentInstall:false,thirdPartyCodeCopy:false,
      noUnapprovedMerchantBranding:true,
      neverClaimRenderedQAWithoutBrowser:true
    },
    evidence:{
      repositoryInspection:"NOT RUN (consumer metadata was supplied, not audited)",
      browserScreenshots:"NOT RUN",keyboard:"NOT RUN",
      reducedMotion:"NOT RUN",performance:"NOT RUN",build:"NOT RUN",deployment:"NOT VERIFIED"
    },
    operationsAllowed:false,
    nextAction:"Verify this brief against the actual repository, select original/native design primitives, implement in a dedicated PR and perform real browser QA."
  };
}

export function dryRunWowBriefFiles(briefPath,consumerPath) {
  const brief = JSON.parse(fs.readFileSync(path.resolve(briefPath),"utf8"));
  const consumer = JSON.parse(fs.readFileSync(path.resolve(consumerPath),"utf8"));
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH,"utf8"));
  return planWowFrontend({brief,consumer,inventory:readWowRegistry(),policy});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [briefPath,consumerPath] = process.argv.slice(2);
  if (!briefPath || !consumerPath) {
    process.stderr.write("Usage: node scripts/wow-frontend-plan.mjs <brief.json> <consumer.json>\n");
    process.exitCode = 2;
  } else {
    try {
      const output = dryRunWowBriefFiles(briefPath,consumerPath);
      process.stdout.write(JSON.stringify(output,null,2) + "\n");
      if (!output.ok) process.exitCode = 1;
    } catch (error) {
      process.stderr.write("Unable to plan WOW Frontend: " + error.message + "\n");
      process.exitCode = 1;
    }
  }
}
