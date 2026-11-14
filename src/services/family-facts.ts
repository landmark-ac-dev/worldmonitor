import type { NewsItem } from '@/types';
import type {
  DisruptionDomain, FamilyBrief, FamilyBriefItem, FamilySourcePolicy, StoryAssessment, StorySource,
} from '@/types/family-facts';
import {
  FAMILY_CREDIBLE_PUBLISHERS, FAMILY_FACTS_WINDOW_MS, FAMILY_OFFICIAL_SOURCES,
} from '@/config/family-facts';
import { effectivePubDateMs } from './feed-date';

export type { FamilyBrief, FamilyBriefItem, StoryAssessment } from '@/types/family-facts';

/** Do not treat an aggregator URL, display name, or redirect target as evidence. */
function evidenceUrl(link: string): URL | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (/(?:^|\/)(?:redirect|out|away|url)(?:\/|$)/i.test(url.pathname)) return null;
    for (const key of url.searchParams.keys()) {
      if (/^(?:url|u|target|redirect|redirect_uri|redirect_url|next|destination)$/i.test(key)) return null;
    }
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function sourceFor(item: NewsItem, policies: readonly FamilySourcePolicy[]): StorySource | null {
  const url = evidenceUrl(item.link);
  if (!url) return null;
  const policy = policies.find((entry) => entry.feedNames.includes(item.source) && entry.hosts.some((host) => (
    url.hostname === host || (entry.includeSubdomains && url.hostname.endsWith(`.${host}`))
  )));
  return policy ? { name: policy.name, url: url.href } : null;
}

/**
 * Intentionally conservative: no topic clustering, fuzzy match, stop-word
 * removal, or LLM assertion of equivalence. Negation, numbers and questions
 * remain significant. Different wording stays unconfirmed until evidenced.
 */
