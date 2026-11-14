import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTestI18n } from './helpers/i18n.mts';
import type { NewsItem, ClusteredEvent } from '@/types';
import type { ServerInsightStory, ServerInsights } from '@/services/insights-loader';
import { safeHtmlToString, type SafeHtml } from '@/utils/sanitize';
import { SearchModal } from '@/components/SearchModal';
import { MapPopup } from '@/components/MapPopup';
import { InsightsPanel } from '@/components/InsightsPanel';
import { ThreatTimelinePanel } from '@/components/ThreatTimelinePanel';
import { CountryDeepDivePanel } from '@/components/CountryDeepDivePanel';
import { CountryBriefPage } from '@/components/CountryBriefPage';
import { SignalModal } from '@/components/SignalModal';
import { DeckGLMap } from '@/components/DeckGLMap';
import { GlobeMap } from '@/components/GlobeMap';
import { MonitorPanel } from '@/components/MonitorPanel';
import { GoodThingsDigestPanel } from '@/components/GoodThingsDigestPanel';
import { HeroSpotlightPanel } from '@/components/HeroSpotlightPanel';
import { BreakthroughsTickerPanel } from '@/components/BreakthroughsTickerPanel';
import { clusterNews } from '@/services/clustering';

vi.mock('@/config/commands', () => ({ getAllCommands: () => [] }));

const NOW = Date.parse('2026-11-13T18:00:00Z');
const cleanup: Array<() => void> = [];
const title = 'Pentagon and FBI tell citizens to stockpile';
function news(source: string, link: string, headline = title): NewsItem {
  return { source, link, title: headline, pubDate: new Date(NOW - 60_000), isAlert: true };
}
function story(overrides: Partial<ServerInsightStory> = {}): ServerInsightStory {
  return {
    primaryTitle: title, primarySource: 'Viral Feed', primaryLink: 'https://example.com/viral',
    pubDate: new Date(NOW - 60_000).toISOString(), sourceCount: 50, uniqueSourceCount: 20,
    importanceScore: 100, velocity: { level: 'spike', sourcesPerHour: 50 }, isAlert: true,
    category: 'general', threatLevel: 'critical', countryCode: null, ...overrides,
  };
}
function insights(topStories: ServerInsightStory[]): ServerInsights {
  return { worldBrief: '', briefProvider: '', status: 'ok', topStories, generatedAt: new Date(NOW).toISOString(), clusterCount: topStories.length, multiSourceCount: 1, fastMovingCount: 1 };
}
function confidence(host: Element): string[] {
  return [...host.querySelectorAll('.story-confidence')].map(badge => badge.textContent ?? '');
}

