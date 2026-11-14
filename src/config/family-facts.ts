import type { FamilySourcePolicy } from '@/types/family-facts';

export const FAMILY_FACTS_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Explicit first-party endpoints. A name in a headline is never authority. */
export const FAMILY_OFFICIAL_SOURCES: readonly FamilySourcePolicy[] = [
  { name: 'FAA', feedNames: ['FAA'], hosts: ['faa.gov'], includeSubdomains: true },
  { name: 'DHS', feedNames: ['DHS'], hosts: ['dhs.gov'], includeSubdomains: true },
  { name: 'FBI', feedNames: ['FBI'], hosts: ['fbi.gov'], includeSubdomains: true },
  { name: 'CISA', feedNames: ['CISA'], hosts: ['cisa.gov'], includeSubdomains: true },
  { name: 'Cloudflare Status', feedNames: ['Cloudflare Status'], hosts: ['www.cloudflarestatus.com', 'cloudflarestatus.com'] },
  { name: 'AWS Health', feedNames: ['AWS Health'], hosts: ['health.aws.amazon.com', 'status.aws.amazon.com'] },
  { name: 'Azure Status', feedNames: ['Azure Status'], hosts: ['azure.status.microsoft', 'status.azure.com'] },
  { name: 'Google Cloud Status', feedNames: ['Google Cloud Status'], hosts: ['status.cloud.google.com'] },
  { name: 'GitHub Status', feedNames: ['GitHub Status'], hosts: ['www.githubstatus.com', 'githubstatus.com'] },
  { name: 'Stripe Status', feedNames: ['Stripe Status'], hosts: ['status.stripe.com'] },
];

/** Multiple editions or domains of one publisher still count as one source. */
export const FAMILY_CREDIBLE_PUBLISHERS: readonly FamilySourcePolicy[] = [
  { name: 'AP', feedNames: ['AP News', 'AP Mexico'], hosts: ['apnews.com'], includeSubdomains: true },
  { name: 'Reuters', feedNames: ['Reuters World', 'Reuters US', 'Reuters Business', 'Reuters Asia', 'Reuters India', 'Reuters Energy', 'Reuters Science', 'Reuters Crypto', 'Reuters Commodities', 'Reuters LatAm', 'Reuters Markets', 'Reuters Nasdaq Futures'], hosts: ['reuters.com'], includeSubdomains: true },
  { name: 'The Washington Post', feedNames: ['Washington Post World'], hosts: ['washingtonpost.com'], includeSubdomains: true },
  { name: 'The New York Times', feedNames: ['New York Times World'], hosts: ['nytimes.com'], includeSubdomains: true },
  { name: 'BBC', feedNames: ['BBC World', 'BBC UK', 'BBC Northern Ireland', 'BBC Middle East', 'BBC Persian', 'BBC Africa', 'BBC Latin America', 'BBC Asia', 'BBC Hindi', 'BBC Science', 'BBC Mundo', 'BBC Turkce', 'BBC Russian', 'BBC Afrique'], hosts: ['bbc.com', 'bbc.co.uk'], includeSubdomains: true },
];
