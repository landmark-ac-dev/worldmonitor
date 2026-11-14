import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SituationRoomVideo } from '@/app/situation-room-video';

const mocks = vi.hoisted(() => ({
  open: vi.fn(), resolve: vi.fn(async (source: unknown) => source),
  session: { destroy: vi.fn(), setMuted: vi.fn(), setPaused: vi.fn(), retry: vi.fn() },
}));
vi.mock('@/services/live-channels', () => ({
  getDefaultLiveChannels: () => [{ id: 'a', name: 'Channel A' }, { id: 'b', name: 'Channel B' }],
  liveVideoSourceFor: (channel: { id: string }) => ({ slot: channel.id, entries: [] }),
}));
vi.mock('@/services/live-video/resolved', () => ({ withResolvedLiveVideos: mocks.resolve }));
vi.mock('@/services/live-video/session', () => ({ openLiveVideo: mocks.open }));

let video: SituationRoomVideo;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.open.mockReturnValue(mocks.session);
  mocks.resolve.mockImplementation(async source => source);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  video = new SituationRoomVideo(vi.fn());
  document.body.append(video.element);
});
afterEach(() => video.destroy());

describe('TV-owned video intent and lifecycle', () => {
  it('starts with PiP off, makes no playback request, and starts the live scene muted', async () => {
    expect(video.pipEnabled).toBe(false);
    expect(video.element.hidden).toBe(true);
    expect(mocks.resolve).not.toHaveBeenCalled();
    video.showScene(true); await settle();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open.mock.calls[0]?.[1]).toMatchObject({ muted: true, autoplay: true });
    expect(video.element.dataset.mode).toBe('scene');
    video.showScene(false);
    expect(mocks.session.destroy).toHaveBeenCalledTimes(1);
    expect(video.element.hidden).toBe(true);
  });
  it('shares one session between the scene and opted-in PiP and keeps sound opt-in', async () => {
    video.togglePip(); await settle();
    video.showScene(true); video.showScene(false);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.session.destroy).not.toHaveBeenCalled();
    expect(video.element.dataset.mode).toBe('pip');
    expect(video.isMuted).toBe(true);
    video.toggleMuted();
    expect(mocks.session.setMuted).toHaveBeenLastCalledWith(false);
    video.nextChannel(1); await settle();
    expect(mocks.open.mock.calls[1]?.[1]).toMatchObject({ muted: false });
    video.togglePip();
    expect(video.element.hidden).toBe(true);
  });
  it('cannot resurrect a hidden player from late asynchronous source resolution', async () => {
    let resolve!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    video.togglePip(); video.togglePip();
    resolve({ slot: 'a', entries: [] }); await settle();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(video.element.hidden).toBe(true);
  });
  it('stops on page hiding and restarts only the requested surface on return', async () => {
    video.togglePip(); await settle();
    window.dispatchEvent(new Event('pagehide'));
    expect(mocks.session.destroy).toHaveBeenCalledTimes(1);
    expect(video.element.hidden).toBe(true);
    window.dispatchEvent(new Event('pageshow')); await settle();
    expect(mocks.open).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.session.destroy).toHaveBeenCalledTimes(2);
    video.destroy();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    window.dispatchEvent(new Event('pageshow')); await settle();
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });
  it('does not describe failed playback or recordings as a live broadcast', async () => {
    video.showScene(true); await settle();
    const callback = mocks.open.mock.calls[0]?.[1].onState;
    callback({ phase: 'offline', reason: 'error', watchUrl: null });
    expect(video.element.textContent).toContain('Feed not connected');
    callback({ phase: 'recording', title: 'Archive', watchUrl: null });
    expect(video.element.textContent).toContain('Recording — not live');
  });
  it('offers Play after autoplay refusal and resumes on the first press', async () => {
    video.showScene(true); await settle();
    const callback = mocks.open.mock.calls[0]?.[1].onState;
    callback({ phase: 'connecting', attempt: 1, of: 1, ready: true, tapToPlay: true });
    expect(video.isPaused).toBe(true);
    video.togglePaused();
    expect(mocks.session.setPaused).toHaveBeenLastCalledWith(false);
    callback({ phase: 'live', via: 'hls', title: null, author: null, watchUrl: null });
    video.togglePaused();
    expect(video.element.textContent).toContain('Paused');
  });
});
