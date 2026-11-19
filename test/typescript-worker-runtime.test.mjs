import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync("src/brownfield-worker.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const { injectHyperdriveBinding, HYPERDRIVE_JSONC_PLACEHOLDER } = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpileModule(fs.readFileSync("src/wrangler-deploy-command.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText
    ).toString("base64")
);

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
    /TYPESCRIPT_WRANGLER_BUILD_COMMAND =\s*\n\s*"npm install --ignore-scripts --no-audit --no-fund && npm run check"/
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


test("npm-workspace recipe is allowed only at /services/api for TypeScript", () => {
  assert.match(source, /TYPESCRIPT_WORKSPACE_ROOT_DIRECTORY = "\/services\/api"/);
  assert.match(
    source,
    /TYPESCRIPT_WORKSPACE_DEPLOY_COMMAND =\s*\n\s*"npm exec --no -- wrangler deploy --config wrangler\.production\.jsonc --keep-vars"/
  );
  assert.match(
    source,
    /runtime === "typescript-wrangler" &&\s*\n\s*rootDirectory === TYPESCRIPT_WORKSPACE_ROOT_DIRECTORY/
  );
  assert.match(source, /rootDirectory !== "\/backend" && !workspaceRecipe/);
  assert.match(source, /ROOT_DIRECTORY_FORBIDDEN/);
  // R2 bootstrap uses the same Wrangler resolution as the recipe.
  assert.match(source, /function wranglerInvocation\(rootDirectory: string\)/);
  assert.match(source, /wranglerInvocation\(request\.rootDirectory\)/);
});

const ID = "0123456789abcdef0123456789abcdef";
const JSONC_DEPLOY = "npm exec --no -- wrangler deploy --config wrangler.production.jsonc --keep-vars";

function bash() {
  if (process.platform !== "win32") return "bash";
  const git = "C:\Program Files\Git\bin\bash.exe";
  return fs.existsSync(git) ? git : "bash";
}

function runInFixture(command, jsonc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-wrangler-"));
  fs.writeFileSync(path.join(dir, "wrangler.production.jsonc"), jsonc);
  const result = spawnSync(bash(), ["-c", command], { cwd: dir, encoding: "utf8" });
  const files = fs.readdirSync(dir);
  const read = (name) => fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), "utf8") : null;
  return { result, files, read, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function capture(command) {
  // Replace the real deploy by a copy of the config Wrangler would receive.
  return command.replace(
    'npm exec --no -- wrangler deploy --config "$APPFACTORY_WRANGLER_CONFIG" --keep-vars',
    'cp "$APPFACTORY_WRANGLER_CONFIG" deployed.jsonc'
  );
}

test("JSONC Hyperdrive id is injected into a temporary config only", () => {
  const built = injectHyperdriveBinding(JSONC_DEPLOY, { binding: "HYPERDRIVE", id: ID });
  assert.equal(built.ok, true);
  assert.match(built.command, /deploy --config "\$APPFACTORY_WRANGLER_CONFIG" --keep-vars/);
  const committed = `{\n  // comment\n  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "${HYPERDRIVE_JSONC_PLACEHOLDER}" }]\n}\n`;
  const run = runInFixture(capture(built.command), committed);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.match(run.read("deployed.jsonc"), new RegExp(`"id": "${ID}"`));
    assert.doesNotMatch(run.read("deployed.jsonc"), new RegExp(HYPERDRIVE_JSONC_PLACEHOLDER));
    assert.equal(run.read("wrangler.production.jsonc"), committed);
    assert.deepEqual(run.files.filter((f) => f.startsWith(".appfactory-wrangler.")), []);
  } finally {
    run.cleanup();
  }
});

test("JSONC Hyperdrive injection fails closed without exactly one placeholder", () => {
  const built = injectHyperdriveBinding(JSONC_DEPLOY, { binding: "HYPERDRIVE", id: ID });
  for (const committed of [
    `{ "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "00000000000000000000000000000000" }] }`,
    `{ "a": "${HYPERDRIVE_JSONC_PLACEHOLDER}", "b": "${HYPERDRIVE_JSONC_PLACEHOLDER}" }`
  ]) {
    const run = runInFixture(capture(built.command), committed);
    try {
      assert.notEqual(run.result.status, 0);
      assert.match(run.result.stderr, /exactly once/);
      assert.equal(run.read("deployed.jsonc"), null);
      assert.deepEqual(run.files.filter((f) => f.startsWith(".appfactory-wrangler.")), []);
    } finally {
      run.cleanup();
    }
  }
});

test("Hyperdrive injection rejects unsafe identities and unknown recipes", () => {
  for (const identity of [
    { binding: "DB", id: ID },
    { binding: "HYPERDRIVE", id: "" },
    { binding: "HYPERDRIVE", id: "x'; rm -rf /" },
    { binding: "HYPERDRIVE", id: HYPERDRIVE_JSONC_PLACEHOLDER }
  ]) {
    const built = injectHyperdriveBinding(JSONC_DEPLOY, identity);
    assert.equal(built.ok, false);
    assert.equal(built.code, "HYPERDRIVE_DEPLOY_BINDING_INVALID");
  }
  const unknown = injectHyperdriveBinding("npx wrangler deploy", { binding: "HYPERDRIVE", id: ID });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "HYPERDRIVE_DEPLOY_RECIPE_UNSUPPORTED");
});

test("TOML Hyperdrive recipe is unchanged", () => {
  const built = injectHyperdriveBinding(
    "bash scripts/package_worker.sh deploy wrangler.production.toml",
    { binding: "HYPERDRIVE", id: ID }
  );
  assert.equal(built.ok, true);
  assert.equal(
    built.command,
    'APPFACTORY_WRANGLER_CONFIG="$(mktemp .appfactory-wrangler.XXXXXX.toml)" && ' +
      'cp wrangler.production.toml "$APPFACTORY_WRANGLER_CONFIG" && ' +
      `printf '%b' '\\n[[hyperdrive]]\\nbinding = "HYPERDRIVE"\\nid = "${ID}"\\n' >> "$APPFACTORY_WRANGLER_CONFIG" && ` +
      `( trap 'rm -f "$APPFACTORY_WRANGLER_CONFIG"' EXIT; bash scripts/package_worker.sh deploy "$APPFACTORY_WRANGLER_CONFIG" )`
  );
});
