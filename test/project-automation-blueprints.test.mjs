import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const runtime = 'b1deb7b1069739879d7a4acb9cd3521bca835049';
const broker = 'https://appfactory-project-token-broker.lawrynnjennifer.workers.dev/v1/github/user-token';
const blueprintPaths = [
  'blueprints/android-compose/.github/workflows/project-automation.yml',
  'blueprints/entitlements/.github/workflows/project-automation.yml',
  'blueprints/tauri-react/.github/workflows/project-automation.yml',
  'blueprints/react-vite/.github/workflows/project-automation.yml'
];

for (const path of blueprintPaths) {
  test(`${path} uses the zero-PAT Project broker contract`, () => {
    const workflow = fs.readFileSync(new URL(path, root), 'utf8');

    assert.doesNotMatch(workflow, /PROJECT_TOKEN|secrets\.PROJECT_TOKEN|project_token:/);
    assert.doesNotMatch(workflow, /client_secret|TOKEN_ENCRYPTION_KEY|GITHUB_CLIENT_SECRET/i);
    assert.match(workflow, /id-token: write/);
    assert.match(
      workflow,
      new RegExp(`reusable-project-automation\\.yml@${runtime}`)
    );
    assert.match(workflow, /authentication: broker-user/);
    assert.ok(workflow.includes(`broker_url: ${broker}`));
    assert.ok(workflow.includes(`appfactory_ref: ${runtime}`));
    assert.match(workflow, /config_path: \.github\/project-config\.json/);
    assert.match(workflow, /issue_number: \$\{\{ inputs\.issue_number \}\}/);
  });
}

test('mobile, service, desktop and webapp blueprints share one Project authentication contract', () => {
  const workflows = blueprintPaths.map((path) =>
    fs.readFileSync(new URL(path, root), 'utf8')
  );
  assert.equal(workflows[0], workflows[1]);
  assert.equal(workflows[0], workflows[2]);
});
