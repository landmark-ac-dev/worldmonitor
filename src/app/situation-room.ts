import '../styles/situation-room.css';
import { createStoryConfidenceBadge } from '@/components/news/confidence-label';
import { buildSituationRoomModel, type SituationRoomInput, type SituationRoomModel } from '@/services/situation-room-model';
import {
  isQuietTime, parseQuietHours, TV_DEFAULT_QUIET_HOURS, TV_QUIET_STORAGE_KEY,
  TV_ROTATION_MS, TV_TIME_ZONE,
} from '@/services/situation-room-settings';
import { mountInstallEntry } from '@/services/pwa-install';
import { safeStorageGet, safeStorageSet } from '@/utils/safe-storage';
import { SituationRoomVideo } from './situation-room-video';

interface SituationRoomOptions {
  container: HTMLElement;
  getSnapshot: () => SituationRoomInput;
  reconnect: () => void;
  resizeMap: () => void;
  subscribe?: (refresh: () => void) => () => void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clock = new Intl.DateTimeFormat('en-US', { timeZone: TV_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const date = new Intl.DateTimeFormat('en-US', { timeZone: TV_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', timeZoneName: 'short' });
const SHIFT_POINTS = [[0, 0], [2, 0], [2, 2], [0, 2], [-2, 2], [-2, 0], [-2, -2], [0, -2], [2, -2]] as const;

/** A reading surface around the existing map. It never owns or polls a provider. */
export class SituationRoomController {
  private readonly topbar = element('header', 'tv-topbar');
  private readonly reader = element('section', 'tv-reader');
  private readonly mapCaption = element('div', 'tv-map-caption');
  private readonly statusCard = element('aside', 'tv-map-status');
  private readonly footer = element('footer', 'tv-footer');
  private readonly toolbar = element('div', 'tv-toolbar');
  private readonly status = element('span', 'tv-overall-status');
  private readonly time = element('time', 'tv-clock');
  private readonly calendar = element('span', 'tv-calendar');
  private readonly refreshed = element('span', 'tv-refreshed');
  private readonly connectivity = element('span', 'tv-connectivity');
  private readonly progress = element('div', 'tv-progress-fill');
  private readonly navigation = element('nav', 'tv-scenes');
  private readonly rotation = element('span', 'tv-rotation-status');
  private readonly wakeStatus = element('span', 'tv-wake-status');
  private readonly quietButton = element('button', 'tv-control');
  private readonly dimButton = element('button', 'tv-control', 'Dim now');
  private readonly playButton = element('button', 'tv-control', 'Resume rotation');
  private readonly installMount = element('div', 'tv-install');
  private readonly pipButton = element('button', 'tv-control');
  private readonly muteButton = element('button', 'tv-control');
  private readonly videoPlayButton = element('button', 'tv-control');
  private readonly video = new SituationRoomVideo(() => this.updateVideoControls());
  private model: SituationRoomModel;
  private index = 0;
  private paused = false;
  private destroyed = false;
  private controlsOpen = false;
  private lastModelAt = 0;
  private nextRotationAt = Date.now() + TV_ROTATION_MS;
  private lastReconnectAt = 0;
  private contentKey = '';
  private quietValue: string;
  private manualDim: boolean | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private wakePending = false;
  private lastWakeAttempt = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cleanup: Array<() => void> = [];

  constructor(private readonly options: SituationRoomOptions) {
    const quietParam = new URLSearchParams(location.search).get('quiet');
    this.quietValue = safeStorageGet(TV_QUIET_STORAGE_KEY) ?? '';
    if (quietParam === 'off' || parseQuietHours(quietParam)) {
      this.quietValue = quietParam === 'off' ? '' : quietParam!;
      safeStorageSet(TV_QUIET_STORAGE_KEY, this.quietValue);
    }
    this.model = buildSituationRoomModel(options.getSnapshot());
    this.mount();
    this.refresh();
    this.tick();
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    this.cleanup.push(() => document.removeEventListener('keydown', this.onKey, true));
    this.cleanup.push(() => document.removeEventListener('visibilitychange', this.onVisibility));
    this.cleanup.push(() => window.removeEventListener('online', this.onOnline));
    this.cleanup.push(() => window.removeEventListener('offline', this.onOffline));
    this.cleanup.push(() => window.removeEventListener('pagehide', this.onPageHide));
    this.cleanup.push(() => window.removeEventListener('pageshow', this.onPageShow));
    if (options.subscribe) this.cleanup.push(options.subscribe(this.scheduleRefresh));
    this.cleanup.push(mountInstallEntry(this.installMount));
    this.timer = setInterval(() => this.tick(), 1_000);
    void this.acquireWakeLock();
    options.resizeMap();
  }

  private mount(): void {
    document.documentElement.dataset.situationRoom = 'true';
    document.title = 'World Monitor · Situation Room';
    this.reader.setAttribute('aria-label', 'Situation room briefing');
    this.reader.tabIndex = -1;
    this.statusCard.setAttribute('role', 'status');
    this.statusCard.setAttribute('aria-live', 'polite');
    this.navigation.setAttribute('aria-label', 'TV scenes');
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'TV display controls');
    this.toolbar.hidden = true;

    const brand = element('div', 'tv-brand');
    brand.append(element('span', 'tv-brand-mark', '◎'), element('strong', '', 'WORLD MONITOR'), element('span', 'tv-edition', 'SITUATION ROOM'));
    const health = element('div', 'tv-health');
    health.append(element('span', 'tv-eyebrow', 'NEWS PATTERN STATUS'), this.status, this.connectivity);
    const timebox = element('div', 'tv-timebox');
    timebox.append(this.time, this.calendar, this.refreshed);
    this.topbar.append(brand, health, timebox);
    this.mapCaption.append(element('span', 'tv-eyebrow', 'GLOBAL PICTURE'), element('span', 'tv-map-note', 'Your dashboard map · context at a glance'));

    const fullscreen = element('button', 'tv-control', 'Fullscreen');
    fullscreen.addEventListener('click', () => { void this.fullscreen(); });
    this.playButton.addEventListener('click', () => { this.closeControls(); this.setPaused(false); });
    this.dimButton.addEventListener('click', () => this.toggleDim());
    this.quietButton.addEventListener('click', () => this.toggleQuietHours());
    const retry = element('button', 'tv-control', 'Refresh feeds');
    retry.addEventListener('click', () => this.reconnect());
    const back = element('button', 'tv-control', 'Back to display');
    back.addEventListener('click', () => this.closeControls());
    const dashboard = element('a', 'tv-control', 'Open dashboard');
    dashboard.href = '/dashboard';
    this.pipButton.addEventListener('click', () => this.video.togglePip());
    this.muteButton.addEventListener('click', () => this.video.toggleMuted());
    this.videoPlayButton.addEventListener('click', () => this.video.togglePaused());
    const previousChannel = element('button', 'tv-control', 'Previous channel');
    const nextChannel = element('button', 'tv-control', 'Next channel');
    const retryVideo = element('button', 'tv-control', 'Retry video');
    previousChannel.addEventListener('click', () => this.video.nextChannel(-1));
    nextChannel.addEventListener('click', () => this.video.nextChannel(1));
    retryVideo.addEventListener('click', () => this.video.retry());
    this.toolbar.append(this.playButton, this.dimButton, this.quietButton, fullscreen, retry,
      this.pipButton, this.muteButton, this.videoPlayButton, previousChannel, nextChannel, retryVideo,
      this.installMount, dashboard, back);
    this.updateVideoControls();
    this.toolbar.querySelectorAll('button').forEach(button => { button.type = 'button'; });

    const hint = element('div', 'tv-remote-hint');
    hint.append(element('span', '', '← → Switch'), element('span', '', 'OK Pause / play'), element('span', '', '↑ Controls'));
    const progressTrack = element('div', 'tv-progress');
    progressTrack.append(this.progress);
    const footerMeta = element('div', 'tv-footer-meta');
    footerMeta.append(this.rotation, hint, this.wakeStatus);
    this.footer.append(this.navigation, progressTrack, footerMeta);

    const main = this.options.container.querySelector('#main');
    const map = this.options.container.querySelector('#mapSection');
    if (!main || !map) throw new Error('TV mode requires the dashboard map shell');
    main.append(this.reader);
    map.append(this.mapCaption, this.statusCard);
    // Keep ordinary panels mounted for normal data ownership, outside keyboard
    // traversal. TV uses the shared data snapshot rather than scraping their DOM.
    const grid = this.options.container.querySelector<HTMLElement>('#panelsGrid');
    if (grid) {
      const previous = grid.inert;
      grid.inert = true;
      this.cleanup.push(() => { grid.inert = previous; });
    }
    this.options.container.append(this.topbar, this.footer, this.toolbar, this.video.element);
    this.renderNavigation();
  }

  private renderNavigation(): void {
    this.navigation.replaceChildren(...this.model.slides.map((slide, i) => {
      const button = element('button', 'tv-scene', slide.id === 'facts' ? 'The facts' : slide.id === 'patterns' ? 'Patterns' : slide.title);
      button.type = 'button';
      button.dataset.scene = slide.id;
      button.setAttribute('aria-label', `Show ${slide.title}`);
      button.addEventListener('click', () => { this.index = i; this.setPaused(true); this.renderSlide(); });
      return button;
    }));
  }

  private readonly scheduleRefresh = (): void => {
    if (this.destroyed || this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; this.refresh(); }, 200);
  };

  private refresh(): void {
    if (this.destroyed) return;
    this.model = buildSituationRoomModel(this.options.getSnapshot());
    this.lastModelAt = Date.now();
    this.status.textContent = this.model.status;
    this.status.dataset.state = this.model.status.toLowerCase();
    this.connectivity.textContent = navigator.onLine === false ? 'Offline · reconnecting automatically' : 'Based on selected sources';
    const statusTitle = this.model.status === 'Active' ? 'A source-backed pattern is active'
      : this.model.status === 'Normal' ? 'No qualifying pattern in the loaded reports' : 'Keeping watch on the available evidence';
    this.statusCard.dataset.state = this.model.status.toLowerCase();
    // Avoid re-announcing an unchanged live region on each clock tick.
    if (this.statusCard.dataset.message !== this.model.statusDetail) {
      this.statusCard.dataset.message = this.model.statusDetail;
      this.statusCard.replaceChildren(element('span', 'tv-status-symbol', this.model.status === 'Active' ? '◈' : '◎'),
        element('strong', '', statusTitle), element('p', '', this.model.statusDetail));
    }
    this.renderSlide();
  }

  private renderSlide(): void {
    const slide = this.model.slides[this.index];
    if (!slide) return;
    this.video.showScene(slide.id === 'live-tv');
    const key = JSON.stringify(slide);
    if (key !== this.contentKey) {
      this.contentKey = key;
      this.reader.dataset.scene = slide.id;
      const heading = element('div', 'tv-scene-heading');
      heading.append(element('span', 'tv-eyebrow', slide.kicker), element('span', 'tv-scene-number', `${String(this.index + 1).padStart(2, '0')} / ${String(this.model.slides.length).padStart(2, '0')}`), element('h1', '', slide.title));
      const list = element('ol', 'tv-story-list');
      const rows = slide.items.slice(0, slide.id === 'patterns' || slide.id === 'facts' ? 3 : 2);
      list.dataset.count = String(rows.length);
      for (const item of rows) {
        const row = element('li', 'tv-story');
        if (item.assessment) row.append(createStoryConfidenceBadge(item.assessment));
        if (item.value) row.append(element('span', 'tv-metric', item.value));
        row.append(element('h2', '', item.title));
        if (item.detail) row.append(element('p', 'tv-story-detail', item.detail));
        const sources = item.sources ?? item.assessment?.sources ?? [];
        if (sources.length) {
          const sourceRow = element('div', 'tv-story-sources');
          for (const source of sources.slice(0, 3)) {
            try {
              const url = new URL(source.url);
              if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
              const link = element('a', '', source.name);
              link.href = url.href;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              sourceRow.append(link);
            } catch { /* A malformed source is never an executable link. */ }
          }
          row.append(sourceRow);
        }
        list.append(row);
      }
      const body = slide.id === 'live-tv' ? element('div', 'tv-video-space')
        : rows.length ? list : element('div', 'tv-empty', slide.emptyMessage);
      const remainder = slide.items.length > rows.length
        ? `Showing ${rows.length} of ${slide.items.length} records. Open the dashboard for more. ` : '';
      const note = element('p', 'tv-scene-footnote', remainder + slide.footnote);
      this.reader.replaceChildren(heading, body, note);
    }
    for (const [i, node] of [...this.navigation.children].entries()) {
      node.setAttribute('aria-current', i === this.index ? 'true' : 'false');
    }
  }

  private updateVideoControls(): void {
    this.pipButton.textContent = this.video.pipEnabled ? 'Corner video on' : 'Corner video off';
    this.pipButton.setAttribute('aria-pressed', String(this.video.pipEnabled));
    this.muteButton.textContent = this.video.isMuted ? 'Unmute video' : 'Mute video';
    this.videoPlayButton.textContent = this.video.isPaused ? 'Play video' : 'Pause video';
  }

  private tick(): void {
    if (this.destroyed || document.hidden) return;
    const now = Date.now();
    if (now - this.lastModelAt >= 10_000) this.refresh();
    this.time.textContent = clock.format(now);
    this.time.dateTime = new Date(now).toISOString();
    this.calendar.textContent = date.format(now);
    this.refreshed.textContent = this.model.lastUpdatedAt
      ? `News refreshed ${clock.format(this.model.lastUpdatedAt)} CT · ${Math.max(0, Math.floor((now - this.model.lastUpdatedAt) / 60_000))}m ago`
      : 'Waiting for a successful news refresh';
    if (!this.paused && now >= this.nextRotationAt) this.step(1, false);
    const remaining = Math.max(0, Math.ceil((this.nextRotationAt - now) / 1_000));
    this.rotation.textContent = this.paused ? 'Ⅱ Rotation paused' : `▶ Next scene in ${remaining}s`;
    this.footer.dataset.paused = String(this.paused);
    this.progress.style.transform = `scaleX(${this.paused ? 1 : Math.max(0, Math.min(1, 1 - (this.nextRotationAt - now) / TV_ROTATION_MS))})`;
    const point = SHIFT_POINTS[Math.floor(now / 60_000) % SHIFT_POINTS.length]!;
    this.options.container.style.setProperty('--tv-shift-x', `${point[0]}px`);
    this.options.container.style.setProperty('--tv-shift-y', `${point[1]}px`);
    const scheduled = isQuietTime(parseQuietHours(this.quietValue), now);
    const dimmed = this.manualDim ?? scheduled;
    document.documentElement.dataset.tvDimmed = String(dimmed);
    this.dimButton.textContent = dimmed ? 'Brighten screen' : 'Dim now';
    this.dimButton.setAttribute('aria-pressed', String(dimmed));
    this.quietButton.textContent = this.quietValue ? `Quiet ${this.quietValue} CT` : 'Quiet hours off';
    this.quietButton.setAttribute('aria-pressed', String(Boolean(this.quietValue)));
    if (!this.wakeLock && now - this.lastWakeAttempt >= 60_000) void this.acquireWakeLock();
  }

  private step(direction: number, pause = true): void {
    if (!this.model.slides.length) return;
    this.index = (this.index + direction + this.model.slides.length) % this.model.slides.length;
    if (pause) this.paused = true;
    this.nextRotationAt = Date.now() + TV_ROTATION_MS;
    this.renderSlide();
    this.tick();
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.nextRotationAt = Date.now() + TV_ROTATION_MS;
    this.tick();
  }

  private openControls(): void {
    this.controlsOpen = true;
    this.toolbar.hidden = false;
    this.setPaused(true);
    this.playButton.focus({ preventScroll: true });
  }

  private closeControls(): void {
    this.controlsOpen = false;
    this.toolbar.hidden = true;
    this.reader.focus({ preventScroll: true });
  }

  private toggleDim(): void {
    this.manualDim = document.documentElement.dataset.tvDimmed !== 'true';
    this.tick();
  }

  private toggleQuietHours(): void {
    this.quietValue = this.quietValue ? '' : TV_DEFAULT_QUIET_HOURS;
    this.manualDim = null;
    safeStorageSet(TV_QUIET_STORAGE_KEY, this.quietValue);
    const url = new URL(location.href);
    url.searchParams.set('quiet', this.quietValue || 'off');
    history.replaceState(history.state, '', url);
    this.tick();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    const key = event.key || ({ 19: 'ArrowUp', 20: 'ArrowDown', 21: 'ArrowLeft', 22: 'ArrowRight', 23: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' } as Record<number, string>)[event.keyCode];
    if (!key) return;
    if ((key === 'Enter' || key === ' ') && target?.closest('button, a[href]')) {
      this.setPaused(true);
      return; // Preserve native activation for evidence links and scene buttons.
    }
    if (this.controlsOpen) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        const controls = [...this.toolbar.querySelectorAll<HTMLElement>('button, a[href]')];
        const i = controls.indexOf(document.activeElement as HTMLElement);
        controls[(i + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + controls.length) % controls.length]?.focus();
        return;
      }
      if (key === 'Enter' || key === ' ') return; // native focused button activation
      if (key === 'Escape' || key === 'Backspace') {
        event.preventDefault(); event.stopImmediatePropagation(); this.closeControls(); return;
      }
    }
    const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'MediaPlayPause', 'ContextMenu', 'Escape', 'f', 'F', 'd', 'D', 'p', 'P', 'm', 'M', '[', ']'].includes(key);
    if (!handled || event.repeat) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (key === 'ArrowLeft' || key === 'ArrowRight') this.step(key === 'ArrowLeft' ? -1 : 1);
    else if (key === 'ArrowUp' || key === 'ContextMenu' || key === 'Escape') this.openControls();
    else if (key === 'ArrowDown') this.setPaused(false);
    else if (key === 'f' || key === 'F') void this.fullscreen();
    else if (key === 'd' || key === 'D') this.toggleDim();
    else if (key === 'p' || key === 'P') this.video.togglePip();
    else if (key === 'm' || key === 'M') this.video.toggleMuted();
    else if (key === '[' || key === ']') this.video.nextChannel(key === '[' ? -1 : 1);
    else this.setPaused(!this.paused);
    void this.acquireWakeLock();
  };

  private async fullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      this.closeControls();
      this.options.resizeMap();
    } catch {
      this.wakeStatus.textContent = 'Use your browser’s fullscreen control';
    }
  }

