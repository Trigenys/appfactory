import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/brownfield-worker.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");

test("managed R2 is an explicit reviewed Worker capability", () => {
  assert.match(source, /export interface WorkerR2Gate/);
  assert.match(source, /recipe: "private-media"/);
  assert.match(source, /R2_RECIPE_FORBIDDEN/);
  assert.match(source, /R2_RUNTIME_FORBIDDEN/);
  assert.match(
    source,
    /Managed R2 currently requires the reviewed TypeScript\/Wrangler runtime/
  );
});

test("R2 bucket name is derived by AppFactory instead of repository input", () => {
  assert.match(source, /r2BucketName\(repository\.full_name\)/);
  assert.match(source, /r2Recipe\?: "private-media"/);
  assert.doesNotMatch(source, /input\.r2\.bucket/);
});

test("trusted Workers Builds token is selected by registered build-token identity", () => {
  assert.match(source, /async function resolveR2BuildTokenUuid/);
  assert.match(source, /"AppFactory R2 Builds"/);
  assert.match(source, /"appfactory-api build token"/);
  assert.match(source, /build_token_name === name/);
  assert.match(source, /R2_BUILD_TOKEN_REQUIRED/);
});

test("R2 is created idempotently by Wrangler before Worker deploy", () => {
  assert.match(source, /wrangler r2 bucket info/);
  assert.match(source, /wrangler r2 bucket create/);
  assert.match(source, /--storage-class Standard/);
  assert.match(source, /ensureBucket.*baseDeployCommand/s);
});

test("R2-enabled releases wait for the Worker build and expose evidence", () => {
  assert.match(
    source,
    /request\.migration \|\| databaseRequired \|\| request\.r2/
  );
  assert.match(source, /r2: \{/);
  assert.match(source, /bucketName: request\.r2 \? r2BucketName/);
  assert.match(
    source,
    /buildCompleted: request\.r2 \? completedBuild\.build_outcome === "success"/
  );
});

test("R2 Workers Build contract is part of AppFactory CI", () => {
  assert.equal(
    packageJson.scripts["test:r2-worker-build"],
    "node --test test/r2-worker-build.test.mjs"
  );
  assert.match(ci, /npm run test:r2-worker-build/);
});
