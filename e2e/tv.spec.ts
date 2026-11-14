import { expect, test, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { acceptTesterKeySession } from './helpers/accept-tester-key-session';
import { BROWSER_NEWS_CATALOG } from '../src/config/news-catalog.browser.generated';

// Fictional reports exercise the full application data path. They are not live
// incident evidence. No provider requests leave this controlled browser fixture.
const INITIAL_TIME = new Date('2026-11-13T18:00:00Z'); // Noon in Chicago, not UTC.
const QUIET_STORAGE_KEY = 'wm-tv-quiet-hours-v1';
const SCENES = ['facts', 'patterns', 'aviation', 'cyber', 'finance', 'weather'];
const NEWS_CATEGORIES = [...new Set(Object.values(BROWSER_NEWS_CATALOG.editions)
  .flatMap(edition => Object.keys(edition))), 'intel'];
const LONG_SUFFIX = 'across the eastern district and surrounding communities as local officials coordinate their response and residents await further information from the responsible authorities';
const LONG_DISRUPTIONS = ['Power outage', 'Flights grounded', 'Banking outage', 'Internet outage', 'Ransomware disrupts regional services']
  .map(title => `${title} ${LONG_SUFFIX}`);

async function setup(page: Page, path = '/tv?quiet=off', options: { dense?: boolean; incomplete?: boolean } = {}) {
  let feedRequests = 0;
  let refreshed = false;
  await page.clock.install({ time: INITIAL_TIME });
  await seedAnonymousDashboard(page, 'full', { localStorage: {
    'wm-pro-key': 'e2e-tv',
    'worldmonitor-sources-reduction-v3': 'done',
    'worldmonitor-disabled-feeds': '["fixture-disabled-source"]',
    'worldmonitor-panels': JSON.stringify({
      'family-facts': { name: "What's actually true", enabled: true, priority: 0 },
      politics: { name: 'World News', enabled: true, priority: 1 },
      gov: { name: 'Government', enabled: true, priority: 2 },
    }),
    'wm-breaking-alerts-v1': JSON.stringify({ enabled: true, soundEnabled: false, desktopNotificationsEnabled: false }),
  } });
  await page.route(/^https?:\/\/(?!(127\.0\.0\.1:4173|localhost:4173)(?:\/|$)).*/i, route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await acceptTesterKeySession(page);
  await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: options.dense ? {
    weatherAlerts: { alerts: Array.from({ length: 5 }, (_, index) => ({
      id: `tv-weather-${index}`, event: 'Wind bulletin', severity: 'Moderate',
      headline: `Wind bulletin ${index + 1} for communities ${LONG_SUFFIX}`,
      description: 'Fictional browser fixture only', areaDesc: `The northern district ${LONG_SUFFIX}`,
      onset: INITIAL_TIME.toISOString(), expires: '2026-11-14T18:00:00Z',
      coordinates: [], source: 'Fixture weather authority', issuedBy: 'Fixture regional office',
    })) },
  } : {} } }));
  await page.route('**/api/news/v1/list-feed-digest*', route => {
    feedRequests += 1;
    const publishedAt = INITIAL_TIME.getTime() - 60_000;
    return route.fulfill({ json: {
      categories: {
        // A missing enabled category is a real coverage failure. Model empty
        // successful results for every catalog category, including intel.
        ...Object.fromEntries(NEWS_CATEGORIES.filter(category => !options.incomplete || category !== 'intel')
          .map(category => [category, { items: [] }])),
        politics: { items: [
          { source: 'Reuters World', title: 'Power outage leaves regional grid offline', link: 'https://www.reuters.com/world/test-power', publishedAt, isAlert: true },
          { source: 'BBC World', title: 'Power outage leaves regional grid offline', link: 'https://www.bbc.com/news/test-power', publishedAt, isAlert: true },
          { source: 'BBC World', title: 'Viral claim urges citizens to stockpile supplies', link: 'https://example.com/unverified', publishedAt, isAlert: true },
        ].filter(() => !options.dense) },
        gov: { items: options.dense ? LONG_DISRUPTIONS.map((title, index) => ({
          source: 'CISA', title, link: `https://www.cisa.gov/news-events/alerts/dense-${index}`,
          publishedAt, isAlert: true,
        })) : [
          { source: 'CISA', title: 'Ransomware disrupts regional services', link: 'https://www.cisa.gov/news-events/alerts/test-disruption', publishedAt, isAlert: true },
          {
            source: 'CISA',
            title: refreshed ? 'CISA publishes updated source-checking guidance after reconnect' : 'CISA publishes guidance for checking official sources',
            link: 'https://www.cisa.gov/news-events/alerts/test-guidance', publishedAt: publishedAt + (refreshed ? 30_000 : 0), isAlert: false,
          },
        ] },
      }, feedStatuses: {}, generatedAt: INITIAL_TIME.toISOString(),
    } });
  });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-situation-room', 'true');
  // Slow full-app startup may have crossed a rotation boundary already.
  // Select and pause a known scene before assessing the loaded fixture.
  await page.locator('.tv-scene[data-scene="facts"]').click();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('toolbar', { name: 'TV display controls' })).toBeVisible();
  await page.keyboard.press('Escape'); // Return focus to the reading surface.
  await expect(page.locator('.tv-reader')).toBeFocused();
  await expect(page.locator('.tv-footer')).toHaveAttribute('data-paused', 'true');
  await expect(page.locator('.tv-reader .tv-story')).toHaveCount(3);
  await expect(page.locator('.tv-overall-status')).toHaveText(options.incomplete ? 'Watching' : 'Active');
  return { feedRequests: () => feedRequests, useRefreshedReports: () => { refreshed = true; } };
}

