import { describe, expect, it } from 'vitest';
import { fleetFeatures } from '../src/fleet.js';

describe('fleetFeatures', () => {
  it('keeps valid points with their state and label', () => {
    const result = fleetFeatures([{ id: 'a', longitude: 12.5, latitude: 41.9, label: 'Furgone', state: 'moving', heading: 90 }]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.geometry.coordinates).toEqual([12.5, 41.9]);
    expect(result.features[0]!.properties).toEqual({ id: 'a', label: 'Furgone', state: 'moving', heading: 90 });
  });
  it('skips invalid coordinates, duplicates and the hidden point', () => {
    const result = fleetFeatures([
      { id: 'a', longitude: 12, latitude: 41, label: 'A', state: 'stopped' },
      { id: 'a', longitude: 13, latitude: 42, label: 'A bis', state: 'stopped' },
      { id: 'b', longitude: Number.NaN, latitude: 41, label: 'B', state: 'stale' },
      { id: 'c', longitude: 12, latitude: 89, label: 'C', state: 'stale' },
      { id: 'd', longitude: 12, latitude: 41, label: 'D', state: 'moving' },
      { id: '', longitude: 12, latitude: 41, label: 'vuoto', state: 'moving' },
    ], 'd');
    expect(result.features.map(f => f.properties!.id)).toEqual(['a']);
  });
  it('defaults a missing heading to 0', () => {
    expect(fleetFeatures([{ id: 'a', longitude: 0, latitude: 0, label: '', state: 'stale' }]).features[0]!.properties!.heading).toBe(0);
  });
});
