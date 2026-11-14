import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { COPY_PASTE_LIMITS, detectCopyPaste, parseCopyPasteInput, safePostUrl, type CopyPastePost } from '../src/services/copy-paste-detector.ts';

const NOW = Date.parse('2026-11-13T18:00:00Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TEXT = 'The demonstration alert claims that the local service is unavailable and asks residents to check its official website before taking further action.';
const post = (id: string, overrides: Partial<CopyPastePost> = {}): CopyPastePost => ({
  platform: 'x', accountId: id, text: TEXT, postedAt: NOW - 10 * MINUTE, followers: 12, ...overrides,
});
const batch = (count: number, overrides: Partial<CopyPastePost> = {}): CopyPastePost[] =>
  Array.from({ length: count }, (_, i) => post(String(i), overrides));

describe('copy-paste input validation', () => {
  it('accepts explicit unknown metadata without inventing account age or follower count', () => {
    const parsed = parseCopyPasteInput(JSON.stringify([{ ...post('1'), followers: null, accountCreatedAt: null }]), NOW);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.posts[0]!.followers, undefined);
    assert.equal(parsed.posts[0]!.accountCreatedAt, undefined);
    assert.equal(detectCopyPaste(parsed.posts).unassessedPosts, 1);
  });

  it('accepts UTC and offset ISO timestamps, and normalizes platform names', () => {
    const parsed = parseCopyPasteInput(JSON.stringify([{ ...post('1'), platform: ' X ', postedAt: '2026-11-13T12:00:00-06:00' }]), NOW);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.posts[0]!.postedAt, NOW);
    assert.equal(parsed.posts[0]!.platform, 'x');
  });

  it('rejects malformed input with actionable row-specific errors', () => {
    for (const input of ['no JSON', '{}', '[]', '[null]', JSON.stringify(batch(501))]) assert.equal(parseCopyPasteInput(input, NOW).ok, false);
    for (const change of [
      { text: '' }, { text: 'x'.repeat(4_001) }, { platform: 42 }, { accountId: '' },
      { postedAt: NOW + 1 }, { postedAt: '2026-11-13T12:00:00' }, { postedAt: 'invalid' }, { postedAt: '2026-02-30T12:00:00Z' },
      { accountCreatedAt: NOW }, { accountCreatedAt: 'invalid' },
      { followers: -1 }, { followers: 1.5 }, { followers: '10' },
      { url: 'javascript:alert(1)' }, { url: 'https://user:secret@example.com/' },
    ]) {
      const parsed = parseCopyPasteInput(JSON.stringify([post('valid'), { ...post('invalid'), ...change }]), NOW);
      assert.equal(parsed.ok, false, JSON.stringify(change));
      if (!parsed.ok) assert.match(parsed.error, /^Post 2:/);
    }
  });

  it('rejects oversized input and accepts only safe external link schemes', () => {
    assert.equal(parseCopyPasteInput(' '.repeat(COPY_PASTE_LIMITS.inputCharacters + 1), NOW).ok, false);
    assert.equal(safePostUrl('javascript:alert(1)'), null);
    assert.equal(safePostUrl('//example.com/path'), null);
    assert.equal(safePostUrl('https://example.com/post/1'), 'https://example.com/post/1');
  });
});

describe('copy-paste groups', () => {
  it('flags five distinct low-follower accounts but never four', () => {
    assert.equal(detectCopyPaste(batch(4)).flags.length, 0);
    const result = detectCopyPaste(batch(5));
    assert.equal(result.flags.length, 1);
    assert.equal(result.flags[0]!.accountCount, 5);
  });

  it('accepts known young accounts regardless of followers and keeps unknown profiles unassessed', () => {
    const young = batch(5, { followers: 10_000, accountCreatedAt: NOW - DAY });
    assert.equal(detectCopyPaste(young).flags.length, 1);
    const unknown = batch(5, { followers: undefined, accountCreatedAt: undefined });
    assert.equal(detectCopyPaste(unknown).flags.length, 0);
    assert.equal(detectCopyPaste(unknown).unassessedPosts, 5);
    assert.equal(detectCopyPaste(batch(5, { followers: 100, accountCreatedAt: NOW - 90 * DAY })).flags.length, 0);
  });

  it('applies the 30-day boundary at posting time, not analysis time', () => {
    const postedAt = NOW - DAY;
    assert.equal(detectCopyPaste(batch(5, { postedAt, followers: 100, accountCreatedAt: postedAt - 30 * DAY })).flags.length, 1);
    assert.equal(detectCopyPaste(batch(5, { postedAt, followers: 100, accountCreatedAt: postedAt - 30 * DAY - 1 })).flags.length, 0);
  });

  it('counts one account once despite many reposts and namespaces accounts by platform', () => {
    const same = batch(20, { accountId: 'one-account' });
    assert.equal(detectCopyPaste(same).flags.length, 0);
    const distinct = Array.from({ length: 5 }, (_, i) => post('same-id', { platform: `platform-${i}` }));
    assert.equal(detectCopyPaste(distinct).flags[0]!.accountCount, 5);
    assert.equal(detectCopyPaste([...batch(5), ...batch(5)]).flags.length, 1);
    // Each flag represents five distinct accounts, never ten from duplicate rows.
    assert.ok(detectCopyPaste([...batch(5), ...batch(5)]).flags.every((flag) => flag.accountCount === 5));
  });

  it('finds a sliding window, includes its exact boundary, and does not time-chain', () => {
    const posts = batch(5).map((item, i) => ({ ...item, postedAt: NOW - (30 - i * 7.5) * MINUTE }));
    assert.equal(detectCopyPaste(posts).flags.length, 1);
    posts[0]!.postedAt--;
    assert.equal(detectCopyPaste(posts).flags.length, 0);
    const chained = batch(5).map((item, i) => ({ ...item, postedAt: NOW - i * 10 * MINUTE }));
    assert.equal(detectCopyPaste(chained).flags.length, 0);
    const oldOutlier = post('outlier', { postedAt: NOW - 2 * DAY });
    assert.equal(detectCopyPaste([oldOutlier, ...batch(5)]).flags.length, 1);
  });

  it('normalizes case and punctuation but requires substantial near-identical wording', () => {
    const posts = batch(5);
    posts[1]!.text = TEXT.toUpperCase().replaceAll(' ', '  ');
    posts[2]!.text = TEXT.replace('.', '!');
    assert.equal(detectCopyPaste(posts).flags.length, 1);
    assert.equal(detectCopyPaste(batch(5, { text: 'Please check the website.' })).flags.length, 0);
    assert.equal(detectCopyPaste(batch(5, { text: 'Please check the website.' })).shortPosts, 5);
    posts[2]!.text = 'This unrelated report describes a routine weather forecast with mild temperatures across the region and no unusual events expected today.';
    assert.equal(detectCopyPaste(posts).flags.length, 0);
  });

  it('does not connect different texts through a bridging near-match', () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`);
    const a = words.join(' ');
    const b = [...words.slice(0, -1), 'changedlast'].join(' ');
    const c = [...words.slice(0, -2), 'changedsecond', 'changedlast'].join(' ');
    const posts = [a, a, b, c, c].map((text, i) => post(String(i), { text, postedAt: NOW - (5 - i) * MINUTE }));
    assert.equal(detectCopyPaste(posts).flags.length, 0);
  });
});
