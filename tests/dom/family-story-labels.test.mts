import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTestI18n } from './helpers/i18n.mts';
import type { NewsItem } from '@/types';
import type { ClimateNewsItem, ListClimateNewsResponse } from '@/generated/client/worldmonitor/climate/v1/service_client';
import type { GdeltArticle } from '@/services/gdelt-intel';

vi.mock('@/services/gdelt-intel', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/gdelt-intel')>(),
  fetchTopicIntelligence: vi.fn(() => new Promise<never>(() => {})),
  fetchTopicTimeline: vi.fn(() => new Promise<never>(() => {})),
}));

import { Panel } from '@/components/Panel';
import { TelegramIntelPanel } from '@/components/TelegramIntelPanel';
import { XIntelPanel } from '@/components/XIntelPanel';
import { ClimateNewsPanel } from '@/components/ClimateNewsPanel';
import { PositiveNewsFeedPanel } from '@/components/PositiveNewsFeedPanel';
import { GdeltIntelPanel } from '@/components/GdeltIntelPanel';

const NOW = Date.parse('2026-11-13T18:00:00Z');
const panels: Panel[] = [];
function mount<T extends Panel>(panel: T): T {
  panels.push(panel);
  document.body.append(panel.getElement());
  return panel;
}
function labels(panel: Panel): string[] {
  return [...panel.getElement().querySelectorAll('.story-confidence')].map((badge) => badge.textContent ?? '');
}
function item(source: string, link: string): NewsItem {
  return { source, link, title: 'Research team publishes new public results', pubDate: new Date(NOW - 60_000), isAlert: false };
}

beforeAll(async () => { await initTestI18n(); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => {
  panels.splice(0).forEach((panel) => panel.destroy());
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('confidence labels on independent story panels', () => {
  it('keeps even curated Telegram channels and quoted agency links Unconfirmed', () => {
    const panel = mount(new TelegramIntelPanel());
    panel.setData({
      source: 'telegram', earlySignal: true, enabled: true, count: 1, updatedAt: new Date(NOW).toISOString(),
      items: [{
        id: 'IDFofficial:1', source: 'telegram', channel: 'IDFofficial', channelTitle: 'FBI',
        url: 'https://t.me/IDFofficial/1', ts: new Date(NOW).toISOString(),
        text: 'FBI statement: https://www.fbi.gov/news/example', topic: 'breaking', tags: [], earlySignal: true,
      }],
    });
    expect(labels(panel)).toEqual(['Unconfirmed']);
    expect(panel.getElement().querySelector('.story-confidence')?.getAttribute('title')).toContain('quoted link does not verify');
  });

  it('does not upgrade an X account title or links embedded in the post', () => {
    const panel = mount(new XIntelPanel());
    panel.setData({
      source: 'x', earlySignal: true, enabled: true, count: 1, updatedAt: new Date(NOW).toISOString(),
      items: [{
        id: 'example:1', source: 'x', account: 'example', accountTitle: 'FAA',
        url: 'https://x.com/example/status/1', ts: new Date(NOW).toISOString(),
        text: 'https://www.faa.gov/news/example says flights grounded', topic: 'breaking', tags: [], earlySignal: true,
      }],
    });
    expect(labels(panel)).toEqual(['Unconfirmed']);
    expect(panel.getElement().querySelector('.story-confidence')?.getAttribute('title')).toContain('social post');
  });

  it('assesses the full positive-news corpus even after a category filter hides one publisher', () => {
    const panel = mount(new PositiveNewsFeedPanel());
    const ap = { ...item('AP News', 'https://apnews.com/article/a'), happyCategory: 'science-health' as const };
    const reuters = { ...item('Reuters World', 'https://reuters.com/article/a'), happyCategory: 'nature-wildlife' as const };
    panel.renderPositiveNews([ap, reuters, { ...item('Hacker News', 'https://faa.gov/news/a'), title: 'An unverified headline' }]);
    expect(labels(panel)).toEqual(['Credible', 'Credible', 'Unconfirmed']);
    // Exercise the renderer's filter contract without depending on translated category labels.
    (panel as unknown as { setFilter(filter: string): void }).setFilter('science-health');
    expect(labels(panel)).toEqual(['Credible']);
  });

  it('labels each climate card from its original source, URL and publication time', () => {
    const panel = mount(new ClimateNewsPanel());
    const makeClimate = (sourceName: string, url: string): ClimateNewsItem => ({
      id: url, title: 'Research team publishes new public results', url, sourceName, publishedAt: NOW - 60_000,
      summary: '',
    });
    const data = { items: [
      makeClimate('AP News', 'https://apnews.com/article/a'),
      makeClimate('Reuters World', 'https://reuters.com/article/a'),
      { ...makeClimate('Example', 'https://example.com/a'), title: 'A single unverified story' },
    ] } as ListClimateNewsResponse;
    (panel as unknown as { renderNewsList(data: ListClimateNewsResponse): void }).renderNewsList(data);
    vi.advanceTimersByTime(200);
    expect(labels(panel)).toEqual(['Credible', 'Credible', 'Unconfirmed']);
  });

  it('does not turn an indexed GDELT domain or publisher-like source name into confirmation', () => {
    const panel = mount(new GdeltIntelPanel());
    const articles: GdeltArticle[] = ['faa.gov', 'FAA', 'AP News'].map((source) => ({
      source, title: 'An indexed headline', url: 'https://faa.gov/news/a', date: new Date(NOW).toISOString(),
    }));
    (panel as unknown as { renderArticles(articles: GdeltArticle[]): void }).renderArticles(articles);
    expect(labels(panel)).toEqual(['Unconfirmed', 'Unconfirmed', 'Unconfirmed']);
    expect(panel.getElement().querySelector('.story-confidence')?.getAttribute('title')).toContain('indexed domain alone');
  });
});
