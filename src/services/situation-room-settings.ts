/** TV preferences contain no account data and never change the dashboard layout. */
export const TV_ROTATION_MS = 20_000;
export const TV_TIME_ZONE = 'America/Chicago';
export const TV_QUIET_STORAGE_KEY = 'wm-tv-quiet-hours-v1';
export const TV_DEFAULT_QUIET_HOURS = '22:00-07:00';

export interface QuietHours { startMinute: number; endMinute: number }

export function isSituationRoomUrl(pathname: string, search: string): boolean {
  return new URLSearchParams(search).get('mode') !== 'agent'
    && (pathname.replace(/\/$/, '') === '/tv' || new URLSearchParams(search).get('tv') === '1');
}

/** Invalid settings fail open (no dimming); equal endpoints mean disabled. */
export function parseQuietHours(value: string | null): QuietHours | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, sh, sm, eh, em] = match.map(Number);
  if (sh! > 23 || eh! > 23 || sm! > 59 || em! > 59) return null;
  const startMinute = sh! * 60 + sm!;
  const endMinute = eh! * 60 + em!;
  return startMinute === endMinute ? null : { startMinute, endMinute };
}

const centralParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TV_TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

export function isQuietTime(hours: QuietHours | null, now: number): boolean {
  if (!hours || !Number.isFinite(now)) return false;
  const parts = centralParts.formatToParts(now);
  const minute = Number(parts.find(p => p.type === 'hour')?.value) * 60
    + Number(parts.find(p => p.type === 'minute')?.value);
  return hours.startMinute < hours.endMinute
    ? minute >= hours.startMinute && minute < hours.endMinute
    : minute >= hours.startMinute || minute < hours.endMinute;
}

/** Map URL synchronization must not discard TV or a shared quiet schedule. */
export function retainSituationRoomParams(shareUrl: string, currentUrl: string): string {
  const current = new URL(currentUrl);
  if (!isSituationRoomUrl(current.pathname, current.search)) return shareUrl;
  const next = new URL(shareUrl);
  if (current.pathname.replace(/\/$/, '') !== '/tv') next.searchParams.set('tv', '1');
  if (current.searchParams.has('quiet')) next.searchParams.set('quiet', current.searchParams.get('quiet')!);
  return next.href;
}
