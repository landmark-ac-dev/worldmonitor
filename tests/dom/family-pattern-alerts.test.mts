import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsItem } from '@/types';
import type { BreakingAlert } from '@/services/breaking-news-alerts';

const { token, sound } = vi.hoisted(() => ({ token: vi.fn().mockResolvedValue('test-token'), sound: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/clerk', () => ({ getClerkToken: token }));
vi.mock('@/services/runtime', () => ({ isDesktopRuntime: () => false, getRemoteApiBaseUrl: () => '' }));
vi.mock('@/config/feeds', () => ({ getSourceTier: () => 1, getSourcePanelId: () => 'politics' }));
vi.mock('@/services/i18n', () => ({ t: (key: string) => key }));
vi.mock('@/utils', () => ({ isMobileDevice: () => false }));
vi.mock('@/components/news/source-provenance', () => ({
  renderPrimarySourceProvenance: () => ({ riskBadge: '', tierBadge: '', facts: '' }),
}));

import {
  checkFamilyPatternForBreakingAlerts, destroyBreakingNewsAlerts,
  initBreakingNewsAlerts, updateAlertSettings,
} from '@/services/breaking-news-alerts';
import { BreakingNewsBanner } from '@/components/BreakingNewsBanner';

const NOW = Date.parse('2026-11-13T18:00:00Z');
function item(title: string, link: string, date = NOW - 60_000): NewsItem {
  const fixtureSources: Record<string, string> = {
    'www.faa.gov': 'FAA',
    'status.stripe.com': 'Stripe Status',
    'apnews.com': 'AP News',
    'www.reuters.com': 'Reuters World',
  };
  return { source: fixtureSources[new URL(link).hostname] ?? 'Unreviewed fixture', title, link, pubDate: new Date(date), isAlert: false };
}
function reports(): NewsItem[] {
  return [
    item('Flights grounded at Denver airport', 'https://www.faa.gov/news/denver'),
    item('Payment service outage affects card payments', 'https://status.stripe.com/incidents/example'),
  ];
}

describe('family pattern notifications', () => {
  let seen: BreakingAlert[];
  let listener: (event: Event) => void;
  let banner: BreakingNewsBanner | undefined;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    token.mockClear();
    sound.mockClear();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Audio', class { volume = 0; currentTime = 0; play = sound; });
    document.body.replaceChildren();
    seen = [];
    listener = (event) => seen.push((event as CustomEvent<BreakingAlert>).detail);
    document.addEventListener('wm:breaking-news', listener);
    initBreakingNewsAlerts();
    vi.advanceTimersByTime(11_000);
  });

  afterEach(() => {
    banner?.destroy();
    banner = undefined;
    destroyBreakingNewsAlerts();
    document.removeEventListener('wm:breaking-news', listener);
    document.body.replaceChildren();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not alert for one headline, one domain, or unconfirmed disruption', () => {
    const [aviation] = reports();
    checkFamilyPatternForBreakingAlerts([aviation!]);
    checkFamilyPatternForBreakingAlerts([
      aviation!, item('Flights grounded at Chicago airport', 'https://www.faa.gov/news/chicago'),
    ]);
    checkFamilyPatternForBreakingAlerts([
      aviation!, item('Payment service outage affects card payments', 'https://viral.example/post'),
    ]);
    checkFamilyPatternForBreakingAlerts([
      item('Power outage grounds flights at Denver airport', 'https://www.faa.gov/news/multiple-domains'),
    ]);
    expect(seen).toHaveLength(0);
  });

  it('dispatches one source-linked aggregate event without sound or external notification', async () => {
    banner = new BreakingNewsBanner();
    checkFamilyPatternForBreakingAlerts(reports());
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.origin).toBe('family_pattern');
    expect(seen[0]!.familyPattern?.domains).toEqual(['aviation', 'finance']);
    expect(seen[0]!.headline).toContain('within six hours');
    expect(seen[0]!.headline).not.toMatch(/critical|high risk|attack/i);
    expect(token).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sound).not.toHaveBeenCalled();
    expect(document.querySelector('.breaking-alert-level')?.textContent).toBe('Pattern alert');
    expect(document.querySelector('.breaking-alert')?.getAttribute('data-target-panel')).toBe('family-facts');
    expect(document.querySelector('.breaking-news-container')?.getAttribute('aria-live')).toBe('polite');
    expect(document.querySelectorAll('.propaganda-badge, .tier-badge, .corroboration-flag, .severity-high')).toHaveLength(0);
    expect([...document.querySelectorAll<HTMLAnchorElement>('.family-pattern-source-link')].map((link) => link.href)).toEqual([
      'https://www.faa.gov/news/denver', 'https://status.stripe.com/incidents/example',
    ]);
    expect(document.querySelector('.family-pattern-alert')?.textContent).toContain('do not establish a shared cause');
  });

  it('keeps both corroborating links and represents each domain even when many reports share the first domain', () => {
    banner = new BreakingNewsBanner();
    const aviation = Array.from({ length: 8 }, (_, index) => item(`Flights grounded at airport ${index}`, `https://www.faa.gov/news/${index}`));
    const title = 'Internet outage disrupts broadband service';
    checkFamilyPatternForBreakingAlerts([
      ...aviation,
      item(title, 'https://apnews.com/article/outage'),
      item(title, 'https://www.reuters.com/world/outage'),
    ]);
    expect(seen).toHaveLength(1);
    const evidence = document.querySelector('.family-pattern-evidence');
    expect(evidence?.querySelectorAll('li')).toHaveLength(2);
    expect(evidence?.textContent).toContain('Credible');
    const links = [...evidence!.querySelectorAll<HTMLAnchorElement>('a')].map((link) => link.href);
    expect(links).toContain('https://apnews.com/article/outage');
    expect(links).toContain('https://www.reuters.com/world/outage');
  });

  it('does not repeat the same domain combination during a session, including after cooldown', () => {
    checkFamilyPatternForBreakingAlerts(reports());
    checkFamilyPatternForBreakingAlerts([...reports()].reverse());
    vi.advanceTimersByTime(31 * 60_000);
    checkFamilyPatternForBreakingAlerts(reports());
    expect(seen).toHaveLength(1);
  });

  it('respects disabled alerts and the critical-only setting', () => {
    updateAlertSettings({ enabled: false });
    checkFamilyPatternForBreakingAlerts(reports());
    updateAlertSettings({ enabled: true, sensitivity: 'critical-only' });
    checkFamilyPatternForBreakingAlerts(reports());
    expect(seen).toHaveLength(0);
    updateAlertSettings({ sensitivity: 'critical-and-high' });
    checkFamilyPatternForBreakingAlerts(reports());
    expect(seen).toHaveLength(1);
  });

  it('excludes reports outside the six-hour window and future or missing timestamps', () => {
    for (const date of [NOW - 7 * 3_600_000, NOW + 60_000]) {
      checkFamilyPatternForBreakingAlerts([
        reports()[0]!, item('Payment service outage affects card payments', 'https://status.stripe.com/incidents/example', date),
      ]);
    }
    const missing = reports();
    missing[1]!.pubDateMissing = true;
    checkFamilyPatternForBreakingAlerts(missing);
    expect(seen).toHaveLength(0);
  });

  it('opens evidence links independently and reveals the brief from its button', () => {
    banner = new BreakingNewsBanner();
    checkFamilyPatternForBreakingAlerts(reports());
    const reveal = vi.fn();
    window.addEventListener('wm:reveal-panel', reveal);
    try {
      const link = document.querySelector<HTMLAnchorElement>('.family-pattern-source-link')!;
      link.addEventListener('click', (event) => event.preventDefault());
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(reveal).not.toHaveBeenCalled();
      document.querySelector<HTMLButtonElement>('.breaking-alert-view-panel')!.click();
      expect(reveal).toHaveBeenCalledWith(expect.objectContaining({ detail: { panelId: 'family-facts' } }));
    } finally {
      window.removeEventListener('wm:reveal-panel', reveal);
    }
  });
});
