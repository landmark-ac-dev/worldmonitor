import type { StoryAssessment } from '@/types/family-facts';
import { escapeHtml } from '@/utils/sanitize';

const CONFIDENCE_PATHS = {
  Confirmed: 'M3 8l3 3 7-7',
  Credible: 'M8 2l6 6-6 6-6-6zM5 8h6',
  Unconfirmed: 'M5 5a3 3 0 0 1 6 0c0 2-3 2-3 4M8 12v1',
} as const;

function iconHtml(assessment: StoryAssessment): string {
  return `<svg class="confidence-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="${CONFIDENCE_PATHS[assessment.tier]}"/></svg>`;
}

/** The family confidence policy is separate from the legacy numeric source score. */
export function renderStoryConfidence(assessment: StoryAssessment): string {
  return `<span class="story-confidence confidence-${assessment.tier.toLowerCase()}" title="${escapeHtml(assessment.reason)}">${iconHtml(assessment)}${assessment.tier}</span>`;
}

export function createStoryConfidenceBadge(assessment: StoryAssessment): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = `story-confidence confidence-${assessment.tier.toLowerCase()}`;
  badge.textContent = assessment.tier;
  badge.title = assessment.reason;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'confidence-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', CONFIDENCE_PATHS[assessment.tier]);
  svg.append(path);
  badge.prepend(svg);
  return badge;
}

export const UNCONFIRMED_SOCIAL_ASSESSMENT: StoryAssessment = {
  tier: 'Unconfirmed',
  reason: 'This social post has no matched official publication or two-outlet evidence. A curated account or a quoted link does not verify its claims.',
  sources: [],
};
