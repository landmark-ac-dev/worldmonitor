import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NewsItem, CyberThreat, MarketData } from '../src/types/index.ts';
import type { WeatherAlert } from '../src/services/weather.ts';
import {
  buildSituationRoomModel, SITUATION_ROOM_NEWS_STALE_MS,
  type SituationRoomInput,
} from '../src/services/situation-room-model.ts';

const NOW = Date.parse('2026-11-14T01:00:00Z');
const HOUR = 3_600_000;
function news(source: string, title: string, link: string, ago = HOUR): NewsItem {
  return { source, title, link, pubDate: new Date(NOW - ago), isAlert: false };
}
const statement = news('FBI', 'Agency publishes its annual public report', 'https://fbi.gov/news/report');
const aviation = news('FAA', 'Flights grounded at Example Airport', 'https://faa.gov/news/grounded');
const finance = news('Stripe Status', 'Payment processing outage continues', 'https://status.stripe.com/incidents/a');
function input(overrides: Partial<SituationRoomInput> = {}): SituationRoomInput {
  return {
    news: [statement], newsUpdatedAt: NOW - 60_000, newsDegraded: false, online: true,
    aviation: null, cyber: null, markets: null, weather: null, ...overrides,
  };
}

describe('TV situation status is bounded by local news evidence', () => {
  it('never treats missing data as normal coverage', () => {
    const result = buildSituationRoomModel(input({ news: [], newsUpdatedAt: null }), NOW);
    assert.equal(result.status, 'Watching');
    assert.equal(result.lastUpdatedAt, null);
    assert.match(result.statusDetail, /not current/);
    assert.deepEqual(result.slides.map((slide) => slide.id), ['facts', 'patterns', 'aviation', 'cyber', 'finance', 'weather']);
  });

  it('labels Normal as an observation about loaded reports, never safety', () => {
    const result = buildSituationRoomModel(input(), NOW);
    assert.equal(result.status, 'Normal');
    assert.match(result.statusDetail, /No qualifying pattern in loaded reports/);
    assert.match(result.statusDetail, /not a safety assessment/);
  });

  it('keeps a single qualifying disruption Watching', () => {
    assert.equal(buildSituationRoomModel(input({ news: [aviation] }), NOW).status, 'Watching');
    assert.equal(buildSituationRoomModel(input({ news: [aviation, { ...aviation, title: 'Flights grounded at Second Airport' }] }), NOW).status, 'Watching');
  });

  it('requires a fresh committed snapshot and PR1 cross-domain pattern for Active', () => {
    const result = buildSituationRoomModel(input({ news: [aviation, finance] }), NOW);
    assert.equal(result.status, 'Active');
    assert.match(result.statusDetail, /shared cause has not been established/);
    const rows = result.slides.find((slide) => slide.id === 'patterns')!.items;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.sources![0]!.name), ['FAA', 'Stripe Status']);
  });

  it('cannot use fresh receipt times to renew old publications', () => {
    const old = [aviation, finance].map((item) => ({ ...item, pubDate: new Date(NOW - 7 * HOUR) }));
    const result = buildSituationRoomModel(input({ news: old, newsUpdatedAt: NOW }), NOW);
    assert.equal(result.status, 'Watching');
    assert.equal(result.slides[0]!.items.length, 0);
  });

  it('downgrades offline, stale, degraded, absent and future news receipts', () => {
    for (const override of [
      { online: false }, { newsDegraded: true }, { newsUpdatedAt: null },
      { newsUpdatedAt: NOW - SITUATION_ROOM_NEWS_STALE_MS - 1 },
      { newsUpdatedAt: NOW + 1 }, { newsUpdatedAt: NaN },
    ]) {
      const result = buildSituationRoomModel(input({ news: [aviation, finance], ...override }), NOW);
      assert.equal(result.status, 'Watching', JSON.stringify(override));
      assert.match(result.slides[1]!.kicker, /not a current alert/);
    }
  });

  it('does not treat unconfirmed or synthetic-dated stories as pattern evidence', () => {
    const viral = { ...finance, source: 'Viral post', link: 'https://example.com/rumor' };
    assert.equal(buildSituationRoomModel(input({ news: [aviation, viral] }), NOW).status, 'Watching');
    const missingDate = { ...finance, pubDateMissing: true };
    assert.equal(buildSituationRoomModel(input({ news: [aviation, missingDate] }), NOW).status, 'Watching');
    const future = { ...finance, pubDate: new Date(NOW + HOUR) };
    assert.equal(buildSituationRoomModel(input({ news: [aviation, future] }), NOW).status, 'Watching');
  });

  it('retains both links for credible stories and caps the TV brief at three', () => {
    const ap = news('AP News', 'New public research results published', 'https://apnews.com/article/a');
    const reuters = news('Reuters World', ap.title, 'https://reuters.com/article/a');
    const result = buildSituationRoomModel(input({ news: [ap, reuters, statement, aviation, finance] }), NOW);
    assert.equal(result.slides[0]!.items.length, 3);
    assert.equal(result.slides[0]!.items[0]!.assessment?.tier, 'Credible');
    assert.equal(result.slides[0]!.items[0]!.sources?.length, 2);
  });

  it('shows distinct pattern domains before repeating another report', () => {
    const moreAviation = [1, 2, 3].map((i) => ({ ...aviation, title: `Flights grounded at Airport ${i}` }));
    const result = buildSituationRoomModel(input({ news: [...moreAviation, finance] }), NOW);
    const rows = result.slides[1]!.items;
    assert.equal(rows.length, 2);
    assert.match(rows[1]!.title, /Payment/);
  });
});

