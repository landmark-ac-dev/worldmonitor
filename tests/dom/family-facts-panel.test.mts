import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FamilyFactsPanel } from '@/components/FamilyFactsPanel';
import type { NewsItem } from '@/types';
import { initTestI18n } from './helpers/i18n.mts';

beforeAll(initTestI18n);
let panel: FamilyFactsPanel | undefined;
afterEach(() => { panel?.destroy(); panel = undefined; vi.useRealTimers(); document.body.replaceChildren(); });

const now = Date.parse('2026-11-13T18:00:00Z');
const item = (source: string, title: string, link: string): NewsItem => ({
  source, title, link, pubDate: new Date(now - 60_000), isAlert: true,
});
function mount(): HTMLElement {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  panel = new FamilyFactsPanel();
  document.body.append(panel.getElement());
  return panel.getElement();
}

describe('family facts panel', () => {
  it('shows source-linked current evidence and no single-story pattern', () => {
    const root = mount();
    panel!.updateNews([
      item('FAA', 'Flights grounded at regional airport', 'https://www.faa.gov/news/test'),
      item('Unknown', 'Viral stockpile message', 'https://example.com/viral'),
    ]);
    expect(root.querySelectorAll('.family-facts-lines li')).toHaveLength(1);
    expect(root.querySelector('.family-facts-lines')?.textContent).not.toContain('stockpile');
    expect(root.querySelector('.family-facts-lines a')?.getAttribute('href')).toBe('https://www.faa.gov/news/test');
    expect(root.querySelector('.family-facts-pattern')?.getAttribute('data-alert')).toBe('false');
    expect(root.textContent).toContain('Fewer than three');
  });

  it('expires pattern evidence without requiring another network refresh, preserving pasted input', () => {
    const root = mount();
    panel!.updateNews([
      item('FAA', 'Flights grounded at regional airport', 'https://www.faa.gov/news/test'),
      item('DHS', 'Power outage leaves regional grid offline', 'https://www.dhs.gov/news/test'),
    ], true);
    expect(root.querySelector('.family-facts-pattern')?.getAttribute('data-alert')).toBe('true');
    expect(root.textContent).toContain('Some feeds could not refresh');
    const input = root.querySelector('textarea')!;
    input.value = 'unsent local work';
    vi.advanceTimersByTime(6 * 60 * 60 * 1_000);
    expect(root.querySelector('.family-facts-pattern')?.getAttribute('data-alert')).toBe('false');
    expect(root.querySelectorAll('.family-facts-lines li')).toHaveLength(0);
    expect(input.value).toBe('unsent local work');
  });

  it('checks pasted posts via the actual button and handles invalid input safely', () => {
    const root = mount();
    const input = root.querySelector('textarea')!;
    input.value = JSON.stringify(Array.from({ length: 5 }, (_, index) => ({
      platform: 'example', accountId: `person-${index}`,
      text: '<img src=x onerror=alert(1)> This is a fictional repeated claim for testing the copy detector with enough words.',
      postedAt: now - index * 60_000, followers: 5,
    })));
    const button = [...root.querySelectorAll('button')].find(node => node.textContent === 'Check pasted posts')!;
    button.click();
    expect(root.querySelector('.copy-paste-check')?.textContent).toContain('1 repeated-text group flagged');
    expect(root.querySelectorAll('.copy-paste-check img')).toHaveLength(0);
    input.value = '{bad json';
    button.click();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('.copy-paste-check')?.textContent).not.toContain('1 repeated-text group flagged');
    expect(root.querySelector('.copy-paste-check')?.textContent).toContain('Paste a valid JSON array');
  });
});
