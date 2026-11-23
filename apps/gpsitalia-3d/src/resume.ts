/**
 * Hourly token renewal goes through auth.gpsitalia.com with a full navigation
 * (auth forbids iframes). What the user was looking at is saved here and
 * restored on return, so the selection, the view and the timelapse survive.
 */
export interface ResumeState {
  selected: string | null;
  basemap: 'standard' | 'hybrid';
  camera: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number } | null;
  following: boolean;
  search: string;
  replay: { day: string; t: number; speed: string } | null;
}

export const RESUME_KEY = 'map3d.resume';
export const RESUME_MAX_AGE_MS = 15 * 60_000;
/** Renew this long before the token expires. */
export const RENEW_MARGIN_MS = 3 * 60_000;

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export function saveResume(storage: Storage | undefined, state: ResumeState, nowMs = Date.now()): boolean {
  try { storage?.setItem(RESUME_KEY, JSON.stringify({ at: nowMs, state })); return Boolean(storage); } catch { return false; }
}

/** Reads and removes the saved state; null when missing, stale or malformed. */
export function takeResume(storage: Storage | undefined, nowMs = Date.now()): ResumeState | null {
  try {
    const raw = storage?.getItem(RESUME_KEY);
    storage?.removeItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; state?: Partial<ResumeState> };
    if (typeof parsed.at !== 'number' || nowMs - parsed.at > RESUME_MAX_AGE_MS || nowMs < parsed.at - 60_000 || !parsed.state) return null;
    const s = parsed.state;
    const camera = s.camera && [s.camera.longitude, s.camera.latitude, s.camera.zoom, s.camera.pitch, s.camera.bearing].every(Number.isFinite) && Math.abs(s.camera.latitude) <= 85.051129 && Math.abs(s.camera.longitude) <= 180 ? s.camera : null;
    const replay = s.replay && /^\d{4}-\d{2}-\d{2}$/.test(s.replay.day) && Number.isFinite(s.replay.t) && /^\d{1,5}$/.test(s.replay.speed) ? s.replay : null;
    return {
      selected: typeof s.selected === 'string' && /^\d{1,20}$/.test(s.selected) ? s.selected : null,
      basemap: s.basemap === 'hybrid' ? 'hybrid' : 'standard',
      camera, following: s.following !== false,
      search: typeof s.search === 'string' ? s.search.slice(0, 100) : '',
      replay,
    };
  } catch { return null; }
}

/** Milliseconds until the renewal should start (0 = now). */
export function renewDelayMs(expiresAtMs: number, nowMs = Date.now()): number {
  if (!Number.isFinite(expiresAtMs)) return 0;
  return Math.max(0, expiresAtMs - RENEW_MARGIN_MS - nowMs);
}
