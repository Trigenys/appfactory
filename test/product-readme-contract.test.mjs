import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validateReadmeManifest,
  renderProductReadme,
  auditProductReadme,
  planReadmeCreation
} from '../scripts/product-readme-contract.mjs';

const script = fileURLToPath(new URL('../scripts/product-readme-contract.mjs', import.meta.url));

function specification() {
  return {
    schemaVersion: 1,
    name: 'Demo Boundary',
    stage: 'design',
    tagline: 'Every sensitive operation must pass deterministic authorization first.',
    problem: 'A delegated automated assistant can read external material that contains malicious instructions and mistakenly treat those instructions as new authorizations from the user.',
    scenario: 'A document requests that a financial tool change stored payment details, although the user only gave the assistant permission to read and summarize the document.',
    differentiation: 'A deterministic tool policy evaluates the authenticated identity and exact action before execution; heuristic model output cannot override an explicit denial.',
    architecture: 'Authenticated principal => Proposed tool call => Policy gateway => Allow, Deny, Require approval => Audit verifier. Untrusted context must never become authority.',
    limitations: 'This prototype does not guarantee detection of all attacks and cannot protect tool execution paths that bypass the gateway.',
    capabilities: [
      { name: 'Tool policy', status: 'planned', description: 'Enforce resource-scoped authorization at every intercepted call.' },
      { name: 'Event verification', status: 'shipped', description: 'Validate the integrity of local test events with the verifier.', evidence: 'docs/verification.md' }
    ],
    roadmap: [
      { name: 'Foundation', exitCriteria: 'Validated trust boundaries and automated negative authorization tests.' },
      { name: 'Verification', exitCriteria: 'Repeatable independent verification of event ordering and integrity.' }
    ],
    references: [
      { name: 'MITRE ATLAS', url: 'https://atlas.mitre.org/', relevance: 'Provides a catalog of adversarial AI behaviors.' }
    ]
  };
}

test('render is deterministic and distinguishes planned from shipped capabilities', () => {
  const contract = specification();
  const markdown = renderProductReadme(contract);
  assert.equal(renderProductReadme(contract), markdown);
  assert.match(markdown, /Tool policy\*\* \(planned\)/);
  assert.match(markdown, /Event verification\*\* \(shipped\)/);
  assert.match(markdown, /Evidence: docs\/verification\.md/);
  assert.match(markdown, /do not establish third-party certification/i);
  assert.equal(auditProductReadme(contract, markdown).ok, true);
});

test('contract rejects boilerplate, missing evidence and unknown maturity', () => {
  const boilerplate = specification(); boilerplate.problem = 'TODO';
  assert.throws(() => validateReadmeManifest(boilerplate), /project-specific|placeholder/);
  const fabricated = specification(); fabricated.capabilities[1].evidence = '';
  assert.throws(() => validateReadmeManifest(fabricated), /evidence/);
  const invalid = specification(); invalid.stage = 'enterprise-grade';
  assert.throws(() => validateReadmeManifest(invalid), /Invalid product stage/);
});

test('custom audit matches existing brownfield README without replacing it', () => {
  const contract = {
    ...specification(),
    requiredHeadings: ['The challenge', 'Security architecture', 'Roadmap', 'Known limitations'],
    requiredTerms: ['deny-by-default', 'OWASP'],
    requiredFiles: ['docs/SECURITY.md']
  };
  const brownfield = [
    '# Demo Boundary',
    '**design maturity**',
    '## The challenge',
    'deny-by-default protection referencing OWASP',
    '## Security architecture',
    '## Roadmap',
    '## Known limitations',
    'Evidence: docs/verification.md'
  ].join('\n');
  assert.deepEqual(auditProductReadme(contract, brownfield, { fileExists: () => true }).findings, []);
  assert.deepEqual(
    auditProductReadme(contract, brownfield, { fileExists: () => false }).findings,
    ['Referenced local evidence does not exist: docs/SECURITY.md']
  );
});

test('create plan is idempotent and existing custom READMEs are never overwritten', () => {
  assert.equal(planReadmeCreation(null, 'new').action, 'create');
  assert.equal(planReadmeCreation('new', 'new').action, 'no-op');
  assert.equal(planReadmeCreation('a custom authored document', 'new').action, 'conflict');
});

test('CLI plan/apply is safe, repeatable and refuses overwriting a consumer README', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-contract-'));
  try {
    fs.writeFileSync(path.join(root, 'product.json'), JSON.stringify(specification()));
    const run = (mode) => execFileSync(process.execPath, [script, '--mode', mode, '--manifest', 'product.json', '--root', root], { encoding: 'utf8' });
    assert.equal(JSON.parse(run('plan')).action, 'create');
    assert.equal(JSON.parse(run('apply')).action, 'created');
    const created = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.equal(JSON.parse(run('plan')).action, 'no-op');
    assert.equal(JSON.parse(run('audit')).ok, true);
    fs.writeFileSync(path.join(root, 'README.md'), 'Custom author content');
    const failed = spawnSync(process.execPath, [script, '--mode', 'apply', '--manifest', 'product.json', '--root', root], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /conflict/);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'Custom author content');
    assert.notEqual(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), created);
    const escape = spawnSync(process.execPath, [script, '--mode', 'audit', '--manifest', '../outside.json', '--root', root], { encoding: 'utf8' });
    assert.notEqual(escape.status, 0);
    assert.match(escape.stderr, /escapes the repository root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
