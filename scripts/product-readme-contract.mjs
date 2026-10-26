#!/usr/bin/env node
/**
 * AppFactory Product README contract v1.
 *
 * Pure product narrative model + read-only audit + non-destructive greenfield
 * creation. Consumer-specific copy lives in a declarative manifest, never
 * in branches keyed to a repository or product name.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const STAGES = new Set(['idea', 'design', 'prototype', 'mvp', 'beta', 'production']);
const STATUSES = new Set(['planned', 'in-development', 'shipped']);

function assertMeaningful(value, field, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new Error(field + ' requires at least ' + min + ' characters of project-specific text.');
  }
  if (/\b(todo|tbd|lorem ipsum|your project name|coming soon)\b/i.test(value)) {
    throw new Error(field + ' contains a placeholder; replace it with verifiable product content.');
  }
  return value.trim();
}

function validateList(value, field, min) {
  if (!Array.isArray(value) || value.length < min) {
    throw new Error(field + ' must contain at least ' + min + ' items.');
  }
  return value;
}

export function validateReadmeManifest(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || spec.schemaVersion !== 1) {
    throw new Error('README manifest requires schemaVersion: 1.');
  }
  for (const [field, minimum] of [
    ['name', 3], ['tagline', 20], ['problem', 70],
    ['scenario', 60], ['differentiation', 50],
    ['architecture', 50], ['limitations', 40]
  ]) {
    assertMeaningful(spec[field], field, minimum);
  }
  if (!STAGES.has(spec.stage)) throw new Error('Invalid product stage: ' + String(spec.stage));
  validateList(spec.capabilities, 'capabilities', 2).forEach((item, index) => {
    assertMeaningful(item.name, 'capabilities[' + index + '].name', 3);
    assertMeaningful(item.description, 'capabilities[' + index + '].description', 20);
    if (!STATUSES.has(item.status)) {
      throw new Error('Invalid capability status at index ' + index);
    }
    if (item.status === 'shipped') {
      assertMeaningful(item.evidence, 'capabilities[' + index + '].evidence', 8);
    }
  });
  validateList(spec.roadmap, 'roadmap', 2).forEach((item, index) => {
    assertMeaningful(item.name, 'roadmap[' + index + '].name', 3);
    assertMeaningful(item.exitCriteria, 'roadmap[' + index + '].exitCriteria', 15);
  });
  validateList(spec.references, 'references', 1).forEach((item, index) => {
    assertMeaningful(item.name, 'references[' + index + '].name');
    if (typeof item.url !== 'string' || !/^https:\/\/[^/\s]+\//i.test(item.url)) {
      throw new Error('references[' + index + '] needs an HTTPS source URL.');
    }
    assertMeaningful(item.relevance, 'references[' + index + '].relevance', 12);
  });
  if (spec.requiredHeadings !== undefined) {
    validateList(spec.requiredHeadings, 'requiredHeadings', 1)
      .forEach((item) => assertMeaningful(item, 'requiredHeadings item'));
  }
  if (spec.requiredTerms !== undefined) {
    validateList(spec.requiredTerms, 'requiredTerms', 1)
      .forEach((item) => assertMeaningful(item, 'requiredTerms item'));
  }
  if (spec.requiredFiles !== undefined) {
    if (!Array.isArray(spec.requiredFiles)) throw new Error('requiredFiles must be an array.');
    spec.requiredFiles.forEach((item) => assertMeaningful(item, 'requiredFiles item'));
  }
  return spec;
}

export function renderProductReadme(spec) {
  validateReadmeManifest(spec);
  const capabilities = spec.capabilities.map((item) => {
    const evidence = item.status === 'shipped' ? ' — Evidence: ' + item.evidence : '';
    return '- **' + item.name + '** (' + item.status + ') — ' + item.description + evidence;
  });
  return [
    '# ' + spec.name,
    '',
    '> **' + spec.tagline + '**',
    '',
    '**Product maturity:** ' + spec.stage + '. **Scope:** capabilities below are explicitly marked as planned, in-development or shipped.',
    '',
    '## The problem',
    '',
    spec.problem,
    '',
    '## A concrete failure mode',
    '',
    spec.scenario,
    '',
    '## What makes this approach different',
    '',
    spec.differentiation,
    '',
    '## How the system is designed to work',
    '',
    spec.architecture,
    '',
    '## Capabilities and verified status',
    '',
    ...capabilities,
    '',
    '## Delivery roadmap',
    '',
    ...spec.roadmap.map((item) => '- **' + item.name + '** — Exit criterion: ' + item.exitCriteria),
    '',
    '## Industry references',
    '',
    ...spec.references.map((item) => '- [' + item.name + '](' + item.url + ') — ' + item.relevance),
    '',
    'These references inform design. They do not establish third-party certification, audit results or conformance.',
    '',
    '## Limitations and non-goals',
    '',
    spec.limitations,
    ''
  ].join('\n');
}

function normalize(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function auditProductReadme(spec, readme, { fileExists = () => true } = {}) {
  validateReadmeManifest(spec);
  if (typeof readme !== 'string') throw new TypeError('README input must be text.');
  const findings = [];
  const normalized = normalize(readme);
  const headings = [...readme.matchAll(/^\s*#{1,6}\s+(.+?)\s*$/gm)]
    .map((match) => normalize(match[1]));
  if (!normalized.includes(normalize(spec.name))) findings.push('Missing product name: ' + spec.name);
  if (!normalized.includes(normalize(spec.stage))) findings.push('Missing declared product maturity: ' + spec.stage);
  for (const heading of spec.requiredHeadings ?? [
    'The problem', 'How the system is designed to work', 'Delivery roadmap', 'Limitations and non-goals'
  ]) {
    if (!headings.some((item) => item.includes(normalize(heading)))) {
      findings.push('Missing required README heading: ' + heading);
    }
  }
  for (const term of spec.requiredTerms ?? []) {
    if (!normalized.includes(normalize(term))) findings.push('Missing required product-specific term: ' + term);
  }
  for (const file of spec.requiredFiles ?? []) {
    if (!fileExists(file)) findings.push('Referenced local evidence does not exist: ' + file);
  }
  for (const capability of spec.capabilities) {
    if (capability.status === 'shipped' && !normalized.includes(normalize(capability.evidence))) {
      findings.push('Shipped capability lacks its declared evidence link: ' + capability.name);
    }
  }
  return { ok: findings.length === 0, findings };
}

export function planReadmeCreation(existingReadme, generatedReadme) {
  if (existingReadme === null || existingReadme === undefined) {
    return { action: 'create', reason: 'README does not exist.' };
  }
  if (existingReadme === generatedReadme) {
    return { action: 'no-op', reason: 'README matches the generated content.' };
  }
  return {
    action: 'conflict',
    reason: 'README already exists with different content. AppFactory will not overwrite user-maintained documentation.'
  };
}

function parseArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const option = args[i];
    if (!['--mode', '--manifest', '--readme', '--root'].includes(option) || !args[i + 1]) {
      throw new Error('Unknown or missing argument ' + option);
    }
    options[option.slice(2)] = args[i + 1];
    i += 1;
  }
  if (!['audit', 'plan', 'apply'].includes(options.mode)) {
    throw new Error('--mode must be audit, plan or apply.');
  }
  if (!options.manifest) throw new Error('--manifest is required.');
  return options;
}

function resolveInside(root, requested) {
  const resolved = path.resolve(root, requested);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Project path escapes the repository root: ' + requested);
  }
  return resolved;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const root = path.resolve(args.root || process.cwd());
  const spec = JSON.parse(fs.readFileSync(resolveInside(root, args.manifest), 'utf8'));
  const readmePath = resolveInside(root, args.readme || 'README.md');
  const existing = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : null;
  let result;

  if (args.mode === 'audit') {
    result = existing === null
      ? { ok: false, findings: ['README does not exist.'] }
      : auditProductReadme(spec, existing, {
          fileExists: (file) => {
            try { return fs.existsSync(resolveInside(root, file)); } catch { return false; }
          }
        });
  } else {
    const rendered = renderProductReadme(spec);
    result = planReadmeCreation(existing, rendered);
    if (args.mode === 'apply' && result.action === 'create') {
      fs.writeFileSync(readmePath, rendered, { flag: 'wx' });
      result = { action: 'created', path: readmePath };
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.ok === false || result.action === 'conflict') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
