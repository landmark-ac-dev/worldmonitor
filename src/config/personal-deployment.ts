/** Personal self-hosted identity; normal upstream builds keep their existing name. */
export const PERSONAL_DEPLOYMENT = (() => {
  try { return import.meta.env.VITE_PERSONAL_MODE === 'true'; }
  catch { return false; } // Plain Node test runners do not supply Vite's env.
})();
export const APP_NAME = PERSONAL_DEPLOYMENT ? 'Everfen Monitor' : 'World Monitor';
export const APP_DESCRIPTION = PERSONAL_DEPLOYMENT
  ? 'A calm family view of the world, with source-linked facts, clear uncertainty, and useful local context.'
  : 'Real-time global intelligence dashboard';
export const PERSONAL_SOURCE_URL = 'https://github.com/landmark-ac-dev/worldmonitor/tree/feat/tv-live-docker';
