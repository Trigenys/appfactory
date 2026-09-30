import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/hyperdrive.ts", "utf8");
const index = fs.readFileSync("src/index.ts", "utf8");
const types = fs.readFileSync("src/types.ts", "utf8");

test("Hyperdrive provisioning uses AppFactory-owned profiles instead of repository credentials", () => {
  assert.match(types, /HYPERDRIVE_DATABASE_PROFILES\?: string/);
  assert.match(source, /env\.HYPERDRIVE_DATABASE_PROFILES/);
  assert.match(source, /DATABASE_PROFILE_FORBIDDEN/);
  assert.doesNotMatch(source, /input\.password/);
  assert.doesNotMatch(source, /input\.host/);
  assert.doesNotMatch(source, /input\.user/);
});

test("Hyperdrive provisioning uses the documented Cloudflare config API", () => {
  assert.match(source, /\/hyperdrive\/configs\?per_page=100/);
  assert.match(source, /\/hyperdrive\/configs\`/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /Hyperdrive Read/);
  assert.match(source, /Hyperdrive Write/);
});

test("Hyperdrive provisioning defers the Worker binding to the release deploy", () => {
  assert.match(source, /deferredToDeploy: true/);
  assert.match(source, /configured: false/);
  assert.doesNotMatch(source, /async function ensureWorkerBinding/);
  assert.doesNotMatch(source, /HYPERDRIVE_BINDING_ROLLBACK_FAILED/);
});

test("Hyperdrive provisioning requires an AppFactory-managed Worker and ownership marker", () => {
  assert.match(source, /WORKER_MARKER_PATH = "\.appfactory\/worker-infrastructure\.json"/);
  assert.match(source, /HYPERDRIVE_MARKER_PATH = "\.appfactory\/hyperdrive\.json"/);
  assert.match(source, /BROWNFIELD_WORKER_UNCLAIMED/);
  assert.match(source, /BROWNFIELD_HYPERDRIVE_UNCLAIMED/);
  assert.match(source, /HYPERDRIVE_MARKER_MISMATCH/);
});

test("OIDC infrastructure router exposes Hyperdrive provisioning", () => {
  assert.match(index, /url\.pathname === "\/infrastructure\/hyperdrive"/);
  assert.match(index, /authenticateInfrastructureMutation/);
  assert.match(index, /provisionExistingHyperdrive/);
  assert.match(index, /provisionHyperdrive/);
});

test("Hyperdrive resource auth falls back only after preferred-token auth failure", () => {
  assert.match(source, /const preferredToken = env\.CLOUDFLARE_PAGES_D1_TOKEN \|\| env\.CLOUDFLARE_API_TOKEN/);
  assert.match(source, /error instanceof CloudflareApiError/);
  assert.match(source, /error\.status === 401 \|\| error\.status === 403/);
  assert.match(source, /fallbackToken !== preferredToken/);
  assert.match(source, /cloudflareRequestWithToken<T>\(fallbackToken, path, init\)/);
});

