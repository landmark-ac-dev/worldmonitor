import type { CyberThreat, MarketData, NewsItem } from '@/types';
import type { StoryAssessment, StorySource } from '@/types/family-facts';
import type { AirportDelayAlert } from '@/services/aviation';
import type { WeatherAlert } from '@/services/weather';
import { buildFamilyBrief, createStoryAssessor, familyDisruptionDomain } from './family-facts';
import { effectivePubDateMs } from './feed-date';
import { FAMILY_FACTS_WINDOW_MS } from '@/config/family-facts';

export type SituationRoomDomain = 'aviation' | 'cyber' | 'finance' | 'weather';
export interface SituationRoomSourceState {
  enabled: boolean;
  /** Availability of the loaded body, never a claim that a provider is live. */
  state: 'not-loaded' | 'available' | 'retained' | 'error';
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
  id: 'facts' | 'patterns' | SituationRoomDomain;
  title: string;
  kicker: string;
  emptyMessage: string;
  items: SituationRoomItem[];
  footnote: string;
}

export interface SituationRoomModel {
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
  if (source?.enabled === false) return 'This source is not enabled in the current dashboard. No all-clear is implied.';
  if (!source || source.state === 'not-loaded') return 'Source freshness is unavailable. This does not establish that nothing is happening.';
  const prefix = source.state === 'error' || source.state === 'retained'
    ? 'Refresh unavailable; retained records may be out of date.'
    : 'Loaded records may include cached data.';
  return `${prefix} Newest dated record: ${ageLabel(source.sourceUpdatedAt, now)}.`;
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
  const assess = createStoryAssessor(input.news, now);
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
      && familyDisruptionDomain(item.title) !== null && assess(item).tier !== 'Unconfirmed';
  });

  let status: SituationRoomModel['status'] = 'Watching';
  let statusDetail = 'Coverage is limited; no all-clear is implied.';
  if (!input.online) statusDetail = 'Offline — showing retained reports. Current conditions are unknown.';
  else if (!freshNews) statusDetail = 'News coverage is not current. Retained reports do not establish present conditions.';
  else if (brief.pattern) {
    status = 'Active';
    statusDetail = 'Qualifying disruptions in at least two domains. A shared cause has not been established.';
  } else if (hasDisruption) statusDetail = 'One qualifying disruption domain in loaded reports; no cross-domain pattern.';
  else if (brief.items.length > 0) {
    status = 'Normal';
    statusDetail = 'No qualifying pattern in loaded reports. This is not a safety assessment.';
  }

  const aviation = [...(input.aviation ?? [])]
    .filter((item) => item.severity !== 'normal')
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
        emptyMessage: 'No current reports meet the evidence rules in the loaded feeds.',
        items: brief.items.slice(0, 3).map(evidenceItem),
        footnote: freshNews ? 'Official publications or matching reports from two approved publishers. Coverage depends on selected feeds.' : 'Retained or incomplete news coverage. Read the publication times and linked sources.',
      },
      {
        id: 'patterns', title: 'Disruption patterns', kicker: freshNews ? 'Separate reports · shared time window' : 'Retained evidence · not a current alert',
        emptyMessage: 'No qualifying cross-domain pattern in the loaded reports. This is not an all-clear.',
        items: patternItems.slice(0, MAX_ROWS).map(evidenceItem),
        footnote: 'At least two distinct domains and verified reports within six hours. Co-occurrence does not establish a common cause.',
      },
      {
        id: 'aviation', title: 'Aviation', kicker: 'Loaded airport delay reports',
        emptyMessage: 'No delay records available in this snapshot; coverage may be incomplete.', items: aviation,
        footnote: sourceFootnote(input, 'aviation', now),
      },
      {
        id: 'cyber', title: 'Cyber', kicker: 'Threat indicators · not confirmed outages',
        emptyMessage: 'No threat indicators loaded for this view.', items: cyber,
        footnote: `${sourceFootnote(input, 'cyber', now)} Indicators do not establish an active attack or disruption.`,
      },
      {
        id: 'finance', title: 'Finance', kicker: 'Selected market watchlist',
        emptyMessage: 'Market quotes are not available in the loaded snapshot.', items: markets,
        footnote: `${sourceFootnote(input, 'finance', now)} Price moves alone do not trigger a disruption alert.`,
      },
      {
        id: 'weather', title: 'Weather', kicker: 'Loaded bulletins with future expiry times',
        emptyMessage: 'No unexpired bulletins in the loaded snapshot. This is not a local forecast or all-clear.', items: weather,
        footnote: `${sourceFootnote(input, 'weather', now)} Bulletins may have changed or been cancelled since publication.`,
      },
    ],
  };
}
