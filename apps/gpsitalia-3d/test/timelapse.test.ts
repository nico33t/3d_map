import { describe, expect, it } from 'vitest';
import { dayRange, findStops, indexAt, normalizeHistory, poseAt, trailUntil, MAX_GAP_MS, type TrackPoint } from '../src/timelapse';

const T0 = Date.parse('2026-11-23T08:00:00Z');
const p = (sec: number, longitude: number, latitude: number, speedKmh = 30, heading: number | null = null): TrackPoint => ({ t: T0 + sec * 1000, longitude, latitude, speedKmh, heading });

describe('normalizeHistory', () => {
  it('sorts, drops invalid rows and duplicate timestamps', () => {
    const rows = [
      { imei: '1', timestamp: '2026-11-23T08:00:10Z', latitude: '41.9', longitude: '12.5', speed: 30, angle: 90, satellites: 9 },
      { timestamp: '2026-11-23T08:00:00Z', latitude: 41.8, longitude: 12.4, speed: 0, angle: -10 },
      { timestamp: '2026-11-23T08:00:00Z', latitude: 40, longitude: 12, speed: 0 },
      { timestamp: 'x', latitude: 41, longitude: 12 },
      { timestamp: '2026-11-23T08:00:20Z', latitude: 0, longitude: 0 },
      { timestamp: '2026-11-23T08:00:30Z', latitude: 95, longitude: 12 },
      null,
    ];
    const points = normalizeHistory(rows);
    expect(points.map(x => x.t - T0)).toEqual([0, 10_000]);
    expect(points[0]).toMatchObject({ longitude: 12.4, latitude: 41.8, speedKmh: 0, heading: 350 });
    expect(points[1]).toMatchObject({ longitude: 12.5, latitude: 41.9, speedKmh: 30, heading: 90 });
  });
  it('accepts a {data} envelope and returns [] for garbage', () => {
    expect(normalizeHistory({ data: [{ timestamp: T0, latitude: 1, longitude: 1 }] })).toHaveLength(1);
    expect(normalizeHistory({ error: 'x' })).toEqual([]);
  });
});

describe('poseAt / trailUntil', () => {
  const track = [p(0, 12.0, 41.0), p(10, 12.1, 41.0), p(20, 12.1, 41.1)];
  it('interpolates linearly between points', () => {
    const pose = poseAt(track, T0 + 5_000)!;
    expect(pose.longitude).toBeCloseTo(12.05); expect(pose.latitude).toBeCloseTo(41.0);
    expect(pose.heading).toBeCloseTo(90, 0);
  });
  it('heads north on the northbound segment', () => {
    expect(poseAt(track, T0 + 15_000)!.heading).toBeCloseTo(0, 0);
  });
  it('clamps before the first and after the last point (never extrapolates)', () => {
    expect(poseAt(track, T0 - 60_000)).toMatchObject({ longitude: 12.0, latitude: 41.0 });
    expect(poseAt(track, T0 + 3_600_000)).toMatchObject({ longitude: 12.1, latitude: 41.1 });
  });
  it('waits at the last point across a recording gap', () => {
    const gapped = [p(0, 12, 41), p(MAX_GAP_MS / 1000 + 60, 13, 42)];
    expect(poseAt(gapped, T0 + 120_000)).toMatchObject({ longitude: 12, latitude: 41, speedKmh: 0 });
  });
  it('builds the trail up to t ending at the current pose', () => {
    const trail = trailUntil(track, T0 + 15_000);
    expect(trail).toHaveLength(3);
    expect(trail[2]!.latitude).toBeCloseTo(41.05);
    expect(trailUntil(track, T0 - 1)).toEqual([]);
  });
  it('indexAt uses binary search boundaries', () => {
    expect(indexAt(track, T0 - 1)).toBe(-1);
    expect(indexAt(track, T0)).toBe(0);
    expect(indexAt(track, T0 + 19_999)).toBe(1);
    expect(indexAt(track, T0 + 99_999)).toBe(2);
  });
  it('returns null on an empty track', () => { expect(poseAt([], T0)).toBeNull(); });
});

describe('findStops', () => {
  it('finds a stop longer than the minimum and ignores short ones', () => {
    const track = [p(0, 12, 41, 40), p(60, 12.01, 41, 0), p(120, 12.01, 41, 0), p(500, 12.01, 41, 0), p(560, 12.02, 41, 40), p(600, 12.03, 41, 0), p(660, 12.03, 41, 0), p(700, 12.04, 41, 40)];
    const stops = findStops(track);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ from: T0 + 60_000, to: T0 + 560_000, longitude: 12.01 });
  });
  it('treats a long recording gap as a stop (device asleep while parked)', () => {
    const track = [p(0, 12, 41, 40), p(3600, 12.2, 41, 40)];
    expect(findStops(track)).toEqual([{ from: T0, to: T0 + 3_600_000, longitude: 12, latitude: 41 }]);
  });
  it('closes a stop still open at the end of the day', () => {
    expect(findStops([p(0, 12, 41, 0), p(600, 12, 41, 0)])).toHaveLength(1);
  });
});

describe('dayRange', () => {
  it('returns the local day', () => {
    const r = dayRange('2026-11-23')!;
    expect(r.to - r.from).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect(new Date(r.from).getHours()).toBe(0);
  });
  it('rejects malformed input', () => { expect(dayRange('23/11/2026')).toBeNull(); });
});
