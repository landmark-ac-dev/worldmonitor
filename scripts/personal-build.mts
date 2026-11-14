import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const PERSONAL_NAME = 'Everfen Monitor';
export const PERSONAL_DESCRIPTION = 'A calm family view of the world, with source-linked facts, clear uncertainty, and useful local context.';
export const personalManifest = {
  id: '/everfen-monitor',
  name: PERSONAL_NAME,
  short_name: 'Everfen',
  description: PERSONAL_DESCRIPTION,
  start_url: '/dashboard',
  scope: '/',
  display: 'standalone' as const,
  orientation: 'any' as const,
  theme_color: '#102b2a',
  background_color: '#102b2a',
  categories: ['news', 'utilities'],
  screenshots: [],
  shortcuts: [{ name: 'Situation room', description: 'Open the family TV display', url: '/tv', icons: [{ src: '/personal/icon-192.png', sizes: '192x192', type: 'image/png' }] }],
  icons: [
    { src: '/personal/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' as const },
    { src: '/personal/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' as const },
  ],
};

/** Keep executable scripts and preload tags intact. Only the marked prepaint
 * script's variant selection and subscription-space reservation are personal. */
export function renderPersonalHtml(html: string): string {
  let result = html
    .replace(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b(?=[^>]*\brel=["'](?:canonical|alternate|icon|shortcut icon|apple-touch-icon|mask-icon)["'])[^>]*>/gi, '')
    .replace(/<meta\b(?=[^>]*\b(?:name|property)=["'](?:title|description|application-name|apple-mobile-web-app-title|keywords|author|subject|classification|robots|og:[^"']+|twitter:[^"']+)["'])[^>]*>/gi, '')
    .replace(/<title>[^<]*<\/title>/i, `<title>${PERSONAL_NAME}</title>`)
    .replace(/<meta\b(?=[^>]*\bname=["']theme-color["'])[^>]*>/gi, '<meta name="theme-color" content="#102b2a" />')
    .replace(/(\.skeleton-brand-mark::after\s*\{\s*content\s*:\s*)["']W["']/, '$1"E"')
    .replace(/<section\b(?=[^>]*\bclass=["']app-seo-summary["'])[^>]*>[\s\S]*?<\/section>/gi, '')
    .replace(/<h1\b(?=[^>]*\bclass=["']app-heading["'])[^>]*>[\s\S]*?<\/h1>/gi, `<h1 class="app-heading">${PERSONAL_NAME}</h1>`)
    .replace(/<main\b(?=[^>]*\bid=["']dashboard-noscript["'])[^>]*>[\s\S]*?<\/main>/gi,
      `<main id="dashboard-noscript" class="dashboard-noscript"><h2>${PERSONAL_NAME} needs JavaScript</h2><p>Enable JavaScript to load the map and source-linked reports. Current conditions cannot be checked while the app is offline.</p><p><a href="/credits.html">Credits, license, and source code</a></p></main>`)
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, block => /worldmonitor\.app/i.test(block)
      ? `<noscript>${PERSONAL_NAME} needs JavaScript. <a href="/credits.html">Credits, license, and source code</a></noscript>` : block)
    .replace(/<script\b(?=[^>]*\bdata-wm-prepaint)[^>]*>[\s\S]*?<\/script>/gi, script => script
      .replace(/var h=location\.hostname;var v;[\s\S]*?localStorage\.getItem\('worldmonitor-variant'\);/, "var v=localStorage.getItem('worldmonitor-variant');")
      .replace(/if\(window\.self===window\.top&&!dismissed&&!entitledHint\)document\.documentElement\.classList\.add\('wm-pro-banner-reserved'\);/, ''));

  // Rewrite visible entry/skeleton labels without changing script identifiers,
  // storage keys, URLs, CSS selectors, or source/license notices in comments.
  result = result.split(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->)/gi)
    .map((part, index) => index % 2 ? part : part
      .replace(/World Monitor|WorldMonitor/g, PERSONAL_NAME))
    .join('');
  return result.replace('</head>', `
    <meta name="title" content="${PERSONAL_NAME}" />
    <meta name="description" content="${PERSONAL_DESCRIPTION}" />
    <meta name="application-name" content="${PERSONAL_NAME}" />
    <meta name="apple-mobile-web-app-title" content="Everfen" />
    <meta name="robots" content="noindex, nofollow" />
    <meta property="og:title" content="${PERSONAL_NAME}" />
    <meta property="og:description" content="${PERSONAL_DESCRIPTION}" />
    <meta property="og:site_name" content="${PERSONAL_NAME}" />
    <link rel="icon" type="image/svg+xml" href="/personal/icon.svg" />
    <link rel="apple-touch-icon" sizes="180x180" href="/personal/icon-180.png" />
  </head>`);
}

/** Runs after variant metadata; generated upstream SEO siblings are disabled by
 * the caller, so no later variant pass can put the hosted-service identity back. */
export function personalBuildPlugin(root: string): Plugin {
  const replacements = new Map([
    ['tv.webmanifest', 'public/personal/tv.webmanifest'],
    ['offline.html', 'public/personal/offline.html'],
    ['500.html', 'public/personal/500.html'],
    ['LICENSE', 'LICENSE'],
  ]);
  // These pages belong to the upstream hosted service. Replace the entire
  // document, including authentication scripts, rather than relabeling an
  // upstream account as if it belonged to this personal installation.
  for (const fileName of [
    'pro/index.html', 'pro/welcome.html',
    'mcp-grant.html', 'mcp-grant/index.html',
    'desktop-sign-in.html', 'desktop-sign-in/index.html',
    'mcp-setup.html', 'mcp-setup/index.html', 'mcp/index.html', 'agent/index.html',
  ]) replacements.set(fileName, 'public/personal/local-features.html');
  const routeAliases = new Map([
    ['pro', 'pro/index.html'], ['pro/', 'pro/index.html'],
    ['pro/welcome', 'pro/welcome.html'],
    ['mcp-grant', 'mcp-grant.html'], ['mcp-grant/', 'mcp-grant.html'],
    ['desktop-sign-in', 'desktop-sign-in.html'], ['desktop-sign-in/', 'desktop-sign-in.html'],
    ['mcp-setup', 'mcp-setup.html'], ['mcp-setup/', 'mcp-setup.html'],
    ['mcp', 'mcp/index.html'], ['mcp/', 'mcp/index.html'],
    ['agent', 'agent/index.html'], ['agent/', 'agent/index.html'],
  ]);
  return {
    name: 'everfen-personal-build',
    enforce: 'post',
    transformIndexHtml: { order: 'post', handler: renderPersonalHtml },
    async generateBundle(_options, bundle) {
      for (const [fileName, sourcePath] of replacements) {
        const source = await readFile(resolve(root, sourcePath), 'utf8');
        const existing = bundle[fileName];
        if (existing?.type === 'asset') existing.source = source;
        else this.emitFile({ type: 'asset', fileName, source });
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.slice(1);
        const fileName = routeAliases.get(pathname) ?? pathname;
        const sourcePath = replacements.get(fileName);
        if (!sourcePath) return next();
        try {
          const body = await readFile(resolve(root, sourcePath), 'utf8');
          res.setHeader('Content-Type', fileName.endsWith('.webmanifest') ? 'application/manifest+json' : fileName.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
          res.end(body);
        } catch (error) { next(error); }
      });
    },
  };
}
