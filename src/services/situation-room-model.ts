import type { CyberThreat, MarketData, NewsItem } from '@/types';
import type { StoryAssessment, StorySource } from '@/types/family-facts';
import type { AirportDelayAlert } from '@/services/aviation';
import type { WeatherAlert } from '@/services/weather';
import { buildFamilyBrief, familyDisruptionDomain } from './family-facts';
import { effectivePubDateMs } from './feed-date';
import { FAMILY_FACTS_WINDOW_MS } from '@/config/family-facts';

export type SituationRoomDomain = 'aviation' | 'cyber' | 'finance' | 'weather';
export interface SituationRoomSourceState {
  enabled: boolean;
  /** Availability of the loaded body, never a claim that a provider is live. */
  state: 'not-loaded' | 'available' | 'cached' | 'retained' | 'error';
  receivedAt: number | null;
  sourceUpdatedAt: number | null;
}

export interface SituationRoomInput {
  news: readonly NewsItem[];
  newsUpdatedAt: number | null;
  newsDegraded: boolean;
  online: boolean;
  aviation: readonly AirportDelayAlert[] | null;
  cyber: readonly CyberThreat[] | null;
  markets: readonly MarketData[] | null;
  weather: readonly WeatherAlert[] | null;
  sources?: Partial<Record<SituationRoomDomain, SituationRoomSourceState>>;
}

export interface SituationRoomItem {
  title: string;
  detail?: string;
  assessment?: StoryAssessment;
  sources?: StorySource[];
  value?: string;
}

export interface SituationRoomSlide {
  id: 'facts' | 'patterns' | 'live-tv' | SituationRoomDomain;
  title: string;
  kicker: string;
  emptyMessage: string;
  items: SituationRoomItem[];
  footnote: string;
}

export interface SituationRoomModel {
  /** Active is reserved for validated common-cause evidence from two distinct
   * Confirmed official sources. The current input contract cannot supply it. */
  status: 'Normal' | 'Watching' | 'Active';
  statusDetail: string;
  /** Last successful news snapshot receipt, not the source publication time. */
  lastUpdatedAt: number | null;
  slides: SituationRoomSlide[];
}

// The regular news lane runs every ten minutes. Allow a five-minute grace
// period before a successful old receipt stops implying current coverage.
export const SITUATION_ROOM_NEWS_STALE_MS = 15 * 60 * 1000;
const MAX_ROWS = 5;

function pastTimestamp(value: number | null | undefined, now: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now ? value : null;
}

function dateMs(value: Date | string | undefined): number | null {
  const valueMs = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(valueMs) ? valueMs : null;
}