export function familyStoryKey(title: string): string {
  return title.normalize('NFKC').trim()
    .replace(/\s+(?:[-–—|])\s+(?:AP(?: News)?|Associated Press|Reuters|(?:The )?Washington Post|(?:The )?New York Times|BBC(?: News)?)\s*$/i, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .toLocaleLowerCase('en-US');
}

function isRecent(item: NewsItem, now: number): boolean {
  const timestamp = effectivePubDateMs(item);
  return Number.isFinite(now) && Number.isFinite(timestamp) && timestamp > 0
    && timestamp <= now && now - timestamp <= FAMILY_FACTS_WINDOW_MS;
}

/** Build once for a news snapshot, then use for both flat and clustered rows. */
export function createStoryAssessor(corpus: readonly NewsItem[], now = Date.now()): (item: NewsItem) => StoryAssessment {
  const byHeadline = new Map<string, NewsItem[]>();
  for (const item of corpus) {
    if (!isRecent(item, now)) continue;
    const key = familyStoryKey(item.title);
    if (!key) continue;
    const group = byHeadline.get(key);
    if (group) group.push(item);
    else byHeadline.set(key, [item]);
  }
  const memo = new Map<NewsItem, StoryAssessment>();
  return (item) => {
    const previous = memo.get(item);
    if (previous) return previous;
    const direct = sourceFor(item, FAMILY_OFFICIAL_SOURCES);
    let result: StoryAssessment;
    if (direct) {
      result = {
        tier: 'Confirmed',
        reason: `Published directly by ${direct.name}. This confirms what the source said, not every inference about it.`,
        sources: [direct],
      };
    } else {
      const matches = isRecent(item, now) ? byHeadline.get(familyStoryKey(item.title)) ?? [] : [];
      const official = matches.map((candidate) => sourceFor(candidate, FAMILY_OFFICIAL_SOURCES))
        .find((source): source is StorySource => source !== null);
      const publishers = new Map<string, StorySource>();
      for (const candidate of [...matches, ...(isRecent(item, now) ? [item] : [])]) {
        const source = sourceFor(candidate, FAMILY_CREDIBLE_PUBLISHERS);
        if (source && !publishers.has(source.name)) publishers.set(source.name, source);
      }
      result = official ? {
        tier: 'Confirmed',
        reason: `The same headline is published directly by ${official.name}.`,
        sources: [official],
      } : publishers.size >= 2 ? {
        tier: 'Credible',
        reason: 'The same headline appears at two or more of AP, Reuters, The Washington Post, The New York Times and BBC within the last six hours.',
        sources: [...publishers.values()],
      } : {
        tier: 'Unconfirmed',
        reason: 'No matching official statement or two-outlet confirmation in the loaded reports. This does not mean the claim is false.',
        sources: [...publishers.values()],
      };
    }
    memo.set(item, result);
    return result;
  };
}

export function assessStory(item: NewsItem, corpus: readonly NewsItem[], now = Date.now()): StoryAssessment {
  return createStoryAssessor(corpus, now)(item);
}

// Fail closed for denials, predictions, drills and resolved/historical events.
// This is a deliberately narrow headline filter, not a cause or impact model.
const NON_CURRENT_DISRUPTION = /\b(?:no|not|never|denies?|denied|deny|false|fake|hoax|rumou?rs?|unconfirmed|alleged(?:ly)?|claims?|could|may|might|would|if|risk|risks|threat|threats|warns?|warning|warnings|plans?|planned|scheduled|drill|drills|test|tests|testing|simulation|exercise|resolved|restored|restores|resumed|resumes|ended|ends|recovered|recovery|averted|avoided|prevented|reopens?|reopened|yesterday|previously|past|historical|history|anniversary)\b|\?|\blast\s+(?:week|month|year)\b|\byears?\s+ago\b/i;
const RETROSPECTIVE_OR_RECOVERY = /\b(?:19\d{2}|20\d{2}|explains?|review|reviews|report\s+on|lessons?|retrospective|normally|normal\s+operations|back\s+(?:online|up)|following|after|ruled\s+out|was|were|had|caused|disrupted|halted\s+by)\b/i;
const DOMAIN_TERMS: readonly [DisruptionDomain, RegExp][] = [
  ['aviation', /\b(?:aviation|airports?|airlines?|flights?|air\s+traffic|FAA)\b/i],
  ['finance', /\b(?:banks?|banking|payments?|ATMs?|trading|stock\s+exchange|financial\s+services)\b/i],
  ['telecom', /\b(?:telecom|telecommunications|internet|broadband|mobile\s+(?:network|service)|cellular|phone\s+service)\b/i],
  ['cyber', /\b(?:cyberattack|cyber\s+attack|ransomware|DDoS|malware)\b/i],
  ['power', /\b(?:power|electricity|electric\s+grid|electrical\s+grid|blackouts?)\b/i],
];

// Require the headline to assert a disruption of the service itself, not merely
// mention an outage somewhere in a government report or a company's announcement.
const CURRENT_DISRUPTION: Readonly<Record<DisruptionDomain, RegExp>> = {
  aviation: /^(?:(?:flights?|air\s+traffic)\s+(?:(?:are|is|remain|remains|currently)\s+){0,2}(?:grounded|halted|suspended|disrupted)\b|(?:aviation|airports?|air\s+traffic(?:\s+control)?)\s+(?:outage|disruption|shutdown)\b)/i,
  finance: /^(?:banking|banks?|payments?(?:\s+processing)?|ATMs?|trading|financial\s+services)(?:\s+(?:service|services|system|systems|network))?\s+(?:outage|disruption|shutdown|(?:is|are|remain|remains)\s+(?:unavailable|offline|disrupted|suspended))\b/i,
  telecom: /^(?:internet|broadband|telecom|telecommunications|mobile\s+(?:network|service)|cellular|phone\s+service)(?:\s+(?:service|services|network))?\s+(?:outage|disruption|shutdown|(?:is|are|remain|remains)\s+(?:unavailable|offline|disrupted))\b/i,
  cyber: /^(?:ransomware|cyberattack|cyber\s+attack|DDoS|malware)(?:\s+attack)?\s+(?:disrupts|halts|shuts\s+down)\b/i,
  power: /^(?:power|electricity|electric\s+grid|electrical\s+grid)(?:\s+supply)?\s+(?:outage|blackout|disruption|(?:is|remains)\s+(?:unavailable|disrupted))\b/i,
};

/** Ambiguous multi-domain headlines cannot supply a domain to an alert. */
export function familyDisruptionDomain(title: string): DisruptionDomain | null {
  if (NON_CURRENT_DISRUPTION.test(title) || RETROSPECTIVE_OR_RECOVERY.test(title)) return null;
  if (/\b(?:postmortem|post-mortem|investigations?|investigates?|prevention|preparedness|contingency|training|anniversar(?:y|ies))\b/i.test(title)) return null;
  // Corporate finances, crime enforcement and policy actions are not outages.
  if (/\b(?:shares?|stocks?|profits?|earnings|dividends?|arrests?|arrested|seized|seizes|dismantles?|takedown|criminal|gang|policy|policies|legislation)\b/i.test(title)) return null;
  const domains = DOMAIN_TERMS.filter(([, pattern]) => pattern.test(title)).map(([domain]) => domain);
  if (domains.length !== 1) return null;
  const domain = domains[0]!;
  const statement = title.trim().replace(/^ongoing\s+/i, '');
  return CURRENT_DISRUPTION[domain].test(statement) ? domain : null;
}

export function buildFamilyBrief(corpus: readonly NewsItem[], now = Date.now()): FamilyBrief {
  const assess = createStoryAssessor(corpus, now);
  const seen = new Set<string>();
  const verified: FamilyBriefItem[] = [];
  const disruptions: FamilyBriefItem[] = [];
  const domains = new Set<DisruptionDomain>();
  const recent = corpus.filter((item) => isRecent(item, now))
    .sort((a, b) => effectivePubDateMs(b) - effectivePubDateMs(a));
  for (const item of recent) {
    const key = familyStoryKey(item.title);
    if (!key || seen.has(key)) continue;
    const assessment = assess(item);
    if (assessment.tier === 'Unconfirmed') continue;
    seen.add(key);
    const entry = { title: item.title, assessment };
    verified.push(entry);
    const domain = familyDisruptionDomain(item.title);
    if (domain) {
      domains.add(domain);
      disruptions.push(entry);
    }
  }
  return {
    items: verified.slice(0, 5),
    pattern: domains.size >= 2 && disruptions.length >= 2
      ? { domains: [...domains], items: disruptions }
      : null,
  };
}