describe('operational TV cards preserve limits and source times', () => {
  it('does not turn cyber indicators or price moves into an Active disruption', () => {
    const cyber: CyberThreat = {
      id: 'ioc', type: 'malware_host', source: 'urlhaus', indicator: 'example.test', indicatorType: 'domain',
      lat: 0, lon: 0, severity: 'critical', tags: [], lastSeen: new Date(NOW - HOUR).toISOString(),
    };
    const markets: MarketData[] = [{ symbol: 'EX', name: 'Example', display: 'EX', price: 100, change: -50 }];
    const result = buildSituationRoomModel(input({ cyber: [cyber], markets }), NOW);
    assert.equal(result.status, 'Normal');
    assert.match(result.slides[3]!.kicker, /not confirmed outages/);
    assert.match(result.slides[4]!.items[0]!.detail!, /source time unavailable/);
  });

  it('never substitutes a new receipt for a source timestamp', () => {
    const result = buildSituationRoomModel(input({
      sources: { finance: { enabled: true, state: 'available', receivedAt: NOW, sourceUpdatedAt: null } },
    }), NOW);
    assert.match(result.slides[4]!.footnote, /source time unavailable/);
    assert.match(result.slides[4]!.footnote, /cached/);
    assert.equal(result.lastUpdatedAt, NOW - 60_000);
  });

  it('names disabled and failed coverage without claiming empty conditions', () => {
    const result = buildSituationRoomModel(input({
      sources: {
        cyber: { enabled: false, state: 'not-loaded', receivedAt: null, sourceUpdatedAt: null },
        weather: { enabled: true, state: 'error', receivedAt: NOW - HOUR, sourceUpdatedAt: null },
      },
    }), NOW);
    assert.match(result.slides[3]!.footnote, /not enabled/);
    assert.match(result.slides[5]!.footnote, /retained records may be out of date/);
  });

  it('filters expired or unknown-expiry weather and rejects unsafe bulletin links', () => {
    const bulletin: WeatherAlert = {
      id: 'weather', event: 'Wind', severity: 'Severe', headline: 'Wind bulletin', description: '', areaDesc: 'Example region',
      onset: new Date(NOW - HOUR), expires: new Date(NOW + HOUR), coordinates: [],
      sourceUrl: 'javascript:alert(1)',
    };
    const result = buildSituationRoomModel(input({ weather: [
      bulletin, { ...bulletin, id: 'old', expires: new Date(NOW) },
      { ...bulletin, id: 'unknown', expires: new Date(NaN) },
    ] }), NOW);
    assert.equal(result.slides[5]!.items.length, 1);
    assert.equal(result.slides[5]!.items[0]!.sources, undefined);
  });
});
