import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { personalBuildPlugin, personalManifest, renderPersonalHtml } from '../scripts/personal-build.mts';
import { APP_NAME, PERSONAL_DEPLOYMENT, PERSONAL_SOURCE_URL } from '../src/config/personal-deployment.ts';

const root = new URL('../', import.meta.url);
const original = await readFile(new URL('index.html', root), 'utf8');
const personal = renderPersonalHtml(original);

test('personal build removes hosted-service promotion and brands the actual dashboard skeleton', () => {
  assert.match(personal, /<title>Everfen Monitor<\/title>/);
  assert.match(personal, /aria-label="Everfen Monitor dashboard loading"/);
  assert.match(personal, /<span>Everfen Monitor<\/span>/);
  assert.match(personal, /skeleton-brand-mark::after\{content:"E"\}/);
  assert.match(personal, /name="robots" content="noindex, nofollow"/);
  assert.match(personal, /href="\/personal\/icon.svg"/);
  assert.match(personal, /href="\/credits.html"/);
  assert.doesNotMatch(personal, /<script[^>]*application\/ld\+json/);
  assert.doesNotMatch(personal, /<link[^>]*rel="(?:canonical|alternate)"/);
  assert.doesNotMatch(personal, /<section class="app-seo-summary"/);
  assert.doesNotMatch(personal, /Pro unlocks|World Monitor homepage|href="\/pro#pricing"/);
  assert.doesNotMatch(personal, /<meta[^>]*(?:worldmonitor\.app|@worldmonitorai)/);
  assert.doesNotMatch(personal, /<link[^>]*href="\/favico\//);
});

test('personal embedded fallback does not advertise the upstream hosted service', async () => {
  const embed = renderPersonalHtml(await readFile(new URL('embed.html', root), 'utf8'));
  assert.doesNotMatch(embed, /<noscript>[\s\S]*?worldmonitor\.app[\s\S]*?<\/noscript>/);
  assert.match(embed, /<noscript>Everfen Monitor needs JavaScript/);
});

test('branding preserves executable scripts and preloads apart from the bounded personal prepaint changes', () => {
  const scripts = (html: string) => [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)]
    .map(match => match[0]).filter(tag => !tag.includes('application/ld+json') && !tag.includes('data-wm-prepaint'));
  assert.deepEqual(scripts(personal), scripts(original));
  const links = (html: string) => [...html.matchAll(/<link\b[^>]*rel=["'](?:preload|modulepreload|preconnect)["'][^>]*>/gi)].map(match => match[0]);
  assert.deepEqual(links(personal), links(original));
  const stylesheetFallback = '<noscript><link rel="stylesheet" href="/assets/app.css"></noscript>';
  assert.ok(renderPersonalHtml(original.replace('</head>', `${stylesheetFallback}</head>`)).includes(stylesheetFallback));
});

test('personal prepaint reads selected variants on a private hostname and reserves no subscription banner', () => {
  const code = personal.match(/<script\b[^>]*data-wm-prepaint[^>]*>([\s\S]*?)<\/script>/)![1]!;
  const classes = new Set<string>();
  const dataset: Record<string, string> = {};
  const window = { self: null as unknown, top: null as unknown, matchMedia: () => ({ matches: false }) };
  window.self = window; window.top = window;
  runInNewContext(code, {
    window, location: { hostname: 'monitor.home.arpa' },
    localStorage: { getItem: (key: string) => key === 'worldmonitor-variant' ? 'energy' : null, removeItem() {} },
    document: { documentElement: { dataset, classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } } },
  });
  assert.equal(dataset.variant, 'energy');
  assert.ok(classes.has('js'));
  assert.ok(!classes.has('wm-pro-banner-reserved'));
});

test('personal PWA and TV installs use distinct identities with valid original PNG icons', async () => {
  const tv = JSON.parse(await readFile(new URL('public/personal/tv.webmanifest', root), 'utf8'));
  assert.equal(personalManifest.name, 'Everfen Monitor');
  assert.equal(tv.name, 'Everfen Monitor TV');
  assert.notEqual(personalManifest.id, tv.id);
  assert.equal(tv.start_url, '/tv');
  assert.deepEqual(personalManifest.screenshots, []);
  for (const manifest of [personalManifest, tv]) {
    for (const icon of manifest.icons) {
      assert.match(icon.src, /^\/personal\//);
      const bytes = await readFile(new URL(`public${icon.src}`, root));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
    }
  }
});

test('personal output emits its TV manifest, fallback pages, and the unchanged license after public copying', async () => {
  const plugin = personalBuildPlugin(fileURLToPath(root));
  const emitted = new Map<string, string>();
  const generate = plugin.generateBundle;
  assert.equal(typeof generate, 'function');
  await (generate as Function).call({ emitFile: ({ fileName, source }: { fileName: string; source: string }) => emitted.set(fileName, source) }, {}, {});
  assert.equal(JSON.parse(emitted.get('tv.webmanifest')!).name, 'Everfen Monitor TV');
  assert.equal(emitted.get('LICENSE'), await readFile(new URL('LICENSE', root), 'utf8'));
  assert.match(emitted.get('offline.html')!, /Everfen Monitor is offline/);
  assert.match(emitted.get('500.html')!, /Everfen Monitor is temporarily unavailable/);
});

test('personal hosted-service pages are replaced completely, including generated authentication entry scripts', async () => {
  const plugin = personalBuildPlugin(fileURLToPath(root));
  const bundle: Record<string, { type: string; source: string }> = {
    'mcp-grant.html': { type: 'asset', source: '<title>Hosted account</title><script src="/assets/mcp-grant.js"></script>' },
    'desktop-sign-in.html': { type: 'asset', source: '<script src="/assets/desktop-sign-in.js"></script><form>Sign in</form>' },
  };
  const emitted = new Map<string, string>();
  await (plugin.generateBundle as Function).call({
    emitFile: ({ fileName, source }: { fileName: string; source: string }) => emitted.set(fileName, source),
  }, {}, bundle);
  for (const fileName of [
    'pro/index.html', 'pro/welcome.html', 'mcp-grant.html', 'mcp-grant/index.html',
    'desktop-sign-in.html', 'desktop-sign-in/index.html', 'mcp-setup.html', 'mcp/index.html', 'agent/index.html',
  ]) {
    const page = bundle[fileName]?.source ?? emitted.get(fileName)!;
    assert.match(page, /<title>Everfen Monitor · Personal dashboard<\/title>/, fileName);
    assert.match(page, /href="\/dashboard"/, fileName);
    assert.match(page, /Hosted accounts, subscriptions, and hosted-service authorization pages are not used/, fileName);
    assert.doesNotMatch(page, /<script\b|<form\b|https?:\/\/|href="[^"']*(?:pricing|subscribe|signup|sign-in)/, fileName);
  }
  assert.ok(!emitted.has('mcp-grant.html'), 'mutate the generated entry instead of creating a competing asset');
});

test('personal dev server uses the same local notices for bare, directory and HTML hosted-service routes', async () => {
  const plugin = personalBuildPlugin(fileURLToPath(root));
  let middleware: Function | undefined;
  (plugin.configureServer as Function)({ middlewares: { use: (handler: Function) => { middleware = handler; } } });
  for (const url of ['/pro', '/pro/', '/pro/welcome.html', '/mcp-grant', '/mcp-grant.html', '/desktop-sign-in', '/mcp-setup.html', '/agent/']) {
    let body = '';
    let contentType = '';
    await middleware!({ url }, { setHeader: (_key: string, value: string) => { contentType = value; }, end: (value: string) => { body = value; } }, (error: unknown) => { assert.fail(`Unexpected fallback ${String(error)} for ${url}`); });
    assert.match(contentType, /text\/html/);
    assert.match(body, /<h1>Everfen Monitor<\/h1>/);
    assert.doesNotMatch(body, /<script\b|<form\b/);
  }
});

test('attribution uses actual upstream copyright and points to this fork source', async () => {
  const credits = await readFile(new URL('public/credits.html', root), 'utf8');
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const copyright = 'Copyright (C) 2026 Elie Habib. All rights reserved.';
  assert.ok(readme.includes(copyright));
  assert.ok(credits.includes(copyright));
  assert.ok(credits.includes(PERSONAL_SOURCE_URL));
  assert.match(credits, /AGPL-3.0-only/);
  assert.match(credits, /href="\/LICENSE"/);
});

test('ordinary config defaults upstream while Docker opts into personal branding and no variant SEO overwrites it', async () => {
  assert.equal(PERSONAL_DEPLOYMENT, false);
  assert.equal(APP_NAME, 'World Monitor');
  const vite = await readFile(new URL('vite.config.ts', root), 'utf8');
  const docker = await readFile(new URL('Dockerfile', root), 'utf8');
  assert.match(docker, /ARG VITE_PERSONAL_MODE=true\r?\nENV VITE_PERSONAL_MODE=\$VITE_PERSONAL_MODE/);
  assert.match(vite, /!isDesktopBuild && !isPersonalBuild && activeVariant === 'full' && variantDashboardHtmlPlugin\(\)/);
  assert.match(vite, /isPersonalBuild && personalBuildPlugin\(__dirname\)/);
  assert.ok(vite.indexOf('htmlVariantPlugin(activeMeta, activeVariant, isDesktopBuild)') < vite.indexOf('isPersonalBuild && personalBuildPlugin(__dirname)'));
  assert.match(vite, /\.\.\.\(isPersonalBuild \? personalManifest : \{\}\)/);
});
