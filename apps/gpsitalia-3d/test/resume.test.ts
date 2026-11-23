import { describe, expect, it } from 'vitest';
import { renewDelayMs, saveResume, takeResume, RENEW_MARGIN_MS, RESUME_MAX_AGE_MS, type ResumeState } from '../src/resume';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const state: ResumeState = { selected: '000000000000001', basemap: 'hybrid', camera: { longitude: 12.5, latitude: 41.9, zoom: 17, pitch: 60, bearing: 10 }, following: false, search: 'furgone', replay: { day: '2026-11-23', t: 1_795_000_000_000, speed: '900' } };

describe('resume', () => {
  it('round-trips the state once', () => {
    const s = memory();
    expect(saveResume(s, state, 1_000)).toBe(true);
    expect(takeResume(s, 2_000)).toEqual(state);
    expect(takeResume(s, 3_000)).toBeNull();
  });
  it('ignores stale state', () => {
    const s = memory();
    saveResume(s, state, 0);
    expect(takeResume(s, RESUME_MAX_AGE_MS + 1)).toBeNull();
  });
  it('sanitizes tampered values', () => {
    const s = memory();
    s.setItem('map3d.resume', JSON.stringify({ at: 1, state: { selected: '../x', basemap: 'evil', camera: { longitude: 500, latitude: 0, zoom: 1, pitch: 0, bearing: 0 }, replay: { day: 'x', t: 1, speed: '1' }, search: 7 } }));
    expect(takeResume(s, 2)).toEqual({ selected: null, basemap: 'standard', camera: null, following: true, search: '', replay: null });
  });
  it('survives broken JSON and missing storage', () => {
    const s = memory(); s.setItem('map3d.resume', '{');
    expect(takeResume(s, 1)).toBeNull();
    expect(takeResume(undefined)).toBeNull();
    expect(saveResume(undefined, state)).toBe(false);
  });
});

describe('renewDelayMs', () => {
  it('renews a few minutes before expiry, at once when already late', () => {
    expect(renewDelayMs(60 * 60_000, 0)).toBe(60 * 60_000 - RENEW_MARGIN_MS);
    expect(renewDelayMs(RENEW_MARGIN_MS - 1, 0)).toBe(0);
    expect(renewDelayMs(Number.NaN, 0)).toBe(0);
  });
});
