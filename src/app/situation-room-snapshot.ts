import type { AppContext } from './app-context';
import type { SituationRoomInput, SituationRoomDomain, SituationRoomSourceState } from '@/services/situation-room-model';
import { SITE_VARIANT } from '@/config/variant';

/** Read the same data that the normal dashboard has loaded; no DOM reads or fetching. */
export function getSituationRoomSnapshot(ctx: AppContext): SituationRoomInput {
  const operational = SITE_VARIANT !== 'happy';
  const enabled: Record<SituationRoomDomain, boolean> = {
    aviation: operational && (!!ctx.isSituationRoom || ctx.mapLayers.flights),
    cyber: operational && import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true' && (!!ctx.isSituationRoom || ctx.mapLayers.cyberThreats),
    finance: operational,
    weather: operational && (!!ctx.isSituationRoom || ctx.mapLayers.weather),
  };
  const sources: Partial<Record<SituationRoomDomain, SituationRoomSourceState>> = {};
  for (const domain of ['aviation', 'cyber', 'finance', 'weather'] as const) {
    sources[domain] = {
      state: 'not-loaded', receivedAt: null, sourceUpdatedAt: null,
      ...ctx.situationRoomSources?.[domain], enabled: enabled[domain],
    };
  }
  return {
    news: ctx.allNews,
    newsUpdatedAt: ctx.situationRoomNewsUpdatedAt ?? null,
    newsDegraded: ctx.situationRoomNewsDegraded ?? true,
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
    aviation: ctx.intelligenceCache.flightDelays ?? null,
    cyber: ctx.cyberThreatsCache ?? ctx.situationRoomCyberThreats ?? null,
    markets: ctx.latestMarkets.length ? ctx.latestMarkets : null,
    weather: ctx.intelligenceCache.weatherAlerts ?? null,
    sources,
  };
}