beforeAll(initTestI18n);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
});
afterEach(() => {
  cleanup.splice(0).forEach(fn => fn());
  vi.advanceTimersByTime(500);
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('confidence labels across dashboard story surfaces', () => {
  it('search uses the indexed news corpus and does not invent evidence for incomplete result data', () => {
    const modal = new SearchModal(document.body);
    cleanup.push(() => modal.close('replacement'));
    const articles = [
      news('AP News', 'https://apnews.com/article/a'),
      news('Reuters World', 'https://reuters.com/article/a'),
    ];
    modal.registerSource('news', [
      ...articles.map(item => ({ id: item.link, title: item.title, data: item })),
      { id: 'missing', title: 'FBI incomplete record', data: { link: 'https://fbi.gov/news/a' } },
    ]);
    modal.open();
    const input = document.querySelector<HTMLInputElement>('.search-input')!;
    input.value = 'FBI';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(confidence(document.body).sort()).toEqual(['Credible', 'Credible', 'Unconfirmed'].sort());
  });

  it('map markers without original evidence stay Unconfirmed despite high corroboration counts', () => {
    const renderer = Object.create(MapPopup.prototype) as {
      renderNewsPopup(data: { title: string; corroboration: { state: 'corroborated'; publishers: number } }): string;
    };
    const host = document.createElement('div');
    host.innerHTML = renderer.renderNewsPopup({ title, corroboration: { state: 'corroborated', publishers: 30 } });
    expect(confidence(host)).toEqual(['Unconfirmed']);
    expect(host.querySelector('.story-confidence')?.getAttribute('title')).toContain('original publisher evidence');
  });

  it('hotspot related articles carry their own confidence, not the hotspot threat score', () => {
    const renderer = Object.create(MapPopup.prototype) as {
      renderHotspotPopup(hotspot: unknown, items: NewsItem[]): string;
    };
    const host = document.createElement('div');
    host.innerHTML = renderer.renderHotspotPopup(
      { id: 'family-test', name: 'Example', lat: 1, lon: 2, keywords: [], level: 'high', subtext: '' },
      [news('FAA', 'https://faa.gov/news/a'), news('Viral Feed', 'https://example.com/viral', 'Another unsupported story')],
    );
    expect(confidence(host)).toEqual(['Confirmed', 'Unconfirmed']);
  });

  it('server insights call stories Latest reports and never turn isAlert or source counts into confirmation', () => {
    const host = document.createElement('div');
    const renderer = Object.assign(Object.create(InsightsPanel.prototype), {
      setSafeContent(html: SafeHtml) { host.innerHTML = safeHtmlToString(html); },
      renderFocalPoints: () => '', renderConvergenceZones: () => '',
      renderSentimentOverview: () => '', renderMissedStories: () => '',
    }) as { renderServerInsights(data: ServerInsights, sentiments: null): void };
    renderer.renderServerInsights(insights([story(), story({ primaryTitle: 'Official update', primarySource: 'FAA', primaryLink: 'https://faa.gov/news/a' })]), null);
    expect(confidence(host)).toEqual(['Unconfirmed', 'Confirmed']);
    expect(host.textContent).toContain('Latest reports');
    expect(host.textContent).not.toContain('BREAKING & CONFIRMED');
    expect(host.querySelector('.insight-badge.alert')).toBeNull();
  });

  it('client insight clusters use original article evidence and suppress the single-story alert badge', () => {
    const renderer = Object.create(InsightsPanel.prototype) as {
      renderBreakingStories(items: Array<{ cluster: ClusteredEvent; isq: { tier: string } }>, sentiments: null): string;
    };
    const clusters = clusterNews([news('Viral Feed', 'https://example.com/viral')]);
    const host = document.createElement('div');
    host.innerHTML = renderer.renderBreakingStories(clusters.map(cluster => ({ cluster, isq: { tier: 'strong' } })), null);
    expect(confidence(host)).toEqual(['Unconfirmed']);
    expect(host.querySelector('.insight-badge.alert')).toBeNull();
  });

  it('threat timeline labels confidence separately from severity and ignores synthesized evidence times', () => {
    const panel = new ThreatTimelinePanel();
    document.body.append(panel.getElement());
    cleanup.push(() => panel.destroy());
    panel.updateFromServerInsights(insights([
      story(),
      story({ primaryTitle: 'Official update', primarySource: 'FAA', primaryLink: 'https://faa.gov/news/a' }),
    ]));
    vi.advanceTimersByTime(200);
    expect(confidence(panel.getElement()).sort()).toEqual(['Confirmed', 'Unconfirmed'].sort());
    expect(panel.getElement().querySelector('.threat-timeline-groups')?.getAttribute('aria-label')).toBe('Reports grouped by threat classification');
    panel.updateFromServerInsights(insights([
      story({ primarySource: 'AP News', primaryLink: 'https://apnews.com/article/a', pubDate: '' }),
      story({ primarySource: 'Reuters World', primaryLink: 'https://reuters.com/article/a', pubDate: '' }),
    ]));
    vi.advanceTimersByTime(200);
    expect(confidence(panel.getElement())).toEqual(['Unconfirmed', 'Unconfirmed']);
  });

  it('country deep-dive news assesses the pre-deduplication corpus', () => {
    const host = document.createElement('div');
    const renderer = Object.assign(Object.create(CountryDeepDivePanel.prototype), { newsBody: host }) as {
      updateNews(items: NewsItem[]): void;
    };
    renderer.updateNews([
      news('AP News', 'https://apnews.com/article/a'),
      news('Reuters World', 'https://reuters.com/article/a'),
      news('Viral Feed', 'https://example.com/unsupported', 'A completely different unsupported claim'),
    ]);
    expect(confidence(host).sort()).toEqual(['Credible', 'Unconfirmed'].sort());
  });

  it('country brief news shows confidence independently of severity', () => {
    const host = document.createElement('div');
    host.innerHTML = '<section class="cb-news-section"><div class="cb-news-content"></div></section>';
    const renderer = Object.assign(Object.create(CountryBriefPage.prototype), { overlay: host }) as {
      updateNews(items: NewsItem[]): void;
    };
    renderer.updateNews([
      news('FAA', 'https://faa.gov/news/a'),
      news('Viral Feed', 'https://example.com/unsupported', 'Another unsupported claim'),
    ]);
    expect(confidence(host)).toEqual(['Confirmed', 'Unconfirmed']);
  });

  it('signal article excerpts without original publication metadata stay Unconfirmed', () => {
    const renderer = Object.create(SignalModal.prototype) as {
      renderSpikeEvidence(signal: unknown): string;
    };
    const host = document.createElement('div');
    host.innerHTML = renderer.renderSpikeEvidence({
      type: 'keyword_spike', data: { articles: [{ source: 'FAA', link: 'https://faa.gov/news/a', title }] },
    });
    expect(confidence(host)).toEqual(['Unconfirmed']);
  });

  it('direct flat-map and globe news tooltips fail closed without source evidence', () => {
    const deckTooltip = (DeckGLMap.prototype as unknown as { getTooltip(info: unknown): { html: string } }).getTooltip;
    const host = document.createElement('div');
    host.innerHTML = deckTooltip.call({}, {
      layer: { id: 'news-locations-layer' },
      object: { title, corroboration: { state: 'corroborated', publishers: 20 } },
    }).html;
    expect(confidence(host)).toEqual(['Unconfirmed']);

    const anchor = document.createElement('button');
    host.append(anchor);
    document.body.append(host);
    const globe = {
      container: host, popup: null, tooltipEl: null as HTMLElement | null, tooltipHideTimer: null,
      hideTooltip() { globe.tooltipEl?.remove(); globe.tooltipEl = null; },
    };
    const show = (GlobeMap.prototype as unknown as { showMarkerTooltip(marker: unknown, anchor: HTMLElement): void }).showMarkerTooltip;
    show.call(globe, { _kind: 'newsLocation', _lat: 1, _lng: 2, id: 'n', title, threatLevel: 'high' }, anchor);
    expect(confidence(globe.tooltipEl!)).toEqual(['Unconfirmed']);
  });

  it('keyword monitor matches use the full corpus, including evidence outside its display filter', () => {
    const panel = new MonitorPanel([{ id: 'family', keywords: ['FBI'], color: '#336699' }]);
    document.body.append(panel.getElement());
    cleanup.push(() => panel.destroy());
    panel.renderResults([
      news('AP News', 'https://apnews.com/article/a'),
      ...Array.from({ length: 9 }, (_, index) => news('Viral Feed', `https://example.com/${index}`, `FBI unsupported other claim ${index}`)),
      news('Reuters World', 'https://reuters.com/article/a'),
    ]);
    expect(confidence(panel.getElement())).toEqual(['Credible', ...Array<string>(9).fill('Unconfirmed')]);
  });

  it('happy digest, spotlight and ticker retain story confidence beside their headlines', async () => {
    const articles = [news('FAA', 'https://faa.gov/news/a')];
    const digest = new GoodThingsDigestPanel();
    const hero = new HeroSpotlightPanel();
    const ticker = new BreakthroughsTickerPanel();
    cleanup.push(() => digest.destroy(), () => hero.destroy(), () => ticker.destroy());
    // Detached digest renders its headline immediately and skips AI/network work.
    await digest.setStories(articles);
    hero.setHeroStory(articles[0]);
    ticker.setItems(articles);
    expect(confidence(digest.getElement())).toEqual(['Confirmed']);
    expect(confidence(hero.getElement())).toEqual(['Confirmed']);
    expect(confidence(ticker.getElement())).toEqual(['Confirmed', 'Confirmed']); // seamless ticker duplicates its track
  });
});
