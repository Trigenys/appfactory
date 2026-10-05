import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync("src/brownfield-worker.ts", "utf8");
const hyperdrive = fs.readFileSync("src/hyperdrive.ts", "utf8");

test("production infrastructure identity stays backward compatible", () => {
  assert.match(worker, /environment = input\.environment \|\| "production"/);
  assert.match(worker, /\? `\$\{repository\.name\}-staging-api`\.slice\(0, 63\)[\s\S]*?: `\$\{repository\.name\}-api`\.slice\(0, 63\)/);
  assert.match(worker, /environment === "staging" \? STAGING_MARKER_PATH : MARKER_PATH/);
  assert.match(hyperdrive, /environment === "staging"[\s\S]*?STAGING_HYPERDRIVE_MARKER_PATH[\s\S]*?HYPERDRIVE_MARKER_PATH/);
});

test("staging Worker and database identities are deterministic and isolated", () => {
  assert.match(worker, /\$\{repository\.name\}-staging-api/);
  assert.match(worker, /\$\{repository\.name\}-staging/);
  assert.match(worker, /worker-infrastructure\.staging\.json/);
  assert.match(hyperdrive, /\$\{repository\.name\}-staging-api/);
  assert.match(hyperdrive, /\$\{repository\.name\}-staging/);
  assert.match(hyperdrive, /hyperdrive\.staging\.json/);
});

test("only production and staging environments are accepted", () => {
  assert.match(worker, /environment !== "production" && environment !== "staging"/);
  assert.match(hyperdrive, /environment !== "production" && environment !== "staging"/);
  assert.match(worker, /INFRASTRUCTURE_ENVIRONMENT_FORBIDDEN/);
  assert.match(hyperdrive, /INFRASTRUCTURE_ENVIRONMENT_FORBIDDEN/);
});

test("staging Hyperdrive remains centrally credentialed", () => {
  assert.match(hyperdrive, /HYPERDRIVE_DATABASE_PROFILES/);
  assert.doesNotMatch(hyperdrive, /input\.password/);
  assert.doesNotMatch(hyperdrive, /input\.host/);
  assert.doesNotMatch(hyperdrive, /input\.user/);
});

test("Worker release checks the matching environment Hyperdrive", () => {
  assert.match(worker, /managedHyperdriveEvidence\([\s\S]*?request\.environment/);
  assert.match(worker, /verifyManagedHyperdriveBinding\([\s\S]*?request\.environment/);
  assert.match(hyperdrive, /\(marker\.environment \|\| "production"\) !== environment/);
});
