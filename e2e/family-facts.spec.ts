import { expect, test, type Page } from '@playwright/test';
import { seedAnonymousDashboard } from './bootstrap-request-budget-fixtures';
import { acceptTesterKeySession } from './helpers/accept-tester-key-session';

/** Fictional, controlled reports: this verifies the UI path, not a real incident. */
async function setup(page: Page, withPattern: boolean): Promise<void> {
  await seedAnonymousDashboard(page, 'full', { localStorage: {
    // This fixture selects all evidence sources. Otherwise the free-tier source
    // cap can remove Reuters/CISA before the feature receives the test reports.
    'wm-pro-key': 'e2e-family-facts',
    'worldmonitor-sources-reduction-v3': 'done',
    'worldmonitor-disabled-feeds': '["fixture-disabled-source"]',
    'worldmonitor-panels': JSON.stringify({
      'family-facts': { name: "What's actually true", enabled: true, priority: 0 },
      politics: { name: 'World News', enabled: true, priority: 1 },
      gov: { name: 'Government', enabled: true, priority: 1 },
    }),
    'wm-breaking-alerts-v1': JSON.stringify({ enabled: true, soundEnabled: false, desktopNotificationsEnabled: false }),
  } });
  await page.route(/^https?:\/\/(?!(127\.0\.0\.1:4173|localhost:4173)(?:\/|$)).*/i, route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await acceptTesterKeySession(page);
  await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
  await page.route('**/api/news/v1/list-feed-digest*', route => {
    const publishedAt = Date.now() - 60_000;
    return route.fulfill({ json: {
      categories: {
        politics: { items: [
          { source: 'Reuters World', title: 'Power outage leaves regional grid offline', link: 'https://www.reuters.com/world/test-power', publishedAt, isAlert: true },
          ...(withPattern ? [{ source: 'BBC World', title: 'Power outage leaves regional grid offline', link: 'https://www.bbc.com/news/test-power', publishedAt, isAlert: true }] : []),
          { source: 'BBC World', title: 'Viral claim urges citizens to stockpile supplies', link: 'https://example.com/unverified', publishedAt, isAlert: true },
        ] },
        gov: { items: [
          { source: 'CISA', title: 'Ransomware disrupts regional services', link: 'https://www.cisa.gov/news-events/alerts/test-disruption', publishedAt, isAlert: true },
          { source: 'CISA', title: 'CISA publishes guidance for checking official sources', link: 'https://www.cisa.gov/news-events/alerts/test-guidance', publishedAt, isAlert: false },
        ] },
      }, feedStatuses: {}, generatedAt: new Date().toISOString(),
    } });
  });
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-wm-event-handlers-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-wm-initial-data-ready', 'true');
}

for (const width of [1280, 390]) {
  test(`family facts: linked evidence, confidence and local copy check at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, true);
    const panel = page.locator('#panelsGrid [data-panel="family-facts"]');
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.locator('.family-facts-lines > li')).toHaveCount(3);
    await expect(panel.locator('.family-facts-lines')).not.toContainText('stockpile');
    await expect(panel.locator('.family-facts-pattern')).toHaveAttribute('data-alert', 'true');
    await expect(panel.locator('.family-facts-lines a[href="https://www.reuters.com/world/test-power"]')).toBeVisible();
    await expect(panel.locator('.family-facts-lines a[href="https://www.bbc.com/news/test-power"]')).toBeVisible();
    await expect(panel.locator('.family-facts-lines .confidence-confirmed')).toHaveCount(2);
    await expect(panel.locator('.family-facts-lines .confidence-credible')).toHaveCount(1);
    await panel.screenshot({ path: testInfo.outputPath(`family-facts-${width}.png`) });
    await expect(panel.locator('.panel-content')).toHaveJSProperty('scrollWidth', await panel.locator('.panel-content').evaluate(el => el.clientWidth));

    await panel.getByText('Check copied social posts', { exact: true }).click();
    await panel.getByLabel('Post data (JSON array, up to 500 posts)').fill(JSON.stringify(Array.from({ length: 5 }, (_, index) => ({
      platform: 'example', accountId: `demo-${index}`, followers: 8,
      postedAt: Date.now() - (index + 1) * 60_000,
      text: 'Fictional example only: an unverified message says a demonstration service has stopped operating across the region.',
    }))));
    await panel.getByRole('button', { name: 'Check pasted posts' }).click();
    await expect(panel.locator('.copy-paste-check [role="status"]')).toContainText('1 repeated-text group flagged');
    await panel.locator('.copy-paste-check [role="status"]').scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath(`copy-paste-${width}.png`) });

    const news = page.locator('#panelsGrid [data-panel="politics"]');
    await news.scrollIntoViewIfNeeded();
    await expect(news.locator('.item.clustered')).not.toHaveCount(0);
    await expect(news.locator('.confidence-unconfirmed')).not.toHaveCount(0);
    await expect(news.locator('.confidence-credible')).not.toHaveCount(0);
    await expect(news.locator('.alert-tag')).toHaveCount(0);
    await news.screenshot({ path: testInfo.outputPath(`story-confidence-${width}.png`) });
  });
}

test('one confirmed disruption never creates a pattern alert', async ({ page }) => {
  await setup(page, false);
  const panel = page.locator('#panelsGrid [data-panel="family-facts"]');
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.locator('.family-facts-lines > li')).toHaveCount(2);
  await expect(panel.locator('.family-facts-pattern')).toHaveAttribute('data-alert', 'false');
  await expect(page.locator('.breaking-alert')).toHaveCount(0);
});