async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1_000));
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
  test(`TV display fits ${viewport.width}x${viewport.height} with linked facts and all scenes`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await expect(page.locator('.tv-footer')).toHaveAttribute('data-paused', 'true');
    await expect(page.locator('#mapSection')).toBeVisible();
    await expect(page.locator('#panelsGrid')).toBeHidden();
    await expect(page.locator('#panelsGrid')).toHaveJSProperty('inert', true);
    await expect(page.locator('.tv-reader')).not.toContainText('stockpile');
    await expect(page.locator('.tv-reader a[href="https://www.reuters.com/world/test-power"]')).toBeVisible();
    await expect(page.locator('.tv-reader a[href="https://www.bbc.com/news/test-power"]')).toBeVisible();
    await expect(page.locator('.tv-reader .confidence-confirmed')).toHaveCount(2);
    await expect(page.locator('.tv-reader .confidence-credible')).toHaveCount(1);
    await expect(page.locator('.tv-map-status')).toContainText('shared cause has not been established');

    for (const scene of SCENES) {
      await page.locator(`.tv-scene[data-scene="${scene}"]`).click();
      await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', scene);
      await expect(page.locator(`.tv-scene[data-scene="${scene}"]`)).toHaveAttribute('aria-current', 'true');
      // Text clipped by the reading surface is a failure even if the viewport
      // itself has no scrollbar. Allow two physical pixels for rounding.
      const overflow = await page.locator('.tv-reader').evaluate(el => ({
        horizontal: el.scrollWidth - el.clientWidth,
        vertical: el.scrollHeight - el.clientHeight,
      }));
      expect(overflow.horizontal, `${scene} horizontal overflow`).toBeLessThanOrEqual(2);
      expect(overflow.vertical, `${scene} vertical overflow`).toBeLessThanOrEqual(2);
      if (scene === 'facts' || scene === 'patterns') {
        const screenshotPath = testInfo.outputPath(`tv-${scene}-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: screenshotPath, animations: 'disabled' });
        await testInfo.attach(`TV ${scene} ${viewport.width}x${viewport.height}`, { path: screenshotPath, contentType: 'image/png' });
      }
    }
  });
}

test('TV query entry rotates every 20 seconds and supports D-pad controls', async ({ page }) => {
  await setup(page, '/?tv=1&quiet=off');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/tv.webmanifest');
  await pauseClock(page);
  await page.keyboard.press('ArrowDown'); // Restart the rotation deadline.
  await page.clock.fastForward(19_000);
  await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', 'facts');
  await page.clock.fastForward(1_000);
  await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', 'patterns');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', 'aviation');
  await expect(page.locator('.tv-footer')).toHaveAttribute('data-paused', 'true');
  await page.clock.fastForward(40_000);
  await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', 'aviation');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', 'patterns');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tv-footer')).toHaveAttribute('data-paused', 'false');
  await page.clock.fastForward(20_000);
  await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', 'aviation');

  await page.keyboard.press('ArrowUp');
  const toolbar = page.getByRole('toolbar', { name: 'TV display controls' });
  await expect(toolbar).toBeVisible();
  await expect(page.locator('.tv-footer')).toHaveAttribute('data-paused', 'true');
  await expect(toolbar.getByRole('button', { name: 'Resume rotation' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(toolbar.getByRole('button', { name: 'Dim now' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-tv-dimmed', 'true');
  await page.keyboard.press('Escape');
  await expect(toolbar).toBeHidden();
  await page.keyboard.press('d');
  await expect(page.locator('html')).toHaveAttribute('data-tv-dimmed', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tv-footer')).toHaveAttribute('data-paused', 'false');
});

test('TV uses its own manifest and persists quiet hours in Central time', async ({ page }) => {
  await setup(page, '/tv?quiet=22:00-07:00');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/tv.webmanifest');
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    return (await fetch(link.href)).json();
  });
  expect(manifest).toMatchObject({ id: '/tv', start_url: '/tv', display: 'fullscreen' });
  await expect(page.locator('html')).toHaveAttribute('data-tv-dimmed', 'false');
  expect(await page.evaluate(key => localStorage.getItem(key), QUIET_STORAGE_KEY)).toBe('22:00-07:00');
  await pauseClock(page);
  await page.clock.setSystemTime(new Date('2026-11-14T04:30:00Z')); // 22:30 CST, next UTC day.
  await page.clock.fastForward(1_000);
  await expect(page.locator('.tv-clock')).toHaveText('10:30 PM');
  await expect(page.locator('html')).toHaveAttribute('data-tv-dimmed', 'true');
  // Normal navigation must retain the preference without a quiet query.
  await page.clock.resume();
  await page.goto('/tv');
  await expect(page.locator('html')).toHaveAttribute('data-situation-room', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-tv-dimmed', 'true');
  await pauseClock(page);
  await page.clock.setSystemTime(new Date('2026-11-14T13:00:00Z')); // 07:00 CST is outside quiet hours.
  await page.clock.fastForward(1_000);
  await expect(page.locator('html')).toHaveAttribute('data-tv-dimmed', 'false');
  await page.clock.resume();
  await page.goto('/tv?quiet=off');
  await expect(page.locator('html')).toHaveAttribute('data-situation-room', 'true');
  expect(await page.evaluate(key => localStorage.getItem(key), QUIET_STORAGE_KEY)).toBe('');
});

test('TV marks offline coverage unknown and refreshes reports on reconnect', async ({ page, context }) => {
  const fixture = await setup(page);
  const before = fixture.feedRequests();
  await context.setOffline(true);
  await expect(page.locator('.tv-connectivity')).toContainText('Offline');
  await expect(page.locator('.tv-overall-status')).toHaveText('Watching');
  await expect(page.locator('.tv-map-status')).toContainText('Current conditions are unknown');
  await expect(page.locator('.tv-reader')).toContainText('Power outage leaves regional grid offline');
  fixture.useRefreshedReports();
  await context.setOffline(false);
  await expect.poll(fixture.feedRequests).toBeGreaterThan(before);
  await expect(page.locator('.tv-connectivity')).not.toContainText('Offline');
  await expect(page.locator('.tv-reader')).toContainText('CISA publishes updated source-checking guidance after reconnect');
  await expect(page.locator('.tv-overall-status')).toHaveText('Active');
});

test('TV keeps five-domain evidence and long operational records readable at 1080p and 4K', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await setup(page, '/tv?quiet=off', { dense: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(viewport);
    for (const scene of ['facts', 'patterns', 'weather']) {
      await page.locator(`.tv-scene[data-scene="${scene}"]`).click();
      await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', scene);
      await expect(page.locator('.tv-reader .tv-story')).toHaveCount(scene === 'weather' ? 2 : 3);
      if (scene !== 'facts') {
        await expect(page.locator('.tv-scene-footnote')).toContainText(`Showing ${scene === 'weather' ? 2 : 3} of 5 records`);
      }
      const layout = await page.locator('.tv-reader').evaluate(reader => {
        const footnote = reader.querySelector('.tv-scene-footnote')!;
        return {
          overflowX: reader.scrollWidth - reader.clientWidth,
          overflowY: reader.scrollHeight - reader.clientHeight,
          footnoteBottom: footnote.getBoundingClientRect().bottom,
          readerBottom: reader.getBoundingClientRect().bottom,
          text: [...reader.querySelectorAll<HTMLElement>('.tv-story h2, .tv-story-detail')].map(node => {
            const style = getComputedStyle(node);
            return { height: node.clientHeight, lineHeight: Number.parseFloat(style.lineHeight), clamp: style.webkitLineClamp };
          }),
        };
      });
      expect(layout.overflowX, `${scene} at ${viewport.width}px`).toBeLessThanOrEqual(2);
      expect(layout.overflowY, `${scene} at ${viewport.width}px`).toBeLessThanOrEqual(2);
      expect(layout.footnoteBottom).toBeLessThanOrEqual(layout.readerBottom);
      for (const text of layout.text) {
        expect(text.clamp).toBe('2');
        expect(text.height).toBeLessThanOrEqual(2 * text.lineHeight + 2);
      }
      const path = testInfo.outputPath(`tv-long-${scene}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      await testInfo.attach(`TV long ${scene} ${viewport.width}`, { path, contentType: 'image/png' });
    }
  }
});

