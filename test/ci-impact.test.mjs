import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { classifyChanges } from "../scripts/ci-impact.mjs";

const config = JSON.parse(fs.readFileSync(".appfactory/ci-impact.json", "utf8"));

test("frontend-only blueprint changes run only the webapp gate", () => {
  const result = classifyChanges(["blueprints/react-vite/src/App.tsx"], config);
  assert.deepEqual(result.gates, {
    core: false,
    android: false,
    desktop: false,
    webapp: true,
    service: false
  });
});


test("generic service blueprint changes run only the service gate", () => {
  const result = classifyChanges(["blueprints/typescript-api/src/server.ts"], config);
  assert.deepEqual(result.gates, {
    core: false,
    android: false,
    desktop: false,
    webapp: false,
    service: true
  });
});

test("platform provisioner changes run core plus their platform gate", () => {
  const result = classifyChanges(["src/mobile-provisioning.ts"], config);
  assert.equal(result.gates.core, true);
  assert.equal(result.gates.android, true);
  assert.equal(result.gates.desktop, false);
  assert.equal(result.gates.webapp, false);
  assert.equal(result.gates.service, false);
});

test("global CI surfaces invalidate every gate", () => {
  const result = classifyChanges([".github/workflows/ci.yml"], config);
  assert.equal(result.forcedAll, true);
  assert.deepEqual(result.gates, {
    core: true,
    android: true,
    desktop: true,
    webapp: true,
    service: true
  });
});

test("documentation and provisioning requests do not trigger product CI", () => {
  const result = classifyChanges([
    "README.md",
    "docs/architecture.md",
    ".appfactory/requests/example.json"
  ], config);
  assert.deepEqual(result.gates, {
    core: false,
    android: false,
    desktop: false,
    webapp: false,
    service: false
  });
  assert.equal(result.ignored.length, 3);
});

test("unknown files fail safe into core instead of silently skipping CI", () => {
  const result = classifyChanges(["future/new-surface.config"], config);
  assert.equal(result.gates.core, true);
  assert.deepEqual(result.fallback, ["future/new-surface.config"]);
});
