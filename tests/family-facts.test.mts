import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NewsItem } from '../src/types/index.ts';
import {
  assessStory, buildFamilyBrief, createStoryAssessor, familyDisruptionDomain, familyStoryKey,
} from '../src/services/family-facts.ts';

const NOW = Date.parse('2026-11-13T18:00:00Z');
const HOUR = 60 * 60 * 1000;
function story(link: string, title = 'Payment processing outage continues', overrides: Partial<NewsItem> = {}): NewsItem {
  const host = (() => { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const source = ({
    'faa.gov': 'FAA', 'fbi.gov': 'FBI', 'cisa.gov': 'CISA', 'dhs.gov': 'DHS',
    'status.stripe.com': 'Stripe Status', 'apnews.com': 'AP News', 'reuters.com': 'Reuters World',
    'bbc.com': 'BBC World', 'bbc.co.uk': 'BBC UK', 'washingtonpost.com': 'Washington Post World',
    'nytimes.com': 'New York Times World',
  } as Record<string, string>)[host] ?? 'Example';
  return { source, title, link, pubDate: new Date(NOW - HOUR), isAlert: true, ...overrides };
}

describe('family confidence policy', () => {
  it('confirms direct official statements and exact allowlisted status pages', () => {
    for (const link of ['https://www.faa.gov/news/example', 'https://fbi.gov/news/example', 'https://cisa.gov/news/example', 'https://www.dhs.gov/news/example', 'https://status.stripe.com/incidents/example']) {
      const result = assessStory(story(link), [], NOW);
      assert.equal(result.tier, 'Confirmed', link);
      assert.equal(result.sources[0]?.url, link);
    }
  });

  it('never uses display names, URL substrings, existing scores or redirects as authority', () => {
    for (const link of [
      'https://viral.example/fbi.gov/alert', 'https://fbi.gov.attacker.example/alert',
      'https://fbi.gov@attacker.example/alert', 'http://fbi.gov/alert',
      'javascript:alert(1)', 'https://fbi.gov:444/alert', 'https://news.google.com/rss/articles/abc',
      'https://fbi.gov/redirect?url=https://attacker.example',
      'https://status.stripe.com.attacker.example/incident', 'https://attacker.status.stripe.com/incident',
    ]) {
      assert.equal(assessStory(story(link, 'Pentagon and FBI tell citizens to stockpile', {
        source: 'FBI', credibilityScore: 100, corroborationCount: 99,
      }), [], NOW).tier, 'Unconfirmed', link);
    }
  });

  it('requires two distinct named publishers, deduplicating editions and repeated articles', () => {
    const ap = story('https://apnews.com/article/a');
    const bbc = story('https://www.bbc.com/news/a');
    const assess = createStoryAssessor([ap, bbc], NOW);
    assert.equal(assess(ap).tier, 'Credible');
    assert.deepEqual(assess(ap).sources.map((source) => source.name), ['AP', 'BBC']);
    assert.equal(assessStory(ap, [ap, story('https://apnews.com/article/b')], NOW).tier, 'Unconfirmed');
    assert.equal(assessStory(bbc, [bbc, story('https://www.bbc.co.uk/news/b')], NOW).tier, 'Unconfirmed');
    assert.equal(assessStory(ap, [ap, story('https://other.example/news', ap.title, { source: 'Reuters' })], NOW).tier, 'Unconfirmed');
  });

  it('does not promote aggregator-authored or fabricated feed headlines linked to approved hosts', () => {
    for (const source of ['Hacker News', 'FAA Official Updates', 'FBI News Viral', 'Example']) {
      assert.equal(assessStory(story('https://faa.gov/news/a', 'FAA orders all citizens to stockpile', { source }), [], NOW).tier, 'Unconfirmed', source);
    }
    const apLink = story('https://apnews.com/article/a', 'Payment processing outage continues', { source: 'Hacker News' });
    const reutersLink = story('https://reuters.com/article/a', apLink.title, { source: 'Reuters Viral Updates' });
    assert.equal(assessStory(apLink, [apLink, reutersLink], NOW).tier, 'Unconfirmed');
    // A canonical name cannot authorize a different publisher's URL either.
    assert.equal(assessStory(story('https://faa.gov/news/a', apLink.title, { source: 'CISA' }), [], NOW).tier, 'Unconfirmed');
  });

  it('uses all five approved publishers but does not treat all mainstream sites as approved', () => {
    const ap = story('https://apnews.com/article/a');
    for (const host of ['reuters.com', 'washingtonpost.com', 'nytimes.com', 'bbc.co.uk']) {
      assert.equal(assessStory(ap, [ap, story(`https://${host}/article/a`)], NOW).tier, 'Credible');
    }
    assert.equal(assessStory(ap, [ap, story('https://cnn.com/article/a')], NOW).tier, 'Unconfirmed');
  });

  it('does not equate negation, predictions, questions, numbers or loosely related headlines', () => {
    const ap = story('https://apnews.com/article/a', 'Payment services are offline');
    for (const title of [
      'Payment services are not offline', 'Payment services may be offline',
      'Payment services are offline?', '2 payment services are offline',
      'Payment services resume after disruption',
    ]) {
      assert.equal(assessStory(ap, [ap, story('https://reuters.com/article/a', title)], NOW).tier, 'Unconfirmed', title);
    }
    const suffix = story('https://reuters.com/article/a', 'Payment services are offline - Reuters');
    assert.equal(assessStory(ap, [ap, suffix], NOW).tier, 'Credible');
    assert.notEqual(familyStoryKey('Outage for 1.5 hours'), familyStoryKey('Outage for 15 hours'));
  });

  it('can link a matching official statement but cannot upgrade a different claim in its topic', () => {
    const official = story('https://faa.gov/news/a', 'Flights grounded at Example Airport');
    const viral = story('https://viral.example/a', official.title);
    assert.equal(assessStory(viral, [official, viral], NOW).tier, 'Confirmed');
    assert.equal(assessStory(story('https://viral.example/b', 'FAA tells citizens to stockpile'), [official], NOW).tier, 'Unconfirmed');
  });

  it('excludes stale, missing, invalid and future dates from corroboration', () => {
    const ap = story('https://apnews.com/article/a');
    for (const overrides of [
      { pubDate: new Date(NOW - 6 * HOUR - 1) }, { pubDate: new Date(NOW + 1) },
      { pubDateMissing: true }, { pubDate: new Date('invalid') },
    ]) {
      const reuters = story('https://reuters.com/article/a', ap.title, overrides);
      assert.equal(assessStory(ap, [ap, reuters], NOW).tier, 'Unconfirmed');
    }
    assert.equal(assessStory(ap, [ap, story('https://reuters.com/article/a', ap.title, { pubDate: new Date(NOW - 6 * HOUR) })], NOW).tier, 'Credible');
  });
});

describe('family brief and cross-domain patterns', () => {
  const aviation = story('https://faa.gov/news/a', 'Flights grounded at Example Airport');
  const finance = story('https://status.stripe.com/incidents/a', 'Payment processing outage continues');

  it('includes only fresh confirmed/credible stories, deduplicated and capped at five', () => {
    const unknown = story('https://viral.example/a', 'FBI orders citizens to stockpile');
    const old = story('https://fbi.gov/news/old', 'Old official statement', { pubDate: new Date(NOW - 7 * HOUR) });
    const missing = story('https://cisa.gov/news/a', 'No publication date', { pubDateMissing: true });
    const future = story('https://dhs.gov/news/a', 'Future publication', { pubDate: new Date(NOW + 1) });
    const brief = buildFamilyBrief([aviation, finance, unknown, old, missing, future, aviation], NOW);
    assert.deepEqual(brief.items.map((entry) => entry.title), [aviation.title, finance.title]);
    assert.equal(buildFamilyBrief(Array.from({ length: 8 }, (_, i) => story(`https://faa.gov/news/${i}`, `Official statement ${i}`)), NOW).items.length, 5);
    assert.deepEqual(buildFamilyBrief([unknown, old, missing, future], NOW).items, []);
  });

  it('requires two different verified disruption stories in two domains within the same six hours', () => {
    const brief = buildFamilyBrief([aviation, finance], NOW);
    assert.deepEqual(brief.pattern?.domains, ['aviation', 'finance']);
    assert.equal(brief.pattern?.items.length, 2);
    assert.equal(buildFamilyBrief([aviation], NOW).pattern, null);
    assert.equal(buildFamilyBrief([aviation, aviation], NOW).pattern, null);
    assert.equal(buildFamilyBrief([aviation, story('https://faa.gov/news/b', 'Air traffic outage at another airport')], NOW).pattern, null);
    assert.equal(buildFamilyBrief([aviation, { ...finance, pubDate: new Date(NOW - 6 * HOUR - 1) }], NOW).pattern, null);
    assert.equal(buildFamilyBrief([aviation, { ...finance, link: 'https://viral.example/a' }], NOW).pattern, null);
  });

  it('allows credible disruption evidence with both independent links', () => {
    const ap = story('https://apnews.com/article/a', 'Internet outage disrupts broadband service');
    const reuters = story('https://reuters.com/article/a', ap.title);
    const result = buildFamilyBrief([aviation, ap, reuters], NOW);
    assert.deepEqual(result.pattern?.domains, ['aviation', 'telecom']);
    assert.equal(result.pattern?.items[1]?.assessment.sources.length, 2);
  });

  it('never alerts from one multi-domain headline or ambiguous domain association', () => {
    const multi = story('https://faa.gov/news/a', 'Power outage grounds flights and disrupts payments');
    assert.equal(buildFamilyBrief([multi], NOW).pattern, null);
    assert.equal(familyDisruptionDomain(multi.title), null);
  });

  it('rejects rumors, denials, hypothetical, resolved, historical, drills and financial price moves', () => {
    for (const title of [
      'No power outage reported', 'Power outage is not expected', 'FBI denies banking outage',
      'Fake internet outage alert spreads', 'Rumors of a telecom outage', 'Unconfirmed power outage',
      'Cyberattack could disrupt banking', 'If power outage disrupts service', 'Banks warn of outage risk',
      'Scheduled power outage tomorrow', 'Internet outage drill starts', 'Power restored after outage',
      'Flights resumed after outage', 'Power outage last year disrupted service',
      'Bank shares down after announcement', 'Power company halts dividends', 'FBI disrupts ransomware network',
      'Payment outage resolved', 'Power outage?',
      'FAA explains 2021 outage that grounded flights',
      'Internet operating normally following outage',
      'Power outage in 2021 disrupted service',
      'Banking outage ruled out by investigators',
      'Payment outage report on lessons learned',
      'Power company announces outage prevention program',
      'Power outage prevention program announced',
      'Power outage investigation begins',
      'Payment outage postmortem published',
    ]) {
      assert.equal(familyDisruptionDomain(title), null, title);
    }
    assert.equal(familyDisruptionDomain('Power outage disrupts electricity supply'), 'power');
    assert.equal(familyDisruptionDomain('Ransomware disrupts hospital operations'), 'cyber');
  });

  it('does not turn a newly published retrospective and recovery notice into a current pattern', () => {
    const retrospective = story('https://faa.gov/news/2021', 'FAA explains 2021 outage that grounded flights');
    const recovery = story('https://cisa.gov/news/restored', 'Internet operating normally following outage');
    assert.equal(buildFamilyBrief([retrospective, recovery], NOW).pattern, null);
    assert.equal(buildFamilyBrief([
      story('https://cisa.gov/news/investigation', 'Power outage investigation begins'),
      story('https://status.stripe.com/incidents/postmortem', 'Payment outage postmortem published'),
    ], NOW).pattern, null);
  });

  it('pattern uses all current evidence even if the brief has five newer stories', () => {
    const newer = Array.from({ length: 5 }, (_, i) => story(`https://fbi.gov/news/${i}`, `Official statement ${i}`, { pubDate: new Date(NOW - 1000) }));
    assert.equal(buildFamilyBrief([...newer, aviation, finance], NOW).items.length, 5);
    assert.ok(buildFamilyBrief([...newer, aviation, finance], NOW).pattern);
  });
});