  private async acquireWakeLock(): Promise<void> {
    if (this.destroyed || document.hidden || this.wakeLock || this.wakePending) return;
    this.lastWakeAttempt = Date.now();
    if (!navigator.wakeLock?.request) {
      this.wakeStatus.textContent = 'Device sleep settings apply';
      return;
    }
    this.wakePending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (this.destroyed || document.hidden) { await lock.release(); return; }
      this.wakeLock = lock;
      this.wakeStatus.textContent = 'Screen kept awake';
      lock.addEventListener('release', () => {
        if (this.wakeLock === lock) this.wakeLock = null;
        if (!this.destroyed) this.wakeStatus.textContent = 'Device sleep settings apply';
      }, { once: true });
    } catch {
      this.wakeStatus.textContent = 'Device sleep settings apply';
    } finally { this.wakePending = false; }
  }

  private releaseWakeLock(): void {
    const lock = this.wakeLock;
    this.wakeLock = null;
    if (lock) void lock.release().catch(() => {});
  }

  private reconnect(): void {
    if (this.destroyed || navigator.onLine === false || Date.now() - this.lastReconnectAt < 5_000) return;
    this.lastReconnectAt = Date.now();
    this.options.reconnect();
  }

  private readonly onOnline = (): void => { this.refresh(); this.reconnect(); this.video.retry(); };
  private readonly onOffline = (): void => { this.refresh(); };
  private readonly onPageHide = (): void => { this.releaseWakeLock(); };
  private readonly onPageShow = (): void => { this.onVisibility(); };
  private readonly onVisibility = (): void => {
    if (document.hidden) { this.releaseWakeLock(); return; }
    this.nextRotationAt = Date.now() + TV_ROTATION_MS;
    this.refresh(); this.tick(); this.reconnect(); void this.acquireWakeLock();
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.timer);
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.cleanup.forEach(fn => fn());
    this.video.destroy();
    this.releaseWakeLock();
    for (const node of [this.topbar, this.reader, this.mapCaption, this.statusCard, this.footer, this.toolbar]) node.remove();
    delete document.documentElement.dataset.situationRoom;
    delete document.documentElement.dataset.tvDimmed;
    this.options.container.style.removeProperty('--tv-shift-x');
    this.options.container.style.removeProperty('--tv-shift-y');
    this.options.resizeMap();
  }
}
