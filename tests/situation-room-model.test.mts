import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NewsItem, CyberThreat, MarketData } from '../src/types/index.ts';
import type { WeatherAlert } from '../src/services/weather.ts';
import type { AirportDelayAlert } from '../src/services/aviation/index.ts';
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
    assert.deepEqual(result.slides.map((slide) => slide.id), ['facts', 'patterns', 'aviation', 'cyber', 'finance', 'weather', 'live-tv']);
    assert.equal(result.slides[6]!.title, 'Live TV');
    assert.equal(result.slides[6]!.footnote, 'Live broadcast · claims are not automatically confirmed');
    assert.deepEqual(result.slides[6]!.items, []);
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

  it('keeps even two Confirmed official disruption sources Watching without common-cause evidence', () => {
    const result = buildSituationRoomModel(input({ news: [aviation, finance] }), NOW);
    assert.equal(result.status, 'Watching');
    assert.match(result.statusDetail, /shared cause has not been established/);
    const rows = result.slides.find((slide) => slide.id === 'patterns')!.items;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.sources![0]!.name), ['FAA', 'Stripe Status']);
    assert.ok(rows.every((row) => row.assessment?.tier === 'Confirmed'));
  });

  it('keeps current credible and unconfirmed disruption reports Watching beside ordinary news', () => {
    const title = 'Payment processing outage continues';
    const ap = news('AP News', title, 'https://apnews.com/article/outage');
    const reuters = news('Reuters World', title, 'https://reuters.com/article/outage');
    const rumor = news('Viral post', title, 'https://example.com/rumor');
    for (const reports of [[ap, reuters], [rumor]]) {
      const result = buildSituationRoomModel(input({ news: [statement, ...reports] }), NOW);
      assert.equal(result.status, 'Watching');
      assert.equal(result.slides[1]!.items.length, 0);
    }
    const staleRumor = { ...rumor, pubDate: new Date(NOW - 7 * HOUR) };
    assert.equal(buildSituationRoomModel(input({ news: [statement, staleRumor] }), NOW).status, 'Normal');
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
  it('excludes synthetic aviation coverage rows from delays and source observation times', () => {
    const delay: AirportDelayAlert = {
      id: 'delay', iata: 'EXA', icao: 'KEXA', name: 'Example Airport', city: 'Example', country: 'US',
      lat: 0, lon: 0, region: 'americas', severity: 'major', source: 'faa',
      delayType: 'ground_stop', avgDelayMinutes: 60, updatedAt: new Date(NOW - HOUR),
    };
    const unknown: AirportDelayAlert = { ...delay, id: 'unknown', severity: 'unknown', source: 'unspecified', updatedAt: new Date(NOW) };
    const normal: AirportDelayAlert = { ...delay, id: 'normal', severity: 'normal', updatedAt: new Date(NOW) };
    const available = { enabled: true, state: 'available' as const, receivedAt: NOW, sourceUpdatedAt: NOW };
    const mixed = buildSituationRoomModel(input({ aviation: [unknown, normal, delay], sources: { aviation: available } }), NOW).slides[2]!;
    assert.equal(mixed.items.length, 1);
    assert.match(mixed.items[0]!.detail!, /reported 1 hr ago/);
    assert.match(mixed.footnote, /Newest dated record: 1 hr ago/);
    const unconnected = buildSituationRoomModel(input({ aviation: [unknown], sources: { aviation: { ...available, state: 'error' } } }), NOW).slides[2]!;
    assert.equal(unconnected.items.length, 0);
    assert.equal(unconnected.kicker, 'Feed not connected');
    assert.match(unconnected.footnote, /source time unavailable/);
    const coveredNormal = buildSituationRoomModel(input({ aviation: [normal], sources: { aviation: available } }), NOW).slides[2]!;
    assert.equal(coveredNormal.items.length, 0);
    assert.doesNotMatch(coveredNormal.kicker, /Feed not connected/);
    assert.match(coveredNormal.footnote, /source time unavailable/);
  });

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
      markets: [],
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
    assert.equal(result.slides[3]!.kicker, 'Feed not connected');
    assert.match(result.slides[5]!.emptyMessage, /^Feed not connected/);
  });

  it('distinguishes connected empty snapshots from absent, failed and offline feeds', () => {
    const available = { enabled: true, state: 'available' as const, receivedAt: NOW, sourceUpdatedAt: null };
    const connected = input({
      aviation: [], cyber: [], markets: [], weather: [],
      sources: { aviation: available, cyber: available, finance: available, weather: available },
    });
    for (const slide of buildSituationRoomModel(connected, NOW).slides.slice(2, 6)) {
      assert.doesNotMatch(slide.kicker, /Feed not connected/);
      assert.doesNotMatch(slide.emptyMessage, /Feed not connected/);
      assert.equal(slide.items.length, 0);
    }
    for (const override of [
      { online: false }, { sources: {} },
      { sources: { finance: { ...available, state: 'error' as const } } },
      { sources: { finance: { ...available, receivedAt: NOW + 1 } } },
      { markets: null },
    ]) {
      const slide = buildSituationRoomModel({ ...connected, ...override }, NOW).slides[4]!;
      assert.equal(slide.kicker, 'Feed not connected');
      assert.match(slide.emptyMessage, /^Feed not connected/);
    }
  });

  it('labels retained records when a feed is disconnected without erasing the records', () => {
    const result = buildSituationRoomModel(input({
      markets: [{ symbol: 'EX', name: 'Example', price: 100, change: 1, priceAt: NOW - HOUR }],
      sources: { finance: { enabled: true, state: 'retained', receivedAt: NOW - HOUR, sourceUpdatedAt: NOW - HOUR } },
    }), NOW);
    const slide = result.slides[4]!;
    assert.match(slide.kicker, /^Feed not connected · retained records/);
    assert.equal(slide.items.length, 1);
    assert.match(slide.footnote, /retained records may be out of date/);
  });

  it('labels cached snapshots without claiming a rechecked connection or renewing source timestamps', () => {
    const cachedInput = input({
      markets: [{ symbol: 'EX', name: 'Example', price: 100, change: 1, priceAt: NOW - 2 * HOUR }],
      sources: { finance: { enabled: true, state: 'cached', receivedAt: NOW - HOUR, sourceUpdatedAt: NOW - 2 * HOUR } },
    });
    const originalSource = { ...cachedInput.sources!.finance! };
    const cached = buildSituationRoomModel(cachedInput, NOW).slides[4]!;
    assert.match(cached.kicker, /^Cached records · /);
    assert.doesNotMatch(cached.footnote, /Feed not connected/);
    assert.match(cached.footnote, /Showing a cached snapshot; source connection has not been rechecked/);
    assert.match(cached.footnote, /Newest dated record: 2 hr ago/);
    assert.match(cached.items[0]!.detail!, /quote 2 hr ago/);
    const offline = buildSituationRoomModel({ ...cachedInput, online: false }, NOW).slides[4]!;
    assert.match(offline.kicker, /^Feed not connected · retained records/);
    assert.match(offline.footnote, /Newest dated record: 2 hr ago/);
    assert.equal(offline.items.length, 1);
    assert.deepEqual(cachedInput.sources!.finance, originalSource);
    const unknownTime = buildSituationRoomModel({
      ...cachedInput, sources: { finance: { ...originalSource, sourceUpdatedAt: null } },
    }, NOW).slides[4]!;
    assert.match(unknownTime.footnote, /source time unavailable/);
    const noReceipt = buildSituationRoomModel({
      ...cachedInput, sources: { finance: { ...originalSource, receivedAt: null } },
    }, NOW).slides[4]!;
    assert.match(noReceipt.kicker, /^Feed not connected/);
  });

  it('keeps valid empty cached snapshots distinct from disconnected feeds', () => {
    const cached = { enabled: true, state: 'cached' as const, receivedAt: NOW - 60_000, sourceUpdatedAt: null };
    const snapshot = input({
      aviation: [], cyber: [], markets: [], weather: [],
      sources: { aviation: cached, cyber: cached, finance: cached, weather: cached },
    });
    for (const slide of buildSituationRoomModel(snapshot, NOW).slides.slice(2, 6)) {
      assert.match(slide.kicker, /^Cached records · /);
      assert.doesNotMatch(slide.emptyMessage, /Feed not connected/);
      assert.match(slide.footnote, /source connection has not been rechecked/);
      assert.equal(slide.items.length, 0);
    }
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
