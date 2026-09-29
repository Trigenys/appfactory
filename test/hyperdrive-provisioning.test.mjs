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

test("Worker binding preserves unrelated bindings through inheritance", () => {
  assert.match(source, /\/workers\/scripts\/\$\{encodeURIComponent\(workerName\)\}\/settings/);
  assert.match(source, /type: "inherit"/);
  assert.match(source, /type: "hyperdrive"/);
  assert.match(source, /HYPERDRIVE_BINDING_CONFLICT/);
  assert.match(source, /HYPERDRIVE_BINDING_VERIFICATION_FAILED/);
  assert.match(source, /Workers Scripts Write/);
});

test("Worker settings binding updates use Cloudflare multipart form contract", () => {
  assert.match(source, /const form = new FormData\(\)/);
  assert.match(source, /form\.append\(\s*"settings"/s);
  assert.match(source, /JSON\.stringify\(\{ bindings: desiredBindings \}\)/);
  assert.match(source, /type: "application\/json"/);
  assert.match(source, /method: "PATCH",[\s\S]*?body: form/s);
  assert.match(source, /if \(!\(init\.body instanceof FormData\) && !headers\.has\("Content-Type"\)\)/);
});

test("Hyperdrive provisioning requires an AppFactory-managed Worker and ownership marker", () => {
  assert.match(source, /WORKER_MARKER_PATH = "\.appfactory\/worker-infrastructure\.json"/);
  assert.match(source, /HYPERDRIVE_MARKER_PATH = "\.appfactory\/hyperdrive\.json"/);
  assert.match(source, /BROWNFIELD_WORKER_UNCLAIMED/);
  assert.match(source, /BROWNFIELD_HYPERDRIVE_UNCLAIMED/);
  assert.match(source, /HYPERDRIVE_MARKER_MISMATCH/);
});

test("new Hyperdrive is compensated when binding fails", () => {
  assert.match(source, /if \(created\)[\s\S]*?deleteHyperdrive/);
  assert.match(source, /HYPERDRIVE_BINDING_ROLLBACK_FAILED/);
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

