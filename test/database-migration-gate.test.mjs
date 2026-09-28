import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("src/database-migration.ts", "utf8");
const worker = fs.readFileSync("src/brownfield-worker.ts", "utf8");

test("migration gate uses a reviewed Alembic recipe before runtime packaging", () => {
  assert.match(migration, /PYTHON_ALEMBIC_MIGRATION_RECIPE = "python-alembic-v1"/);
  assert.match(
    migration,
    /uv run --group dev alembic upgrade head[sS]*?rm -rf .venv[sS]*?unset APPFACTORY_DATABASE_URL[sS]*?package_worker.sh dry-run/
  );
  assert.match(
    migration,
    /PYTHON_ALEMBIC_DEPLOY_COMMAND[sS]*?unset APPFACTORY_DATABASE_URL[sS]*?package_worker.sh deploy/
  );
  assert.match(worker, /MIGRATION_BUILD_COMMAND_FORBIDDEN/);
});

test("database credentials stay in masked Workers Builds variables", () => {
  assert.match(migration, /DATABASE_URL_VARIABLE = "APPFACTORY_DATABASE_URL"/);
  assert.match(migration, /is_secret: true/);
  assert.match(migration, /databaseSecret.value != null/);
  assert.match(migration, /Workers CI Write/);
  assert.doesNotMatch(worker, /APPFACTORY_DATABASE_URL=.*postgres/);
});

test("migration gate requires the AppFactory Hyperdrive ownership marker", () => {
  assert.match(migration, /HYPERDRIVE_MARKER_PATH = ".appfactory/hyperdrive.json"/);
  assert.match(migration, /HYPERDRIVE_REQUIRED/);
  assert.match(migration, /HYPERDRIVE_MARKER_MISMATCH/);
  assert.match(worker, /MIGRATION_REQUIRES_MANAGED_WORKER/);
});

test("migration-enabled trigger is configured before its marker commit can auto-build", () => {
  const trigger = worker.indexOf("const { trigger, created: triggerCreated }");
  const migrationGate = worker.indexOf("configureDatabaseMigrationGate", trigger);
  const markerComment = worker.indexOf("The marker commit itself can trigger Workers Builds", trigger);
  const markerWrite = worker.indexOf("await writeMarker", markerComment);
  const ensureBuild = worker.indexOf("await ensureBuild", markerWrite);

  assert.ok(trigger >= 0);
  assert.ok(migrationGate > trigger);
  assert.ok(markerComment > migrationGate);
  assert.ok(markerWrite > markerComment);
  assert.ok(ensureBuild > markerWrite);
});

test("retrying the same migration recipe remains idempotent", () => {
  assert.match(migration, /alembic upgrade head/);
  assert.match(migration, /method: "PATCH"/);
  assert.match(migration, /MIGRATION_RECIPE_VARIABLE/);
  assert.match(worker, /marker.migrationRecipe !== expectedMarker.migrationRecipe/);
});

test("migration metadata is observable without returning the database URL", () => {
  assert.match(worker, /migration: {/);
  assert.match(worker, /buildSecret: migration?.buildSecret || null/);
  assert.doesNotMatch(worker, /directDatabaseUrl/);
});
