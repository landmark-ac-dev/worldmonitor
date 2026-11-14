import type { StoryAssessment } from '@/types/family-facts';
import { escapeHtml } from '@/utils/sanitize';

/** The family confidence policy is separate from the legacy numeric source score. */
export function renderStoryConfidence(assessment: StoryAssessment): string {
  return `<span class="story-confidence confidence-${assessment.tier.toLowerCase()}" title="${escapeHtml(assessment.reason)}">${assessment.tier}</span>`;
}

export function createStoryConfidenceBadge(assessment: StoryAssessment): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = `story-confidence confidence-${assessment.tier.toLowerCase()}`;
  badge.textContent = assessment.tier;
  badge.title = assessment.reason;
  return badge;
}

export const UNCONFIRMED_SOCIAL_ASSESSMENT: StoryAssessment = {
  tier: 'Unconfirmed',
  reason: 'This social post has no matched official publication or two-outlet evidence. A curated account or a quoted link does not verify its claims.',
  sources: [],
};
