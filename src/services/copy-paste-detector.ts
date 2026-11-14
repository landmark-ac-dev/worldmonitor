/** Local analysis of user-supplied public posts. No collection, network or persistence. */
export const COPY_PASTE_LIMITS = {
  posts: 500,
  inputCharacters: 2_500_000,
  textCharacters: 4_000,
  accounts: 5,
  windowMs: 30 * 60 * 1_000,
  newAccountMs: 30 * 24 * 60 * 60 * 1_000,
  followers: 100,
  similarity: 0.9,
  minimumWords: 12,
} as const;

export interface CopyPastePost {
  platform: string;
  accountId: string;
  text: string;
  postedAt: number;
  accountCreatedAt?: number;
  followers?: number;
  url?: string;
}

export type CopyPasteInput = { ok: true; posts: CopyPastePost[] } | { ok: false; error: string };

function timestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year!, month! - 1, day!));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month! - 1 || calendar.getUTCDate() !== day) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function safePostUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Validate the entire batch, without silently dropping bad rows or guessing missing profile data. */
export function parseCopyPasteInput(input: string, now = Date.now()): CopyPasteInput {
  if (!Number.isFinite(now) || now <= 0) return { ok: false, error: 'The current time is unavailable.' };
  if (input.length > COPY_PASTE_LIMITS.inputCharacters) return { ok: false, error: 'Input is too large. Paste at most 500 posts with text up to 4,000 characters each.' };
  let rows: unknown;
  try { rows = JSON.parse(input); } catch { return { ok: false, error: 'Paste a valid JSON array. Use the example below for its format.' }; }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > COPY_PASTE_LIMITS.posts) {
    return { ok: false, error: 'Paste an array containing between 1 and 500 posts.' };
  }
  const posts: CopyPastePost[] = [];
  for (const [index, row] of rows.entries()) {
    const fail = (message: string): CopyPasteInput => ({ ok: false, error: `Post ${index + 1}: ${message}` });
    if (!row || typeof row !== 'object' || Array.isArray(row)) return fail('expected an object.');
    for (const key of ['platform', 'accountId', 'text'] as const) {
      if (typeof row[key] !== 'string' || !row[key].trim()) return fail(`${key} must be nonempty text.`);
      if (row[key].length > (key === 'text' ? COPY_PASTE_LIMITS.textCharacters : 100)) return fail(`${key} is too long.`);
    }
    const postedAt = timestamp(row.postedAt);
    if (postedAt === null || postedAt > now) return fail('postedAt must be a past ISO timestamp with a time zone, or epoch milliseconds.');
    const accountCreatedAt = row.accountCreatedAt == null ? undefined : timestamp(row.accountCreatedAt);
    if (accountCreatedAt === null || (accountCreatedAt !== undefined && accountCreatedAt > postedAt)) {
      return fail('accountCreatedAt must be a valid timestamp no later than the post. Omit it if unknown.');
    }
    const followers = row.followers == null ? undefined : row.followers;
    if (followers !== undefined && (!Number.isSafeInteger(followers) || followers < 0)) return fail('followers must be a nonnegative integer. Omit it if unknown.');
    if (row.url !== undefined && (typeof row.url !== 'string' || row.url.length > 2_048 || !safePostUrl(row.url))) {
      return fail('url must be an http(s) link without credentials, or omitted.');
    }
    posts.push({
      platform: row.platform.trim().toLowerCase(), accountId: row.accountId.trim(), text: row.text.trim(), postedAt,
      ...(accountCreatedAt === undefined ? {} : { accountCreatedAt }),
      ...(followers === undefined ? {} : { followers }),
      ...(row.url === undefined ? {} : { url: safePostUrl(row.url)! }),
    });
  }
  return { ok: true, posts };
}

type ProfileState = 'qualifies' | 'unassessed' | 'established';

