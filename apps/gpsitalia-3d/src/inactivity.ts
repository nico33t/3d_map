/**
 * «Sei ancora qui?»: after `idleMs` without interaction a warning is shown;
 * if nobody answers within `countdownMs` the page leaves. While the tab is
 * hidden time keeps counting: coming back after the deadline leaves at once.
 * Timers and clock are injected so the logic is unit tested.
 */
export interface InactivityOptions {
  idleMs?: number;
  countdownMs?: number;
  onWarn: (secondsLeft: number) => void;
  onTick?: (secondsLeft: number) => void;
  onResume?: () => void;
  onExpire: () => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface InactivityWatch {
  /** Call on any user interaction. Ignored while the warning is shown, except through confirm(). */
  activity(): void;
  /** The user answered «Sì, continuo». */
  confirm(): void;
  /** Re-evaluates deadlines, e.g. when the tab becomes visible again. */
  check(): void;
  stop(): void;
  readonly warning: boolean;
}

export const DEFAULT_IDLE_MS = 10 * 60_000;
export const DEFAULT_COUNTDOWN_MS = 60_000;

export function createInactivityWatch(options: InactivityOptions): InactivityWatch {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const countdownMs = options.countdownMs ?? DEFAULT_COUNTDOWN_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let last = now();
  let warning = false, stopped = false;
  let timer: unknown;
  const schedule = (ms: number) => { if (timer !== undefined) clearTimer(timer); timer = setTimer(check, Math.max(0, ms)); };
  function check() {
    if (stopped) return;
    const idle = now() - last;
    if (idle >= idleMs + countdownMs) { stopped = true; if (timer !== undefined) clearTimer(timer); options.onExpire(); return; }
    if (idle >= idleMs) {
      const left = Math.ceil((idleMs + countdownMs - idle) / 1000);
      if (!warning) { warning = true; options.onWarn(left); } else options.onTick?.(left);
      schedule(Math.min(1000, idleMs + countdownMs - idle));
      return;
    }
    schedule(idleMs - idle);
  }
  schedule(idleMs);
  return {
    activity() { if (!stopped && !warning) last = now(); },
    confirm() { if (stopped) return; last = now(); if (warning) { warning = false; options.onResume?.(); } schedule(idleMs); },
    check,
    stop() { stopped = true; if (timer !== undefined) clearTimer(timer); },
    get warning() { return warning; },
  };
}
