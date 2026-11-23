import { describe, expect, it } from 'vitest';
import { shouldAutoRelogin, sessionWorked, RELOGIN_WINDOW_MS } from '../src/relogin';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('shouldAutoRelogin', () => {
  it('allows one automatic re-login, then stops inside the window', () => {
    const s = memory();
    expect(shouldAutoRelogin(s, 1_000)).toBe(true);
    expect(shouldAutoRelogin(s, 1_000 + 30_000)).toBe(false);
  });
  it('allows it again after the window', () => {
    const s = memory();
    shouldAutoRelogin(s, 1_000);
    expect(shouldAutoRelogin(s, 1_000 + RELOGIN_WINDOW_MS)).toBe(true);
  });
  it('a working session resets the guard', () => {
    const s = memory();
    shouldAutoRelogin(s, 1_000); sessionWorked(s);
    expect(shouldAutoRelogin(s, 2_000)).toBe(true);
  });
  it('refuses when storage is unavailable or throws', () => {
    expect(shouldAutoRelogin({ getItem: () => { throw new Error('blocked'); }, setItem() {}, removeItem() {} })).toBe(false);
    expect(shouldAutoRelogin(undefined)).toBe(false);
  });
});
