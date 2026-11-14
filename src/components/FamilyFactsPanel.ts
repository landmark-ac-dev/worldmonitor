import { Panel } from './Panel';
import type { NewsItem } from '@/types';
import { buildFamilyBrief } from '@/services/family-facts';
import type { StoryAssessment } from '@/types/family-facts';
import { createCopyPasteCheck } from './news/CopyPasteCheck';
import { createStoryConfidenceBadge } from './news/confidence-label';

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function evidenceLine(title: string, assessment: StoryAssessment): HTMLLIElement {
  const line = document.createElement('li');
  const badge = createStoryConfidenceBadge(assessment);
  line.append(badge, document.createTextNode(` ${title} `));
  const sources = document.createElement('span');
  sources.className = 'family-facts-sources';
  assessment.sources.forEach((source, index) => {
    if (index > 0) sources.append(document.createTextNode(' · '));
    const link = document.createElement('a');
    link.href = source.url; // evaluator returns only reviewed HTTPS source URLs
    link.textContent = source.name;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    sources.append(link);
  });
  line.append(sources);
  return line;
}

/** A deterministic, source-linked brief. No model-generated claims or automatic social monitoring. */
export class FamilyFactsPanel extends Panel {
  private readonly brief = document.createElement('div');
  private readonly pattern = document.createElement('div');
  private readonly coverage = paragraph('Waiting for the selected news feeds.', 'family-facts-coverage');
  private readonly refreshTimer: ReturnType<typeof setInterval>;
  private news: readonly NewsItem[] = [];
  private _hasData = false;
  private degraded = false;

  constructor() {
    super({ id: 'family-facts', title: "What's actually true", defaultRowSpan: 2, className: 'panel-wide' });
    this.brief.className = 'family-facts-brief';
    this.pattern.className = 'family-facts-pattern';
    this.pattern.setAttribute('role', 'status');
    this.pattern.setAttribute('aria-live', 'polite');

    const policy = document.createElement('details');
    policy.className = 'family-facts-policy';
    const summary = document.createElement('summary');
    summary.textContent = 'How these labels work';
    policy.append(summary, paragraph(
      'Confirmed: a linked official publication. Credible: matching reports from at least two of AP, Reuters, The Washington Post, The New York Times and BBC. Unconfirmed: the loaded reports do not meet either rule; this does not mean the claim is false.',
    ), paragraph(
      'The brief uses source headlines, without adding claims. Matching is conservative: differently worded reports may stay Unconfirmed. Only reports with known publication times in the past six hours enter this brief. Coverage depends on your selected feeds.',
    ), paragraph(
      'Pattern alerts require separate disruption reports in at least two of aviation, banking/finance, telecom, cyber and power. Reports appearing together do not establish a shared cause. A lack of alerts is not an all-clear.',
    ));
    this.setContentNodes(this.coverage, this.brief, this.pattern, policy, createCopyPasteCheck());
    // Expire evidence even if a feed refresh fails or the app remains open overnight.
    this.refreshTimer = setInterval(() => this.fetchData(), 60_000);
  }

  public updateNews(news: readonly NewsItem[], degraded = false): void {
    this.news = news;
    this._hasData = true;
    this.degraded = degraded;
    this.fetchData();
  }

  public fetchData(): void {
    if (!this._hasData) return;
    const brief = buildFamilyBrief(this.news);
    this.coverage.textContent = this.degraded
      ? 'Some feeds could not refresh. Only dated reports from the past six hours are shown.'
      : 'Past six hours · Based on the news feeds loaded in this dashboard.';
    const list = document.createElement('ul');
    list.className = 'family-facts-lines';
    for (const item of brief.items) list.append(evidenceLine(item.title, item.assessment));
    this.brief.replaceChildren(brief.items.length > 0 ? list : paragraph(
      'No current reports meet these evidence rules in the loaded feeds. This does not establish that nothing is happening.',
    ));
    if (brief.items.length > 0 && brief.items.length < 3) {
      this.brief.append(paragraph('Fewer than three qualifying reports are available; no extra claims have been added.', 'family-facts-coverage'));
    }
    if (brief.pattern) {
      const heading = document.createElement('h3');
      heading.textContent = 'Pattern alert';
      const evidence = document.createElement('ul');
      for (const item of brief.pattern.items) evidence.append(evidenceLine(item.title, item.assessment));
      this.pattern.replaceChildren(heading, paragraph(
        `Separate disruption reports cover ${brief.pattern.domains.join(' and ')} within six hours. A common cause has not been established.`,
      ), evidence);
      this.pattern.dataset.alert = 'true';
    } else {
      this.pattern.replaceChildren(paragraph('No qualifying disruption pattern in the loaded reports. A single headline never triggers this alert.'));
      this.pattern.dataset.alert = 'false';
    }
  }

  public destroy(): void {
    clearInterval(this.refreshTimer);
    super.destroy();
  }
}
