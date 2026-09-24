import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, root), 'utf8');
}

test('managed blueprint v3 markers are promoted for mobile and service', () => {
  const mobile = JSON.parse(read('blueprints/android-compose/.appfactory/mobile.json'));
  const service = JSON.parse(read('blueprints/entitlements/.appfactory/service.json'));

  assert.equal(mobile.blueprintVersion, 3);
  assert.equal(service.blueprintVersion, 3);
});

test('managed upgrades preserve the existing repository tree and history', () => {
  const helper = read('src/managed-blueprint-upgrade.ts');

  assert.match(helper, /base_tree: treeSha/);
  assert.match(helper, /parents: \[headSha\]/);
  assert.match(helper, /force: false/);
  assert.match(helper, /Managed blueprint upgrade must declare at least one file/);
});

test('mobile v1 to v3 upgrade owns only Project automation and its marker', () => {
  const source = read('src/mobile-provisioning.ts');

  assert.match(source, /const BLUEPRINT_VERSION = 3/);
  assert.match(source, /fromVersion !== 1 \|\| BLUEPRINT_VERSION !== 2/);
  assert.match(source, /"\.github\/workflows\/project-automation\.yml"/);
  assert.match(source, /"\.appfactory\/mobile\.json"/);
  assert.match(source, /refusing to downgrade/);
  assert.match(source, /upgraded: true/);
});

test('service v1 to v3 upgrade owns only Project automation and its marker', () => {
  const source = read('src/service-provisioning.ts');

  assert.match(source, /const BLUEPRINT_VERSION = 3/);
  assert.match(source, /fromVersion !== 1 \|\| BLUEPRINT_VERSION !== 2/);
  assert.match(source, /"\.github\/workflows\/project-automation\.yml"/);
  assert.match(source, /"\.appfactory\/service\.json"/);
  assert.match(source, /refusing to downgrade/);
  assert.match(source, /upgraded: true/);
});

test('API reports blueprint upgrades and no longer instructs users to configure a PAT', () => {
  const source = read('src/index.ts');

  assert.match(source, /blueprintUpgrade:/);
  assert.match(source, /Project Automation is preconfigured through GitHub Actions OIDC/);
  assert.doesNotMatch(source, /Reuse an existing project-capable PROJECT_TOKEN/);
  assert.match(source, /mobileBlueprintVersion: 3/);
  assert.match(source, /serviceBlueprintVersion: 3/);
});
