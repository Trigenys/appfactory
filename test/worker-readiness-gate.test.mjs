import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readiness = fs.readFileSync("src/worker-readiness.ts", "utf8");
const worker = fs.readFileSync("src/brownfield-worker.ts", "utf8");
const hyperdrive = fs.readFileSync("src/hyperdrive.ts", "utf8");
const index = fs.readFileSync("src/index.ts", "utf8");

test("readiness model distinguishes deployed, degraded and ready", () => {
  assert.match(readiness, /type WorkerReleaseState = "deployed" \| "degraded" \| "ready"/);
  assert.match(readiness, /healthStatus === "ok"/);
  assert.match(readiness, /!databaseRequired \|\| databaseConfigured === true/);
  assert.match(readiness, /state: "degraded"/);
  assert.match(readiness, /state: "deployed"/);
});

test("database-less Workers are not forced through the readiness gate", () => {
  assert.match(worker, /const databaseRequired = preBuildHyperdrive\.declared/);
  assert.match(worker, /databaseRequired\s*\? await probeWorkerReadiness\(workerUrl, true\)\s*:\s*deploymentOnlyReadiness\(\)/s);
  assert.match(worker, /deploymentOnlyReadiness/);
});

test("managed Hyperdrive identity is injected by deploy and verified after Worker deployment", () => {
  assert.match(hyperdrive, /export async function managedHyperdriveEvidence/);
  assert.match(hyperdrive, /export async function verifyManagedHyperdriveBinding/);
  assert.match(hyperdrive, /actualId/);
  assert.match(hyperdrive, /binding\.id === marker\.id/);
  assert.match(worker, /hyperdriveDeployCommand/);
  assert.match(worker, /\[\[hyperdrive\]\]/);
  assert.match(worker, /APPFACTORY_WRANGLER_CONFIG/);
  assert.match(worker, /verifyManagedHyperdriveBinding/);
  assert.match(worker, /HYPERDRIVE_BINDING_NOT_READY/);
  assert.doesNotMatch(worker, /reconcileManagedHyperdriveBinding/);
});

test("database-backed Worker cannot finish ready while health is degraded", () => {
  assert.match(worker, /databaseRequired && readiness\.state !== "ready"/);
  assert.match(worker, /WORKER_DATABASE_NOT_READY/);
  assert.match(worker, /database_configured=/);
  assert.match(index, /WORKER_DATABASE_NOT_READY/);
  assert.match(index, /HYPERDRIVE_BINDING_NOT_READY/);
  assert.match(index, /\? 503/);
});

test("readiness failures surface non-secret release evidence", () => {
  assert.match(worker, /release: \{[\s\S]*?state: readiness\.state[\s\S]*?databaseRequired[\s\S]*?hyperdrive[\s\S]*?readiness/s);
  assert.match(index, /error\.evidence \? \{ evidence: error\.evidence \}/);
  assert.doesNotMatch(worker, /evidence:[\s\S]*?APPFACTORY_DATABASE_URL/);
});


test("failed readiness probes preserve bounded non-secret diagnostics", () => {
  assert.match(readiness, /httpStatus: number \| null/);
  assert.match(readiness, /probeError: string \| null/);
  assert.match(readiness, /slice\(0, 240\)/);
  assert.match(readiness, /invalid health JSON:/);
  assert.match(worker, /probe_http=/);
  assert.match(worker, /probe_error=/);
  assert.doesNotMatch(readiness, /APPFACTORY_DATABASE_URL/);
});


test("database-backed readiness supports split liveness and readiness endpoints", () => {
  assert.match(readiness, /const readinessEndpoint = `\$\{baseUrl\}\/health\/ready`/);
  assert.match(readiness, /databaseConfigured === null/);
  assert.match(readiness, /readinessStatus === "ready" \|\| readinessStatus === "ok"/);
  assert.match(readiness, /databaseConfigured: true/);
});

test("readiness polling stays within Cloudflare Worker subrequest budget", () => {
  assert.match(readiness, /const DEFAULT_READINESS_ATTEMPTS = 6/);
  assert.match(readiness, /options\.attempts \?\? DEFAULT_READINESS_ATTEMPTS/);
});


test("readiness polling allows deployment propagation without extra subrequests", () => {
  assert.match(readiness, /const DEFAULT_READINESS_ATTEMPTS = 6/);
  assert.match(readiness, /options\.intervalMs \?\? 5000/);
});
