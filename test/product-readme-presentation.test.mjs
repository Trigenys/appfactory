import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderPresentationHero, auditPresentation, syncPresentationHero,
  planPresentationSync, validatePresentation, HERO_END
} from '../scripts/product-readme-presentation.mjs';
import { renderProductReadme, auditProductReadme } from '../scripts/product-readme-contract.mjs';

function contract(name = 'Signal Ledger') {
  return {
    schemaVersion: 1, name, stage: 'design',
    tagline: 'Every signal deserves a defensible explanation and a clear engineering boundary.',
    problem: 'Events distributed across independently managed services can obscure operational incidents, leading to late identification and a confusing trail of evidence.',
    scenario: 'A support engineer sees a suspicious cluster of events across several sources and must identify the exact sequence rather than rely on a vague AI generated guess.',
    differentiation: 'Every incident explanation is backed by evidence identifiers, deterministic rules and a documented trust boundary; no marketing claims are treated as implementation proof.',
    architecture: 'Event -> validate source -> normalize -> policy engine -> evidence -> human review -> optional alert delivery, with strict tenant boundaries.',
    limitations: 'This is a design-stage prototype with no released production service and no certified defenses.',
    capabilities: [
      { name: 'Normalize events', description: 'Validate input sources and standardize resource identity for event analysis.', status: 'planned' },
      { name: 'Explain detections', description: 'Produce reproducible human-readable incident evidence summaries.', status: 'planned' }
    ],
    roadmap: [
      { name: 'Contract', exitCriteria: 'All event schemas pass validation and adversarial test fixtures.' },
      { name: 'Policy', exitCriteria: 'Verified authorization tests prevent cross-tenant event access.' }
    ],
    references: [
      { name: 'NIST CSF', url: 'https://www.nist.gov/cyberframework', relevance: 'Guides detection and response planning.' }
    ],
    presentation: {
      variant: 'centered',
      headline: 'Every event is a clue. Context is the defense.',
      summary: 'A product-specific, evidence-first security layer that explains why an event matters without overstating what has been implemented.',
      badges: [
        { label: 'Maturity', value: 'Design stage', color: 'orange', href: '#the-problem' },
        { label: 'Security', value: 'Evidence first', color: '263238', href: '#industry-references' },
        { label: 'Governance', value: 'RAIDER', color: '0969da', href: '#delivery-roadmap' }
      ],
      navigation: [
        { label: 'Problem', href: '#the-problem' },
        { label: 'Architecture', href: '#how-the-system-is-designed-to-work' },
        { label: 'Roadmap', href: '#delivery-roadmap' }
      ]
    }
  };
}

test('hero includes centered GitHub-native badge shields and navigation links', () => {
  const spec = contract();
  const hero = renderPresentationHero(spec);
  assert.match(hero, /^<!-- appfactory:hero:start -->\n<div align="center">/);
  assert.match(hero, /# Signal Ledger/);
  assert.match(hero, /https:\/\/img\.shields\.io\/badge\/Maturity-Design%20stage-orange/);
  assert.match(hero, /\[\*\*Architecture\*\*\]\(#how-the-system-is-designed-to-work\)/);
  assert.match(hero, /<\/div>\n\n---\n<!-- appfactory:hero:end -->$/);
});

test('render and audit enforce actual structure, not just generic README contents', () => {
  const spec = contract();
  const readme = renderProductReadme(spec);
  assert.deepEqual(auditProductReadme(spec, readme).findings, []);
  assert.ok(!readme.includes('> **' + spec.tagline + '**'));
  const withoutBadges = readme.replace(/https:\/\/img\.shields\.io\/badge\/Maturity/, 'https://invalid.example/badge/Maturity');
  assert.ok(auditProductReadme(spec, withoutBadges).findings.some(f => /Hero, badges or navigation/.test(f)));
  const missingAnchor = readme.replace('## Delivery roadmap', '## Plans');
  assert.ok(auditProductReadme(spec, missingAnchor).findings.some(f => /#delivery-roadmap/.test(f)));
});

test('brownfield migration fails without explicit managed marker', () => {
  const spec = contract();
  const readme = '# Consumer-maintained README\n\nDo not overwrite this.';
  assert.equal(planPresentationSync(spec, readme).action, 'conflict');
  assert.throws(() => syncPresentationHero(spec, readme), /reviewed PR/);
  assert.ok(auditPresentation(spec, readme).some(f => /Missing a contract-managed/.test(f)));
});

test('managed hero updates in place without touching markdown body; repeated use is a no-op', () => {
  const spec = contract();
  const readme = renderProductReadme(spec) + '\n\nCustom conclusion that must be preserved.\n';
  const changed = structuredClone(spec);
  changed.presentation.headline = 'Independent trust boundaries. Auditable actions.';
  assert.equal(planPresentationSync(changed, readme).action, 'update-managed-hero');
  const updated = syncPresentationHero(changed, readme);
  assert.match(updated, /Custom conclusion that must be preserved\./);
  assert.ok(updated.slice(updated.indexOf(HERO_END) + HERO_END.length) ===
    readme.slice(readme.indexOf(HERO_END) + HERO_END.length));
  assert.equal(planPresentationSync(changed, updated).action, 'no-op');
  assert.equal(syncPresentationHero(changed, updated), updated);
});

test('badges and links reject script URLs, traversal, HTML, duplicates and unsafe colors', () => {
  for (const [field, value] of [
    ['badges', [{ label: 'Safety', value: 'Injected', color: 'red', href: 'javascript:alert(1)' }]],
    ['badges', [{ label: 'Safety', value: 'Injected', color: 'url(red)', href: '#the-problem' }]],
    ['badges', [{ label: 'Safety', value: '<img>', color: 'blue', href: '#the-problem' }]],
    ['navigation', [{ label: 'Secret', href: '../secrets.md' }]]
  ]) {
    const spec = contract();
    spec.presentation[field][0] = value[0];
    assert.throws(() => validatePresentation(spec.presentation));
  }
  const duplicate = contract();
  duplicate.presentation.navigation[1].href = '#the-problem';
  assert.throws(() => validatePresentation(duplicate.presentation), /Duplicate navigation/);
});

test('a different named product consumes the same visual contract without special-case code', () => {
  const spec = contract('Credential Harbor');
  spec.presentation.headline = 'A convincing PDF is not proof of issuance.';
  spec.presentation.summary = 'A trust-focused credential service that validates origin and status instead of assigning unwarranted authenticity to document appearance.';
  spec.presentation.badges[1] = {
    label: 'Standards', value: 'W3C VC 2.0', color: '115e59', href: '#industry-references'
  };
  const rendered = renderProductReadme(spec);
  assert.match(rendered, /Credential Harbor/);
  assert.match(rendered, /A convincing PDF is not proof of issuance/);
  assert.deepEqual(auditProductReadme(spec, rendered).findings, []);
});
