import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync("src/brownfield-worker.ts", "utf8");
const hyperdrive = fs.readFileSync("src/hyperdrive.ts", "utf8");

test("migration gate exposes only a reviewed Alembic recipe", () => {
  assert.match(worker, /recipe: "python-alembic"/);
  assert.match(worker, /MIGRATION_RECIPE_FORBIDDEN/);
  assert.match(worker, /ALEMBIC_MIGRATION_COMMAND/);
  assert.match(worker, /uv run alembic upgrade head/);
  assert.doesNotMatch(worker, /migration\.command/);
});

test("database credentials remain AppFactory-owned and become a masked Workers Builds secret", () => {
  assert.match(hyperdrive, /export function managedDatabaseUrl/);
  assert.match(worker, /managedDatabaseUrl\(env, request\.migration\.profile\)/);
  assert.match(worker, /\/environment_variables/);
  assert.match(worker, /APPFACTORY_DATABASE_URL/);
  assert.match(worker, /is_secret: true/);
});

test("migration runs before deploy and blocks release on failure", () => {
  assert.match(worker, /migrationDeployCommand/);
  assert.match(worker, /ALEMBIC_MIGRATION_COMMAND.*baseDeployCommand/s);
  assert.match(worker, /waitForWorkerBuild/);
  assert.match(worker, /CLOUDFLARE_WORKERS_BUILD_FAILED/);
  assert.match(worker, /CLOUDFLARE_WORKERS_BUILD_TIMEOUT/);
  assert.match(worker, /buildCompleted: request\.migration \? completedBuild\.build_outcome === "success"/);
});

test("migration identity is deterministic and marker-backed", () => {
  assert.match(worker, /MIGRATION_PROFILE_FORBIDDEN/);
  assert.match(worker, /MIGRATION_DATABASE_ENV_FORBIDDEN/);
  assert.match(worker, /migrationRecipe\?: "python-alembic"/);
  assert.match(worker, /migrationProfile\?: string/);
  assert.match(worker, /databaseUrlEnv\?: string/);
});