function ageLabel(timestamp: number | null, now: number): string {
  const valid = pastTimestamp(timestamp, now);
  if (valid === null) return 'source time unavailable';
  const minutes = Math.floor((now - valid) / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1_440)} days ago`;
}

function sourceFootnote(input: SituationRoomInput, domain: SituationRoomDomain, now: number): string {
  const source = input.sources?.[domain];
  // Aviation's normal/unknown status rows are synthesized by the RPC with the
  // request time. They cannot establish when a provider observed a delay.
  const sourceUpdatedAt = domain === 'aviation'
    ? (input.aviation ?? []).filter(isObservedDelay).reduce<number | null>((latest, item) => {
      const timestamp = pastTimestamp(dateMs(item.updatedAt), now);
      return timestamp !== null && (latest === null || timestamp > latest) ? timestamp : latest;
    }, null)
    : source?.sourceUpdatedAt ?? null;
  if (!sourceSnapshotAvailable(input, domain, now)) {
    const reason = source?.enabled === false ? 'This source is not enabled.'
      : !input.online ? 'The display is offline.' : 'Current source availability is unknown.';
    return `Feed not connected. ${reason} Any retained records may be out of date; no all-clear is implied. Newest dated record: ${ageLabel(sourceUpdatedAt, now)}.`;
  }
  if (source?.state === 'cached') {
    return `Showing a cached snapshot; source connection has not been rechecked. Newest dated record: ${ageLabel(sourceUpdatedAt, now)}.`;
  }
  return `Loaded records may include cached data. Newest dated record: ${ageLabel(sourceUpdatedAt, now)}.`;
}

function isObservedDelay(item: AirportDelayAlert): boolean {
  return item.severity !== 'normal' && item.severity !== 'unknown' && item.source !== 'unspecified';
}

function sourceSnapshotAvailable(input: SituationRoomInput, domain: SituationRoomDomain, now: number): boolean {
  const source = input.sources?.[domain];
  const records = domain === 'finance' ? input.markets : input[domain];
  return input.online && source?.enabled === true && (source.state === 'available' || source.state === 'cached')
    && pastTimestamp(source.receivedAt, now) !== null && records !== null;
}

function operationalSlide(input: SituationRoomInput, slide: SituationRoomSlide, now: number): SituationRoomSlide {
  const domain = slide.id as SituationRoomDomain;
  if (sourceSnapshotAvailable(input, domain, now)) {
    return input.sources?.[domain]?.state === 'cached'
      ? { ...slide, kicker: `Cached records · ${slide.kicker}` }
      : slide;
  }
  return {
    ...slide,
    kicker: slide.items.length ? `Feed not connected · retained records · ${slide.kicker}` : 'Feed not connected',
    emptyMessage: 'Feed not connected. Current conditions are unknown.',
  };
}

function evidenceItem(item: { title: string; assessment: StoryAssessment }): SituationRoomItem {
  return { title: item.title, assessment: item.assessment, sources: item.assessment.sources };
}

function sourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Read-only projection of the dashboard's existing data; never fetches or infers a shared cause. */
export function buildSituationRoomModel(input: SituationRoomInput, now = Date.now()): SituationRoomModel {
  const brief = buildFamilyBrief(input.news, now);
  const updatedAt = pastTimestamp(input.newsUpdatedAt, now);
  const freshNews = input.online && !input.newsDegraded && updatedAt !== null
    && now - updatedAt <= SITUATION_ROOM_NEWS_STALE_MS;
  const shownPatternDomains = new Set<string>();
  const patternItems = (brief.pattern?.items ?? []).filter((item) => {
    const domain = familyDisruptionDomain(item.title);
    if (!domain || shownPatternDomains.has(domain)) return false;
    shownPatternDomains.add(domain);
    return true;
  });
  const hasDisruption = input.news.some((item) => {
    const publishedAt = pastTimestamp(effectivePubDateMs(item), now);
    return publishedAt !== null && now - publishedAt <= FAMILY_FACTS_WINDOW_MS
      && familyDisruptionDomain(item.title) !== null;
  });

  let status: SituationRoomModel['status'] = 'Watching';
  let statusDetail = 'Coverage is limited; no all-clear is implied.';
  if (!input.online) statusDetail = 'Offline — showing retained reports. Current conditions are unknown.';
  else if (!freshNews) statusDetail = 'News coverage is not current. Retained reports do not establish present conditions.';
  else if (brief.pattern) {
    statusDetail = 'Disruption reports overlap in time, but a shared cause has not been established.';
  } else if (hasDisruption) statusDetail = 'Current disruption reports need attention; a shared cause has not been established. Report confidence may be limited.';
  else if (brief.items.length > 0) {
    status = 'Normal';
    statusDetail = 'No qualifying pattern in loaded reports. This is not a safety assessment.';
  }

  const aviation = [...(input.aviation ?? [])]
    .filter(isObservedDelay)
    .sort((a, b) => (dateMs(b.updatedAt) ?? 0) - (dateMs(a.updatedAt) ?? 0))
    .slice(0, MAX_ROWS).map((item): SituationRoomItem => ({
      title: `${item.iata || item.icao} · ${item.name}`,
      detail: `${item.delayType.replace(/_/g, ' ')} · ${item.source} · reported ${ageLabel(dateMs(item.updatedAt), now)}`,
      value: Number.isFinite(item.avgDelayMinutes) && item.avgDelayMinutes > 0 ? `${Math.round(item.avgDelayMinutes)} min` : item.severity,
    }));
  const cyber = [...(input.cyber ?? [])]
    .sort((a, b) => (dateMs(b.lastSeen) ?? 0) - (dateMs(a.lastSeen) ?? 0))
    .slice(0, MAX_ROWS).map((item): SituationRoomItem => ({
      title: item.malwareFamily || item.type.replace(/_/g, ' '),
      detail: `${item.source} · ${item.country || 'location unspecified'} · last observed ${ageLabel(dateMs(item.lastSeen), now)}`,
      value: item.severity,
    }));
  const markets = (input.markets ?? []).filter((item) => Number.isFinite(item.price) && item.price !== null)
    .slice(0, MAX_ROWS).map((item): SituationRoomItem => ({
      title: item.display || item.symbol,
      detail: `${item.name} · quote ${ageLabel(item.priceAt ?? null, now)}`,
      value: `${item.price!.toLocaleString('en-US', { maximumFractionDigits: 2 })}${typeof item.change === 'number' && Number.isFinite(item.change) ? ` · ${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}%` : ''}`,
    }));
  const weather = [...(input.weather ?? [])]
    .filter((item) => {
      const expires = dateMs(item.expires);
      return expires !== null && expires > now;
    })
    .sort((a, b) => (dateMs(a.expires) ?? 0) - (dateMs(b.expires) ?? 0))
    .slice(0, MAX_ROWS).map((item): SituationRoomItem => ({
      title: item.headline || item.event,
      detail: `${item.areaDesc} · ${item.issuedBy || item.source || 'weather bulletin'} · ${item.severity}`,
      ...(sourceUrl(item.sourceUrl) ? { sources: [{ name: item.source || 'Source bulletin', url: sourceUrl(item.sourceUrl)! }] } : {}),
    }));

  return {
    status, statusDetail, lastUpdatedAt: updatedAt,
    slides: [
      {
        id: 'facts', title: "What's actually true", kicker: 'Source-linked brief · past six hours',
        emptyMessage: updatedAt === null ? 'Feed not connected. Waiting for a successful news refresh.'
          : 'No current reports meet the evidence rules in the loaded feeds.',
        items: brief.items.slice(0, 3).map(evidenceItem),
        footnote: freshNews ? 'Official publications or matching reports from two approved publishers. Coverage depends on selected feeds.' : 'Retained or incomplete news coverage. Read the publication times and linked sources.',
      },
      {
        id: 'patterns', title: 'Disruption patterns', kicker: freshNews ? 'Separate reports · shared time window' : 'Retained evidence · not a current alert',
        emptyMessage: updatedAt === null ? 'Feed not connected. Pattern monitoring needs current news reports.'
          : 'No qualifying cross-domain pattern in the loaded reports. This is not an all-clear.',
        items: patternItems.slice(0, MAX_ROWS).map(evidenceItem),
        footnote: 'At least two distinct domains and verified reports within six hours. Co-occurrence does not establish a common cause.',
      },
      operationalSlide(input, {
        id: 'aviation', title: 'Aviation', kicker: 'Loaded airport delay reports',
        emptyMessage: 'No delay records available in this snapshot; coverage may be incomplete.', items: aviation,
        footnote: sourceFootnote(input, 'aviation', now),
      }, now),
      operationalSlide(input, {
        id: 'cyber', title: 'Cyber', kicker: 'Threat indicators · not confirmed outages',
        emptyMessage: 'No threat indicators loaded for this view.', items: cyber,
        footnote: `${sourceFootnote(input, 'cyber', now)} Indicators do not establish an active attack or disruption.`,
      }, now),
      operationalSlide(input, {
        id: 'finance', title: 'Finance', kicker: 'Selected market watchlist',
        emptyMessage: 'Market quotes are not available in the loaded snapshot.', items: markets,
        footnote: `${sourceFootnote(input, 'finance', now)} Price moves alone do not trigger a disruption alert.`,
      }, now),
      operationalSlide(input, {
        id: 'weather', title: 'Weather', kicker: 'Loaded bulletins with future expiry times',
        emptyMessage: 'No unexpired bulletins in the loaded snapshot. This is not a local forecast or all-clear.', items: weather,
        footnote: `${sourceFootnote(input, 'weather', now)} Bulletins may have changed or been cancelled since publication.`,
      }, now),
      {
        id: 'live-tv', title: 'Live TV', kicker: 'Live broadcast',
        emptyMessage: 'Live broadcast availability depends on the selected channel.',
        items: [],
        footnote: 'Live broadcast · claims are not automatically confirmed',
      },
    ],
  };
}
