#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = path.join(ROOT, ".appfactory", "ci-impact.json");

function ruleMatches(file, rule = {}) {
  return (rule.files || []).includes(file) ||
    (rule.prefixes || []).some((prefix) => file.startsWith(prefix));
}

export function classifyChanges(files, config) {
  const normalized = [...new Set(files.map((file) => file.trim()).filter(Boolean))]
    .map((file) => file.replaceAll("\\", "/"));

  const gates = Object.fromEntries(
    Object.keys(config.gates || {}).map((gate) => [gate, false])
  );
  const reasons = Object.fromEntries(
    Object.keys(config.gates || {}).map((gate) => [gate, []])
  );
  const ignored = [];
  const fallback = [];

  const forceAllFiles = normalized.filter((file) => ruleMatches(file, config.forceAll));
  if (forceAllFiles.length > 0) {
    for (const gate of Object.keys(gates)) {
      gates[gate] = true;
      reasons[gate].push(...forceAllFiles.map((file) => `${file} (global CI surface)`));
    }
    return { files: normalized, gates, reasons, ignored, fallback, forcedAll: true };
  }

  for (const file of normalized) {
    if (ruleMatches(file, config.ignore)) {
      ignored.push(file);
      continue;
    }

    let matched = false;
    for (const [gate, rule] of Object.entries(config.gates || {})) {
      if (!ruleMatches(file, rule)) continue;
      gates[gate] = true;
      reasons[gate].push(file);
      matched = true;
    }

    if (!matched) {
      const fallbackGate = config.fallbackGate;
      if (!fallbackGate || !(fallbackGate in gates)) {
        throw new Error(`Unclassified change without a valid fallback gate: ${file}`);
      }
      gates[fallbackGate] = true;
      reasons[fallbackGate].push(`${file} (fallback)`);
      fallback.push(file);
    }
  }

  return { files: normalized, gates, reasons, ignored, fallback, forcedAll: false };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function appendOutputs(result, outputPath) {
  if (!outputPath) return;
  const lines = [];
  for (const [gate, enabled] of Object.entries(result.gates)) {
    lines.push(`${gate}=${enabled ? "true" : "false"}`);
  }
  lines.push(`any=${Object.values(result.gates).some(Boolean) ? "true" : "false"}`);
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

function appendSummary(result, summaryPath) {
  if (!summaryPath) return;
  const active = Object.entries(result.gates).filter(([, enabled]) => enabled).map(([gate]) => gate);
  const skipped = Object.entries(result.gates).filter(([, enabled]) => !enabled).map(([gate]) => gate);
  const lines = [
    "## CI impact analysis",
    "",
    `- Changed files: ${result.files.length}`,
    `- Active gates: ${active.length ? active.join(", ") : "none"}`,
    `- Skipped gates: ${skipped.length ? skipped.join(", ") : "none"}`,
    `- Global invalidation: ${result.forcedAll ? "yes" : "no"}`,
    ""
  ];

  for (const gate of Object.keys(result.gates)) {
    lines.push(`### ${gate}: ${result.gates[gate] ? "run" : "skip"}`);
    const reasons = result.reasons[gate];
    if (reasons.length === 0) {
      lines.push("- No impacted files.");
    } else {
      for (const reason of reasons) lines.push(`- \`${reason}\``);
    }
    lines.push("");
  }

  if (result.ignored.length > 0) {
    lines.push("### Ignored non-runtime changes");
    for (const file of result.ignored) lines.push(`- \`${file}\``);
    lines.push("");
  }

  if (result.fallback.length > 0) {
    lines.push("### Fail-safe classifications");
    lines.push("Unknown surfaces defaulted to the core gate so new files cannot silently bypass CI.");
    for (const file of result.fallback) lines.push(`- \`${file}\``);
    lines.push("");
  }

  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["files-file"]) {
    throw new Error("--files-file is required");
  }

  const configPath = path.resolve(args.config || DEFAULT_CONFIG);
  const filesPath = path.resolve(args["files-file"]);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const files = fs.existsSync(filesPath)
    ? fs.readFileSync(filesPath, "utf8").split(/\r?\n/)
    : [];

  const result = classifyChanges(files, config);
  appendOutputs(result, args["github-output"]);
  appendSummary(result, args.summary);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
