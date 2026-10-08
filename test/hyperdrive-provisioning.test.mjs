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



test("missing Hyperdrive profiles fail closed without exposing credential values", () => {
  assert.match(source, /HYPERDRIVE_DATABASE_PROFILE_NOT_FOUND/);
  assert.match(source, /Object\.keys\(profiles\)\.sort\(\)/);
  assert.match(source, /Available managed profiles/);
  assert.doesNotMatch(source, /JSON\.stringify\(profiles\)/);
});

test("dedicated per-profile secrets extend managed Hyperdrive profiles without replacing the legacy map", () => {
  assert.match(source, /HYPERDRIVE_DATABASE_PROFILE__/);
  assert.match(source, /function dedicatedProfileSecretName/);
  assert.match(source, /function parseDedicatedProfile/);
  assert.match(source, /const dedicated = parseDedicatedProfile\(env, profileName\)/);
  assert.match(source, /if \(dedicated\) return validateProfile\(profileName, dedicated\)/);
  assert.match(source, /const profile = managedProfile\(env, request\.profile\)/);
});


test("dedicated connection URL secret is wired for one managed profile", () => {
  assert.match(source, /HYPERDRIVE_DATABASE_URL__/);
  assert.match(source, /function dedicatedUrlSecretName/);
  assert.match(source, /function parseDedicatedConnectionUrl/);
  assert.match(source, /const dedicatedUrl = parseDedicatedConnectionUrl\(env, profileName\)/);
});
