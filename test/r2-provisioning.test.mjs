import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/r2-provisioning.ts", "utf8");
const index = fs.readFileSync("src/index.ts", "utf8");

test("R2 provisioning is deterministic and repository-scoped", () => {
  assert.match(source, /const PRIVATE_MEDIA_RECIPE = "private-media"/);
  assert.match(source, /request\.repository !== oidcRepository/);
  assert.match(source, /REPOSITORY_MISMATCH/);
  assert.match(source, /repositorySlug\(repository\)/);
  assert.match(source, /const suffix = "-media"/);
  assert.match(source, /workerBinding:[\s\S]*binding: "MEDIA_BUCKET"/);
});

test("R2 provisioning creates or reuses the same private bucket", () => {
  assert.match(source, /async function getBucket/);
  assert.match(source, /if \(existing\) return \{ bucket: existing, created: false \}/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /storageClass: "Standard"/);
  assert.match(source, /error\.status === 409/);
  assert.match(source, /concurrent[\s\S]*created: false/);
});

test("managed r2.dev delivery is forced off", () => {
  assert.match(source, /domains\/managed/);
  assert.match(source, /JSON\.stringify\(\{ enabled: false \}\)/);
  assert.match(source, /R2_PUBLIC_ACCESS_NOT_DISABLED/);
  assert.match(source, /publicManagedDomainEnabled: false/);
});

test("R2 recipe and request surface fail closed", () => {
  assert.match(source, /UNSUPPORTED_R2_RECIPE/);
  assert.match(source, /INVALID_R2_REQUEST/);
  assert.match(source, /Object\.keys\(request\)\.sort\(\)/);
  assert.match(source, /keys\.join\(","\) !== \["recipe", "repository"\]\.sort\(\)\.join\(","\)/);
});

test("R2 permission errors do not expose credentials", () => {
  assert.match(source, /CLOUDFLARE_R2_ACCESS_DENIED/);
  assert.match(source, /Workers R2 Storage Edit/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(source, /resourceToken\(env\).*message/);
});

test("OIDC infrastructure router exposes reusable R2 provisioning", () => {
  assert.match(index, /url\.pathname === "\/infrastructure\/r2"/);
  assert.match(index, /authenticateInfrastructureMutation/);
  assert.match(index, /provisionExistingR2/);
  assert.match(index, /provisionR2/);
});


test("default R2 fetch preserves the Cloudflare Worker runtime binding", () => {
  assert.match(
    source,
    /deps: R2Dependencies = \{[\s\S]*fetch: \(input, init\) => fetch\(input, init\)[\s\S]*\}/
  );
});


test("R2 retries an authorization failure with the fallback Cloudflare token", () => {
  assert.match(source, /const fallbackToken = env\.CLOUDFLARE_API_TOKEN/);
  assert.match(source, /error instanceof CloudflareR2ApiError/);
  assert.match(source, /error\.status === 401 \|\| error\.status === 403/);
  assert.match(source, /fallbackToken !== preferredToken/);
  assert.match(source, /return cloudflareRequestWithToken<T>\([\s\S]*fallbackToken/);
});