function profileState(post: CopyPastePost): ProfileState {
  if ((post.accountCreatedAt !== undefined && post.postedAt - post.accountCreatedAt <= COPY_PASTE_LIMITS.newAccountMs)
    || (post.followers !== undefined && post.followers < COPY_PASTE_LIMITS.followers)) return 'qualifies';
  return post.accountCreatedAt === undefined || post.followers === undefined ? 'unassessed' : 'established';
}

function shingles(text: string): Set<string> | null {
  const words = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < COPY_PASTE_LIMITS.minimumWords) return null;
  const result = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) result.add(words.slice(i, i + 3).join(' '));
  return result;
}

function similar(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const shingle of a) if (b.has(shingle)) shared++;
  return shared / (a.size + b.size - shared) >= COPY_PASTE_LIMITS.similarity;
}

export interface CopyPasteFlag {
  posts: CopyPastePost[];
  accountCount: number;
  firstPostedAt: number;
  lastPostedAt: number;
}

export interface CopyPasteResult {
  flags: CopyPasteFlag[];
  postCount: number;
  unassessedPosts: number;
  qualifyingPosts: number;
  shortPosts: number;
}

/**
 * Conservative, disjoint groups: every member must resemble every other member
 * and fit one bounded time window. Neither text nor time can chain across groups.
 * Callers use parseCopyPasteInput first; known profile data is required to qualify.
 */
export function detectCopyPaste(posts: readonly CopyPastePost[]): CopyPasteResult {
  const result: CopyPasteResult = { flags: [], postCount: posts.length, unassessedPosts: 0, qualifyingPosts: 0, shortPosts: 0 };
  const eligible: Array<{ post: CopyPastePost; key: string; copy: Set<string> }> = [];
  for (const post of posts) {
    const state = profileState(post);
    if (state === 'unassessed') result.unassessedPosts++;
    if (state !== 'qualifies') continue;
    result.qualifyingPosts++;
    const copy = shingles(post.text);
    if (!copy) { result.shortPosts++; continue; }
    eligible.push({ post, key: JSON.stringify([post.platform, post.accountId]), copy });
  }
  eligible.sort((a, b) => a.post.postedAt - b.post.postedAt || a.key.localeCompare(b.key));
  const used = new Set<number>();
  const comparisons = new Map<number, boolean>();
  const matches = (a: number, b: number): boolean => {
    const key = Math.min(a, b) * COPY_PASTE_LIMITS.posts + Math.max(a, b);
    if (!comparisons.has(key)) comparisons.set(key, similar(eligible[a]!.copy, eligible[b]!.copy));
    return comparisons.get(key)!;
  };
  for (let i = 0; i < eligible.length; i++) {
    if (used.has(i)) continue;
    const first = eligible[i]!;
    const group = [i];
    const accounts = new Set([first.key]);
    for (let j = i + 1; j < eligible.length; j++) {
      const next = eligible[j]!;
      if (next.post.postedAt - first.post.postedAt > COPY_PASTE_LIMITS.windowMs) break;
      if (used.has(j) || accounts.has(next.key) || !group.every((member) => matches(member, j))) continue;
      group.push(j);
      accounts.add(next.key);
    }
    if (accounts.size < COPY_PASTE_LIMITS.accounts) continue;
    group.forEach((member) => used.add(member));
    const members = group.map((member) => eligible[member]!.post);
    // Repeated rows or reposts from these same accounts in this window cannot
    // produce another flag for the same copy.
    for (let j = i; j < eligible.length; j++) {
      const next = eligible[j]!;
      if (next.post.postedAt - first.post.postedAt > COPY_PASTE_LIMITS.windowMs) break;
      if (accounts.has(next.key) && matches(i, j)) used.add(j);
    }
    result.flags.push({ posts: members, accountCount: accounts.size, firstPostedAt: members[0]!.postedAt, lastPostedAt: members[members.length - 1]!.postedAt });
  }
  return result;
}
