import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the real share and metadata implementations; avoid loading the runtime's
// auth/billing graph. An upstream result makes accidental fallback observable.
vi.mock('@/services/runtime', () => ({
  getCanonicalApiOrigin: () => 'https://api.worldmonitor.app',
}));

const PERSONAL_ORIGIN = 'https://monitor.everfen.com';

function setLocation(url: string): void {
  vi.stubGlobal('location', new URL(url));
}

function metaContent(name: string): string | null {
  return document.querySelector<HTMLMetaElement>(
    `meta[property="${name}"], meta[name="${name}"]`,
  )?.content ?? null;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_PERSONAL_MODE', 'true');
  setLocation(`${PERSONAL_ORIGIN}/dashboard`);
  document.head.replaceChildren();
});

afterEach(() => {
  document.head.replaceChildren();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('personal deployment sharing and metadata', () => {
  it.each([PERSONAL_ORIGIN, 'http://192.168.1.20:3001'])(
    'round-trips the country on the local dashboard at %s',
    async (origin) => {
      setLocation(`${origin}/tv`);
      const sharing = await import('@/services/story-share');
      const metadata = await import('@/services/meta-tags');
      const url = new URL(sharing.generateStoryDeepLink('US'));

      expect(url.origin).toBe(origin);
      expect(url.pathname).toBe('/dashboard');
      expect(url.searchParams.get('c')).toBe('US');
      expect(url.searchParams.has('country')).toBe(false);
      expect(sharing.parseStoryParams(url)).toEqual({ countryCode: 'US', type: 'ciianalysis' });
      expect(metadata.parseStoryParams(url)).toEqual({
        countryCode: 'US', countryName: 'United States', type: 'ciianalysis',
      });

      // Exercise the receiving page's initialization, not only the two parsers.
      setLocation(url.toString());
      metadata.initMetaTags();
      expect(metaContent('og:title')).toBe('United States Intelligence Brief | Everfen Monitor');
      expect(metaContent('og:url')).toBe(url.toString());
    },
  );

  it('keeps updated and reset metadata branded locally without upstream share images', async () => {
    const { updateMetaTagsForStory, resetMetaTags } = await import('@/services/meta-tags');
    resetMetaTags();
    expect(document.title).toBe('Everfen Monitor · Family dashboard');

    updateMetaTagsForStory({
      countryCode: 'US', countryName: 'United States', type: 'ciianalysis',
      ciiScore: 42, ciiLevel: 'elevated', trend: 'rising',
    });

    expect(document.title).toContain('Everfen Monitor');
    for (const field of ['title', 'og:title', 'twitter:title']) {
      expect(metaContent(field)).toBe('United States Intelligence Brief | Everfen Monitor');
    }
    expect(metaContent('description')).toContain('Everfen Monitor');
    expect(metaContent('description')).toContain('42/100');
    for (const field of ['og:url', 'twitter:url']) {
      expect(metaContent(field)).toBe(`${PERSONAL_ORIGIN}/dashboard?c=US&t=ciianalysis`);
    }
    for (const field of ['og:image', 'twitter:image']) {
      expect(metaContent(field)).toBe(`${PERSONAL_ORIGIN}/personal/icon-512.png`);
    }

    resetMetaTags();

    expect(document.title).toBe('Everfen Monitor · Family dashboard');
    expect(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href)
      .toBe(`${PERSONAL_ORIGIN}/dashboard`);
    for (const field of ['title', 'og:title', 'twitter:title']) {
      expect(metaContent(field)).toBe('Everfen Monitor · Family dashboard');
    }
    for (const field of ['og:url', 'twitter:url']) {
      expect(metaContent(field)).toBe(`${PERSONAL_ORIGIN}/dashboard`);
    }
    for (const field of ['og:image', 'twitter:image']) {
      expect(metaContent(field)).toBe(`${PERSONAL_ORIGIN}/personal/icon-512.png`);
    }
    expect(metaContent('description')).not.toContain('42/100');
    expect(document.head.innerHTML).not.toContain('worldmonitor.app');
  });
});
