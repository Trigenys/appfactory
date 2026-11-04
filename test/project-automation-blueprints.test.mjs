import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const runtime = '0523510a8e42290df3bae5749d034b1637569af5';
const broker = 'https://appfactory-project-token-broker.lawrynnjennifer.workers.dev/v1/github/user-token';
const blueprintPaths = fs
  .readdirSync(new URL('blueprints/', root), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `blueprints/${entry.name}/.github/workflows/project-automation.yml`)
  .filter((path) => fs.existsSync(new URL(path, root)))
  .sort();
const platformPath = '.github/workflows/project-automation.yml';

test('Project Automation contract covers every blueprint that ships the workflow', () => {
  assert.ok(blueprintPaths.length >= 5, `expected at least 5 blueprints, found ${blueprintPaths.length}`);
});

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

test('AppFactory and all generated product blueprints share one Project automation workflow', () => {
  const workflows = [platformPath, ...blueprintPaths].map((path) =>
    fs.readFileSync(new URL(path, root), 'utf8')
  );
  for (const workflow of workflows.slice(1)) {
    assert.equal(workflow, workflows[0], 'Project Automation workflows drifted: align the runtime pin everywhere');
  }
});


test('generic TypeScript API release is manual-only until the product opts in', () => {
  const workflow = fs.readFileSync(
    new URL('blueprints/typescript-api/.github/workflows/release.yml', root),
    'utf8'
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s*push:/);
});
