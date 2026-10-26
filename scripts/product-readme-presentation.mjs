/**
 * AppFactory README presentation contract: generic, GitHub-native,
 * read-only audits and safe updates limited to a marked hero region.
 */
export const HERO_START = '<!-- appfactory:hero:start -->';
export const HERO_END = '<!-- appfactory:hero:end -->';

const COLORS = /^(?:[0-9a-fA-F]{6}|blue|green|red|orange|yellow|lightgrey|brightgreen|informational|inactive|critical|important|success)$/;

function plain(value, field, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    throw new Error(field + ' needs at least ' + minimum + ' characters.');
  }
  if (/[\r\n<>]/.test(value)) throw new Error(field + ' must be plain text without HTML/newlines.');
  return value.trim();
}

function safeLink(value, field) {
  plain(value, field);
  if (!(/^(?:#[a-z0-9][a-z0-9-]*|https:\/\/[a-zA-Z0-9.-]+(?:\/[^\s<>]*)?|(?:docs\/)?[a-zA-Z0-9_./-]+\.md(?:#[a-z0-9-]+)?)$/.test(value))) {
    throw new Error(field + ' needs a section anchor, HTTPS link, or relative Markdown path.');
  }
  if (value.includes('../')) throw new Error(field + ' cannot traverse parent paths.');
  return value;
}

function badgeText(text) { return encodeURIComponent(text).replace(/-/g, '--'); }

function slug(heading) {
  return heading.toLowerCase().replace(/<[^>]*>/g, '')
    .replace(/[\x60*_~]/g, '').replace(/[^\p{L}\p{N} -]/gu, '')
    .trim().replace(/\s+/g, '-');
}

export function validatePresentation(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || spec.variant !== 'centered') {
    throw new Error('presentation.variant must be centered.');
  }
  plain(spec.headline, 'presentation.headline', 18);
  plain(spec.summary, 'presentation.summary', 45);
  if (!Array.isArray(spec.badges) || spec.badges.length < 2 || spec.badges.length > 5) {
    throw new Error('presentation.badges requires two to five badges.');
  }
  if (!Array.isArray(spec.navigation) || spec.navigation.length < 3 || spec.navigation.length > 8) {
    throw new Error('presentation.navigation requires three to eight links.');
  }
  const labels = new Set();
  for (const [i, badge] of spec.badges.entries()) {
    if (!badge || typeof badge !== 'object') throw new Error('Invalid badge at ' + i);
    plain(badge.label, 'badge.label'); plain(badge.value, 'badge.value');
    if (typeof badge.color !== 'string' || !COLORS.test(badge.color)) {
      throw new Error('Invalid badge.color at ' + i);
    }
    safeLink(badge.href, 'badge.href');
    if (labels.has(badge.label.toLowerCase())) throw new Error('Duplicate badge label.');
    labels.add(badge.label.toLowerCase());
  }
  const destinations = new Set();
  for (const [i, item] of spec.navigation.entries()) {
    if (!item || typeof item !== 'object') throw new Error('Invalid navigation item at ' + i);
    plain(item.label, 'navigation.label'); safeLink(item.href, 'navigation.href');
    if (destinations.has(item.href)) throw new Error('Duplicate navigation destination.');
    destinations.add(item.href);
  }
  return spec;
}

export function renderPresentationHero(spec) {
  validatePresentation(spec.presentation);
  const p = spec.presentation;
  const badges = p.badges.map(badge => {
    const url = 'https://img.shields.io/badge/' + badgeText(badge.label) + '-' +
      badgeText(badge.value) + '-' + badge.color;
    return '[![' + badge.label + ': ' + badge.value + '](' + url + ')](' + badge.href + ')';
  });
  const navigation = p.navigation
    .map(item => '[**' + item.label + '**](' + item.href + ')')
    .join(' · ');
  return [
    HERO_START,
    '<div align="center">',
    '',
    '# ' + plain(spec.name, 'name'),
    '',
    '### ' + p.headline.trim(),
    '',
    '**' + p.summary.trim() + '**',
    '',
    badges.join('\n'),
    '',
    navigation,
    '',
    '</div>',
    '',
    '---',
    HERO_END
  ].join('\n');
}

function managedRegion(readme) {
  const first = readme.indexOf(HERO_START);
  const last = readme.indexOf(HERO_END);
  if (first !== 0 || last < 0 || last < first ||
      readme.indexOf(HERO_START, first + HERO_START.length) >= 0 ||
      readme.indexOf(HERO_END, last + HERO_END.length) >= 0) return null;
  return { end: last + HERO_END.length, content: readme.slice(0, last + HERO_END.length) };
}

export function planPresentationSync(spec, readme) {
  validatePresentation(spec.presentation);
  if (typeof readme !== 'string') throw new TypeError('README must be a string.');
  const region = managedRegion(readme);
  if (!region) return {
    action: 'conflict',
    reason: 'No unique AppFactory-managed hero at the start: adopt via reviewed PR, not a destructive replacement.'
  };
  return region.content === renderPresentationHero(spec)
    ? { action: 'no-op', reason: 'The README hero matches the manifest.' }
    : { action: 'update-managed-hero', reason: 'Only the explicitly managed hero block will change.' };
}

export function syncPresentationHero(spec, readme) {
  const result = planPresentationSync(spec, readme);
  if (result.action === 'conflict') throw new Error(result.reason);
  if (result.action === 'no-op') return readme;
  const region = managedRegion(readme);
  return renderPresentationHero(spec) + readme.slice(region.end);
}

export function auditPresentation(spec, readme) {
  validatePresentation(spec.presentation);
  const findings = [];
  const region = typeof readme === 'string' ? managedRegion(readme) : null;
  if (!region) {
    findings.push('Missing a contract-managed centered hero at the start of the README.');
    return findings;
  }
  if (region.content !== renderPresentationHero(spec)) {
    findings.push('Hero, badges or navigation differ from the presentation contract.');
  }
  const body = readme.slice(region.end);
  const slugs = new Set([...body.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map(match => slug(match[1])));
  for (const item of [...spec.presentation.navigation, ...spec.presentation.badges]) {
    if (item.href.startsWith('#') && !slugs.has(item.href.slice(1))) {
      findings.push('Linked section absent from README body: ' + item.href);
    }
  }
  return findings;
}
