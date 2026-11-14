import { getDefaultLiveChannels, liveVideoSourceFor } from '@/services/live-channels';
import { withResolvedLiveVideos } from '@/services/live-video/resolved';
import { openLiveVideo, type LiveVideoSession, type LiveVideoState } from '@/services/live-video/session';

/** One player shared by the scene and the optional in-page corner tile. */
export class SituationRoomVideo {
  readonly element = document.createElement('aside');
  private readonly screen = document.createElement('div');
  private readonly label = document.createElement('div');
  private readonly channels = getDefaultLiveChannels();
  private session: LiveVideoSession | null = null;
  private generation = 0;
  private pending = false;
  private channel = 0;
  private scene = false;
  private pip = false;
  private muted = true;
  private paused = false;
  private suspended = false;
  private destroyed = false;

  constructor(private readonly changed: () => void) {
    this.element.className = 'tv-video';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Live news video');
    this.screen.className = 'tv-video-screen';
    this.label.className = 'tv-video-label';
    this.element.append(this.screen, this.label);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('pageshow', this.pageShow);
  }

  get pipEnabled(): boolean { return this.pip; }
  get isMuted(): boolean { return this.muted; }
  get isPaused(): boolean { return this.paused; }
  get channelName(): string { return this.channels[this.channel]?.name ?? 'No channel'; }

  showScene(scene: boolean): void { this.scene = scene; this.sync(); }
  togglePip(): void { this.pip = !this.pip; this.sync(); this.changed(); }
  toggleMuted(): void {
    this.muted = !this.muted;
    this.session?.setMuted(this.muted);
    this.updateAudioLabel();
    this.changed();
  }
  togglePaused(): void {
    this.paused = !this.paused;
    this.session?.setPaused(this.paused);
    this.updateAudioLabel();
    this.changed();
  }
  nextChannel(direction: number): void {
    this.channel = (this.channel + direction + this.channels.length) % this.channels.length;
    this.stop(); this.sync(); this.changed();
  }
  retry(): void {
    if (this.session) this.session.retry();
    else this.sync();
  }

  private updateAudioLabel(): void {
    this.element.dataset.muted = String(this.muted);
    this.label.textContent = `${this.channelName} · ${this.muted ? 'Muted' : 'Sound on'} · ${this.paused ? 'Paused · ' : ''}${this.element.dataset.playback ?? 'Connecting'}`;
  }
  private present(state: LiveVideoState): void {
    if ((state.phase === 'connecting' && state.tapToPlay)
      || (state.phase === 'unverified' && state.reason === 'not-started')) {
      this.paused = true;
      this.changed();
    }
    const text = state.phase === 'live' ? 'Live broadcast'
      : state.phase === 'connecting' ? (state.tapToPlay ? 'Press Play video' : 'Connecting')
      : state.phase === 'recording' ? 'Recording — not live'
      : state.phase === 'unverified' ? 'Live playback not verified — try Play video or another channel'
      : 'Feed not connected — try another channel';
    this.element.dataset.playback = text;
    this.element.dataset.phase = state.phase;
    this.updateAudioLabel();
  }
  private sync(): void {
    const visible = !this.destroyed && !this.suspended && !document.hidden && (this.scene || this.pip);
    this.element.hidden = !visible;
    this.element.dataset.mode = this.scene ? 'scene' : 'pip';
    if (!visible) { this.stop(); return; }
    if (this.session || this.pending) return;
    const channel = this.channels[this.channel];
    if (!channel) return;
    const generation = ++this.generation;
    this.pending = true;
    this.element.dataset.playback = 'Connecting';
    this.updateAudioLabel();
    void withResolvedLiveVideos(liveVideoSourceFor(channel)).then(source => {
      if (generation !== this.generation || this.destroyed) return;
      this.pending = false;
      this.session = openLiveVideo(this.screen, {
        source, autoplay: !this.paused, muted: this.muted, holdUnstarted: true,
        presentation: { title: channel.name, className: 'tv-video-player', controls: false },
        onState: state => { if (generation === this.generation) this.present(state); },
        onMutedChange: muted => {
          if (generation !== this.generation) return;
          this.muted = muted; this.updateAudioLabel(); this.changed();
        },
        onPlayingChange: playing => {
          if (generation !== this.generation) return;
          this.paused = !playing; this.updateAudioLabel(); this.changed();
        },
      });
    }).catch(() => {
      if (generation !== this.generation) return;
      this.pending = false;
      this.element.dataset.playback = 'Feed not connected';
      this.updateAudioLabel();
    });
  }
  private stop(): void {
    ++this.generation;
    this.pending = false;
    this.session?.destroy(); this.session = null;
    this.screen.replaceChildren();
  }
  private readonly visibility = (): void => { this.sync(); };
  private readonly pageHide = (): void => { this.suspended = true; this.sync(); };
  private readonly pageShow = (): void => { this.suspended = false; this.sync(); };
  destroy(): void {
    this.destroyed = true;
    this.stop();
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.pageHide);
    window.removeEventListener('pageshow', this.pageShow);
    this.element.remove();
  }
}
