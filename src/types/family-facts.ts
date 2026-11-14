export type StoryConfidence = 'Confirmed' | 'Credible' | 'Unconfirmed';

export type DisruptionDomain = 'aviation' | 'finance' | 'telecom' | 'cyber' | 'power';

export interface StorySource {
  name: string;
  url: string;
}

export interface StoryAssessment {
  tier: StoryConfidence;
  reason: string;
  sources: StorySource[];
}

export interface FamilyBriefItem {
  title: string;
  assessment: StoryAssessment;
}

export interface FamilyPattern {
  domains: DisruptionDomain[];
  items: FamilyBriefItem[];
}

export interface FamilyBrief {
  items: FamilyBriefItem[];
  pattern: FamilyPattern | null;
}

export interface FamilySourcePolicy {
  name: string;
  /** Exact canonical feed names; an aggregator linking this host is not evidence. */
  feedNames: readonly string[];
  hosts: readonly string[];
  /** Agency hosts include their subdomains; company status hosts are exact. */
  includeSubdomains?: boolean;
}
