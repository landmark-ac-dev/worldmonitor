import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SituationRoomController } from '@/app/situation-room';
import type { SituationRoomInput } from '@/services/situation-room-model';
import { isQuietTime, parseQuietHours, isSituationRoomUrl, retainSituationRoomParams } from '@/services/situation-room-settings';

vi.mock('@/services/pwa-install', () => ({ mountInstallEntry: () => () => {} }));
let controller: SituationRoomController | undefined;
const now = Date.parse('2026-11-14T04:30:00Z'); // 22:30 Central standard time
const snapshot: SituationRoomInput = {
  news: [], newsUpdatedAt: null, newsDegraded: true, online: true,
  aviation: null, cyber: null, markets: null, weather: null,
};
const key = (value: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
function mount() {
  const app = document.createElement('div');
  app.id = 'app';
  const main = document.createElement('main'); main.id = 'main';
  const map = document.createElement('section'); map.id = 'mapSection';
  const panels = document.createElement('div'); panels.id = 'panelsGrid';
  main.append(map, panels); app.append(main); document.body.append(app);
  const reconnect = vi.fn(); const resizeMap = vi.fn();
  controller = new SituationRoomController({ container: app, getSnapshot: () => snapshot, reconnect, resizeMap });
  return { app, reconnect, resizeMap };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); localStorage.clear();
  history.replaceState(null, '', '/tv');
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => { controller?.destroy(); controller = undefined; document.body.replaceChildren(); vi.useRealTimers(); });

describe('TV controls and lifecycle', () => {
  it('rotates at twenty seconds, pauses when selecting and resumes by d-pad', () => {
    mount();
    expect(document.querySelector('.tv-reader')?.getAttribute('data-scene')).toBe('facts');
    vi.advanceTimersByTime(20_000);
    expect(document.querySelector('.tv-reader')?.getAttribute('data-scene')).toBe('patterns');
    key('ArrowRight'); vi.advanceTimersByTime(40_000);
    expect(document.querySelector('.tv-reader')?.getAttribute('data-scene')).toBe('aviation');
    key('ArrowDown'); vi.advanceTimersByTime(20_000);
    expect(document.querySelector('.tv-reader')?.getAttribute('data-scene')).toBe('cyber');
  });
  it('makes controls reachable by arrows and returns focus to the display', () => {
    mount(); key('ArrowUp');
    expect(document.activeElement?.textContent).toBe('Resume rotation');
    key('ArrowRight'); expect(document.activeElement?.textContent).toBe('Dim now');
    (document.activeElement as HTMLButtonElement).click();
    expect(document.documentElement.dataset.tvDimmed).toBe('true');
    key('Escape'); expect(document.querySelector<HTMLElement>('.tv-toolbar')?.hidden).toBe(true);
    expect(document.activeElement?.className).toBe('tv-reader');
  });
  it('persists explicit quiet hours and shifts pixels without moving the page URL', () => {
    history.replaceState(null, '', '/tv?quiet=22:00-07:00');
    const { app } = mount();
    expect(localStorage.getItem('wm-tv-quiet-hours-v1')).toBe('22:00-07:00');
    expect(document.documentElement.dataset.tvDimmed).toBe('true');
    const before = [app.style.getPropertyValue('--tv-shift-x'), app.style.getPropertyValue('--tv-shift-y')];
    vi.advanceTimersByTime(60_000);
    expect([app.style.getPropertyValue('--tv-shift-x'), app.style.getPropertyValue('--tv-shift-y')]).not.toEqual(before);
    expect(location.search).toBe('?quiet=22:00-07:00');
  });
  it('reconnects once on online and cleans up timers and listeners', () => {
    const { reconnect, app } = mount();
    window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('online'));
    expect(reconnect).toHaveBeenCalledTimes(1);
    controller!.destroy(); vi.advanceTimersByTime(60_000); window.dispatchEvent(new Event('online'));
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(app.querySelector('.tv-reader')).toBeNull();
    expect(document.documentElement.dataset.situationRoom).toBeUndefined();
  });
  it('acquires, releases and recovers a supported wake lock', async () => {
    const lock = Object.assign(new EventTarget(), { release: vi.fn(async () => {}) });
    const request = vi.fn(async () => lock);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    mount(); await Promise.resolve();
    expect(request).toHaveBeenCalledWith('screen');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(lock.release).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('TV URL and Central time settings', () => {
  it('accepts only explicit TV routes while preserving agent mode', () => {
    expect(isSituationRoomUrl('/tv/', '')).toBe(true);
    expect(isSituationRoomUrl('/', '?tv=1')).toBe(true);
    expect(isSituationRoomUrl('/tv', '?mode=agent')).toBe(false);
    expect(isSituationRoomUrl('/dashboard', '?tv=0')).toBe(false);
    expect(retainSituationRoomParams('https://example.com/?lat=2', 'https://example.com/?tv=1&quiet=off')).toContain('tv=1&quiet=off');
  });
  it('handles overnight and daytime boundaries across Central DST', () => {
    const hours = parseQuietHours('22:00-07:00');
    expect(isQuietTime(hours, now)).toBe(true);
    expect(isQuietTime(hours, Date.parse('2026-11-14T13:00:00Z'))).toBe(false);
    expect(isQuietTime(hours, Date.parse('2026-07-14T03:00:00Z'))).toBe(true);
    expect(parseQuietHours('25:00-07:00')).toBeNull();
    expect(parseQuietHours('07:00-07:00')).toBeNull();
    expect(isQuietTime(parseQuietHours('09:00-17:00'), Date.parse('2026-07-14T14:00:00Z'))).toBe(true);
  });
});
