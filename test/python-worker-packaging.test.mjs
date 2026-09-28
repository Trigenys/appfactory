import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/brownfield-worker.ts", "utf8");

test("runtime-only Python Worker recipe is allowlisted", () => {
  assert.match(
    source,
    /RUNTIME_ONLY_BUILD_COMMAND\s*=\s*[\s\S]*?bash scripts\/package_worker\.sh dry-run wrangler\.production\.toml \.\.\/worker-dist-production/
  );
  assert.match(
    source,
    /RUNTIME_ONLY_DEPLOY_COMMAND\s*=\s*[\s\S]*?bash scripts\/package_worker\.sh deploy wrangler\.production\.toml/
  );
});

test("build and deploy commands must come from the same reviewed recipe", () => {
  assert.match(source, /const allowedRecipes = new Set/);
  assert.match(source, /LEGACY_BUILD_COMMAND.*LEGACY_DEPLOY_COMMAND/s);
  assert.match(source, /RUNTIME_ONLY_BUILD_COMMAND.*RUNTIME_ONLY_DEPLOY_COMMAND/s);
  assert.match(source, /without mixing build and deploy commands/);
});

test("reviewed packaging recipe changes update the marker instead of changing Worker identity", () => {
  assert.match(source, /const recipeChanged = Boolean/);
  assert.match(source, /marker\.buildCommand !== expectedMarker\.buildCommand/);
  assert.match(source, /marker\.deployCommand !== expectedMarker\.deployCommand/);
  assert.match(source, /recipeChanged[\s\S]*?writeMarker\(githubToken, repository, expectedMarker, markerFile\?\.sha\)/);
});
