import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/reusable-readme-quality.yml', import.meta.url), 'utf8'
);
const ci = fs.readFileSync(new URL('../.github/workflows/readme-contract-ci.yml', import.meta.url), 'utf8');

test('README quality caller is read-only and explicitly consumer configurable', () => {
  assert.match(workflow, /^  workflow_call:/m);
  assert.match(workflow, /manifest_path:/);
  assert.match(workflow, /readme_path:/);
  assert.match(workflow, /appfactory_ref:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /contents: write|id-token: write|secrets:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:|schedule:/);
});

test('the reusable workflow checks an immutable runtime and never pushes', () => {
  assert.match(workflow, /EXPECTED_SHA/);
  assert.match(workflow, /\[0-9a-f\]\{40\}/);
  assert.match(workflow, /git -C \.appfactory-quality rev-parse HEAD/);
  assert.match(workflow, /--mode audit/);
  assert.doesNotMatch(workflow, /\bgit push\b|--mode apply/);
});

test('README audit has isolated path-scoped dependency-free CI', () => {
  assert.match(ci, /test\/product-readme-contract\.test\.mjs/);
  assert.match(ci, /test\/product-readme-workflow\.test\.mjs/);
  assert.match(ci, /test\/product-readme-presentation\.test\.mjs/);
  assert.match(ci, /paths:/);
  assert.match(ci, /node --test/);
  assert.doesNotMatch(ci, /npm install|wrangler deploy|gradle|cargo check/);
});
