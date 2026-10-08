import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/brownfield-worker.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");

test("TypeScript/Wrangler is an explicit reusable brownfield runtime", () => {
  assert.match(source, /export type BrownfieldWorkerRuntime/);
  assert.match(source, /"python-pywrangler"/);
  assert.match(source, /"typescript-wrangler"/);
  assert.match(source, /const runtime = input\.runtime \|\| "python-pywrangler"/);
  assert.match(source, /WORKER_RUNTIME_FORBIDDEN/);
});

test("TypeScript runtime uses one reviewed deterministic recipe", () => {
  assert.match(
    source,
    /TYPESCRIPT_WRANGLER_BUILD_COMMAND =\s*\n\s*"npm ci --ignore-scripts && npm run check"/
  );
  assert.match(
    source,
    /TYPESCRIPT_WRANGLER_DEPLOY_COMMAND =\s*\n\s*"\.\/node_modules\/\.bin\/wrangler deploy --config wrangler\.production\.jsonc --keep-vars"/
  );
  assert.match(source, /rootDirectory = input\.rootDirectory \|\| "\/backend"/);
  assert.match(source, /BUILD_COMMAND_FORBIDDEN/);
  assert.match(source, /buildVariables\.NODE_VERSION = \{/);
  assert.match(source, /value: "24"/);
});

test("runtime identity is ownership evidence without breaking legacy Python markers", () => {
  assert.match(source, /runtime\?: BrownfieldWorkerRuntime/);
  assert.match(
    source,
    /\(marker\.runtime \|\| "python-pywrangler"\) !== request\.runtime/
  );
  assert.match(
    source,
    /request\.runtime === "python-pywrangler" \? \{\} : \{ runtime: request\.runtime \}/
  );
});

test("Python Alembic gate cannot be mixed into TypeScript runtime", () => {
  assert.match(
    source,
    /runtime === "typescript-wrangler" && input\.migration/
  );
  assert.match(source, /MIGRATION_RUNTIME_FORBIDDEN/);
});

test("runtime contract is part of AppFactory CI", () => {
  assert.equal(
    packageJson.scripts["test:typescript-worker-runtime"],
    "node --test test/typescript-worker-runtime.test.mjs"
  );
  assert.match(ci, /npm run test:typescript-worker-runtime/);
});
