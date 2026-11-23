import { describe, expect, it } from 'vitest';
import { normalizeLiveRows } from '../src/live';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const row = (extra: Record<string, unknown> = {}) => ({ imei: '000000000000001', name: 'Furgone 1', targa: 'XX000XX', latitude: 41.9, longitude: 12.5, heading: 90, speed: 40, timestamp: '2026-11-23T11:59:30Z', telefono: 'non deve servire', ...extra });

describe('normalizeLiveRows', () => {
  it('reads the plain array and the paginated envelope', () => {
    expect(normalizeLiveRows([row()], NOW)).toHaveLength(1);
    expect(normalizeLiveRows({ data: [row()], page: 1, limit: 50, count: 1 }, NOW)).toHaveLength(1);
  });
  it('maps fields and classifies state', () => {
    const [v] = normalizeLiveRows([row()], NOW);
    expect(v).toEqual({ imei: '000000000000001', name: 'Furgone 1', plate: 'XX000XX', longitude: 12.5, latitude: 41.9, heading: 90, speedKmh: 40, recordedAt: '2026-11-23T11:59:30.000Z', state: 'moving' });
    expect(normalizeLiveRows([row({ speed: 0 })], NOW)[0]!.state).toBe('stopped');
    expect(normalizeLiveRows([row({ timestamp: '2026-11-23T10:00:00Z' })], NOW)[0]!.state).toBe('stale');
  });
  it('accepts numbers as strings (database decimals)', () => {
    expect(normalizeLiveRows([row({ latitude: '41.9', longitude: '12.5', speed: '12' })], NOW)[0]).toMatchObject({ latitude: 41.9, longitude: 12.5, speedKmh: 12 });
  });
  it('skips rows without a usable position or time, and duplicates', () => {
    const rows = [row(), row(), row({ imei: '2', latitude: null }), row({ imei: '3', latitude: 0, longitude: 0 }), row({ imei: '4', timestamp: null }), row({ imei: '5', latitude: 91 }), row({ imei: '' }), null, 'x'];
    expect(normalizeLiveRows(rows, NOW).map(v => v.imei)).toEqual(['000000000000001']);
  });
  it('gives a name to unnamed mezzi and wraps the heading', () => {
    expect(normalizeLiveRows([row({ name: ' ', heading: -90 })], NOW)[0]).toMatchObject({ name: 'Mezzo 0001', heading: 270 });
  });
  it('returns an empty list for unexpected bodies', () => {
    expect(normalizeLiveRows(null)).toEqual([]);
    expect(normalizeLiveRows({ error: 'x' })).toEqual([]);
  });
});

import { createFleetState, mergeFleet, MAX_MISSES, type LiveVehicle } from '../src/live';

const v = (imei: string, recordedAt = '2026-11-23T12:00:00.000Z', longitude = 12): LiveVehicle => ({ imei, name: imei, plate: '', longitude, latitude: 41, heading: 0, speedKmh: 0, recordedAt, state: 'stopped' });

describe('mergeFleet', () => {
  it('keeps a vehicle missing from one poll (page shift) and drops it after MAX_MISSES', () => {
    const state = createFleetState();
    mergeFleet(state, [v('a'), v('b')]);
    for (let i = 1; i < MAX_MISSES; i++) expect(mergeFleet(state, [v('a')]).map(x => x.imei).sort()).toEqual(['a', 'b']);
    expect(mergeFleet(state, [v('a')]).map(x => x.imei)).toEqual(['a']);
  });
  it('resets the miss counter when the vehicle comes back', () => {
    const state = createFleetState();
    mergeFleet(state, [v('a'), v('b')]);
    mergeFleet(state, [v('a')]); mergeFleet(state, [v('a'), v('b')]);
    for (let i = 1; i < MAX_MISSES; i++) mergeFleet(state, [v('a')]);
    expect(mergeFleet(state, []).length).toBe(1); // a: 1 miss, b: dropped now
  });
  it('never replaces a newer point with an older one (cached page)', () => {
    const state = createFleetState();
    mergeFleet(state, [v('a', '2026-11-23T12:00:10.000Z', 13)]);
    expect(mergeFleet(state, [v('a', '2026-11-23T12:00:00.000Z', 12)])[0]!.longitude).toBe(13);
  });
  it('survives a 450-vehicle fleet whose order changes between pages', () => {
    const state = createFleetState();
    const fleet = Array.from({ length: 450 }, (_, i) => v(String(i)));
    mergeFleet(state, fleet);
    // A reshuffle makes pages 1-3 skip 30 vehicles and repeat others.
    const shifted = [...fleet.slice(30), ...fleet.slice(30, 60)];
    expect(mergeFleet(state, shifted)).toHaveLength(450);
  });
});
