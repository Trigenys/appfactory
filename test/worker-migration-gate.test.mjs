import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync("src/brownfield-worker.ts", "utf8");
const hyperdrive = fs.readFileSync("src/hyperdrive.ts", "utf8");

test("migration gate exposes only a reviewed Alembic recipe", () => {
  assert.match(worker, /recipe: "python-alembic"/);
  assert.match(worker, /MIGRATION_RECIPE_FORBIDDEN/);
  assert.match(worker, /ALEMBIC_MIGRATION_COMMAND/);
  assert.match(worker, /MIGRATION_VENV="\$\(mktemp -d\)"/);
  assert.match(worker, /uv venv --python 3\.13/);
  assert.match(worker, /"\$MIGRATION_VENV\/bin\/alembic" upgrade head/);
  assert.doesNotMatch(worker, /uv sync --group dev/);
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

test("Workers Builds polling stays inside the free-plan subrequest budget", () => {
  assert.match(worker, /WORKER_BUILD_POLL_INTERVAL_MS = 15_000/);
  assert.match(worker, /WORKER_BUILD_MAX_POLLS = 12/);
  assert.match(worker, /attempt < WORKER_BUILD_MAX_POLLS/);
  assert.match(worker, /setTimeout\(resolve, WORKER_BUILD_POLL_INTERVAL_MS\)/);
  assert.doesNotMatch(worker, /attempt < 90/);
});

test("complex release commands are passed through Workers Builds environment variables", () => {
  assert.match(worker, /deployCommandRequiresBuildEnv/);
  assert.match(worker, /bash -lc "\$APPFACTORY_DEPLOY_COMMAND"/);
  assert.match(worker, /buildVariables\.APPFACTORY_DEPLOY_COMMAND/);
  assert.match(worker, /value: releaseDeployCommand/);
  assert.match(worker, /is_secret: false/);
  assert.match(worker, /configureBuildEnvironment\(env, trigger\.trigger_uuid, buildVariables\)/);
});

test("migration identity is deterministic and marker-backed", () => {
  assert.match(worker, /MIGRATION_PROFILE_FORBIDDEN/);
  assert.match(worker, /MIGRATION_DATABASE_ENV_FORBIDDEN/);
  assert.match(worker, /migrationRecipe\?: "python-alembic"/);
  assert.match(worker, /migrationProfile\?: string/);
  assert.match(worker, /databaseUrlEnv\?: string/);
});
