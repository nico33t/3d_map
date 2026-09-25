import { expect, it } from 'vitest';
import { createVehicleRoute } from '../src/index.js';

it('moves at distance-based speed and retains only the traveled route as its trail', () => {
  const route = createVehicleRoute([[0, 0], [0, 0.001], [0.001, 0.001]]);
  const halfway = route.sample(route.totalMeters * 0.75);
  expect(halfway.trail).toHaveLength(3);
  expect(halfway.position[0]).toBeCloseTo(0.0005, 6);
  expect(halfway.heading).toBeCloseTo(90, 2);
  expect(halfway.finished).toBe(false);
  expect(() => route.sample(Infinity)).toThrow(RangeError);
});

it('clamps the start/end and supports a clean restart', () => {
  const route = createVehicleRoute([[12, 41], [12, 41.001]]);
  expect(route.sample(-10).position).toEqual([12, 41]);
  expect(route.sample(route.totalMeters + 10).finished).toBe(true);
  expect(route.sample(0).traveled).toBe(0);
  expect(() => route.sample(NaN)).toThrow(RangeError);
  expect(() => createVehicleRoute([[12, 41], [12, 41]])).toThrow();
});
