import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('public/tv.webmanifest', root), 'utf8'));

test('TV shortcut precedes host redirects and preserves agent mode', () => {
  const index = config.redirects.findIndex(rule => rule.source === '/'
    && rule.has?.some(condition => condition.type === 'query' && condition.key === 'tv' && condition.value === '1'));
  assert.ok(index >= 0);
  const shortcut = config.redirects[index];
  assert.equal(shortcut.destination, '/tv');
  assert.equal(shortcut.permanent, false);
  assert.ok(shortcut.missing?.some(condition => condition.type === 'query'
    && condition.key === 'mode' && condition.value === 'agent'));
  const hostRedirect = config.redirects.findIndex(rule => rule.source === '/'
    && rule.has?.some(condition => condition.type === 'host'));
  assert.ok(index < hostRedirect);
  assert.ok(config.rewrites.some(rule => rule.source === '/'
    && rule.destination === '/agent-view.json'));
});

test('TV path resolves to the application entry and canonicalizes its trailing slash', () => {
  assert.deepEqual(config.rewrites.find(rule => rule.source === '/tv'), {
    source: '/tv', destination: '/dashboard.html',
  });
  assert.equal(config.redirects.find(rule => rule.source === '/tv/')?.destination, '/tv');
});

test('TV installation has a distinct identity and launches TV mode', () => {
  assert.equal(manifest.id, '/tv');
  assert.equal(manifest.start_url, '/tv');
  assert.equal(manifest.display, 'fullscreen');
  assert.equal(manifest.scope, '/');
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find(entry => entry.sizes === size && !entry.purpose);
    assert.ok(icon, `missing install icon at ${size}`);
    assert.ok(existsSync(new URL(`public${icon.src}`, root)), `missing icon ${icon.src}`);
  }
});

test('app documents allow wake lock without broadening embedded permissions', () => {
  const policies = config.headers.flatMap(rule => rule.headers
    .filter(header => header.key === 'Permissions-Policy')
    .map(header => ({ source: rule.source, policy: header.value })));
  const appPolicy = policies.find(entry => entry.policy.includes('tools=(self)'));
  assert.ok(appPolicy?.policy.includes('screen-wake-lock=(self)'));
  for (const source of ['/embed', '/embed.html']) {
    assert.ok(policies.find(entry => entry.source === source)?.policy.includes('screen-wake-lock=()'));
  }
});