test('missing intel coverage cannot present a current Active status', async ({ page }) => {
  await setup(page, '/tv?quiet=off', { incomplete: true });
  await expect(page.locator('.tv-reader')).toContainText('Power outage leaves regional grid offline');
  await expect(page.locator('.tv-map-status')).toContainText('News coverage is not current');
  await expect(page.locator('.tv-overall-status')).toHaveText('Watching');
});

test('Enter activates a focused evidence link without toggling rotation', async ({ page, context }) => {
  await setup(page);
  const sourceUrl = 'https://www.reuters.com/world/test-power';
  // Popups do not inherit page routes. Fulfil the source in the context so this
  // keyboard test never contacts a publisher or navigates the display away.
  await context.route(/^https:\/\/www\.reuters\.com\/world\/test-power(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: '<p>Controlled evidence page</p>' }));
  const source = page.locator(`.tv-reader a[href="${sourceUrl}"]`);
  await source.focus();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await expect(popup).toHaveURL(url => url.origin + url.pathname === sourceUrl);
  await expect(popup.locator('body')).toContainText('Controlled evidence page');
  await expect(page.locator('.tv-footer')).toHaveAttribute('data-paused', 'true');
  await popup.close();
  await expect(page.locator('.tv-reader')).toHaveAttribute('data-scene', 'facts');
});
