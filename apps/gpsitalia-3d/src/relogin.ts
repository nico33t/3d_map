/**
 * One automatic re-login per window. If the session is refused again right after
 * a reload, stop and let the user act: no reload loop, no wasted map loads.
 */
export const RELOGIN_KEY = 'map3d.relogin';
export const RELOGIN_WINDOW_MS = 2 * 60_000;

export interface SmallStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export function shouldAutoRelogin(storage: SmallStorage | undefined, nowMs = Date.now()): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage?.getItem(RELOGIN_KEY));
    if (Number.isFinite(last) && last > 0 && nowMs - last < RELOGIN_WINDOW_MS) return false;
    storage?.setItem(RELOGIN_KEY, String(nowMs));
    return true;
  } catch {
    return false; // without storage we cannot rule out a loop
  }
}

export function sessionWorked(storage: SmallStorage | undefined) {
  try { storage?.removeItem(RELOGIN_KEY); } catch { /* optional */ }
}
