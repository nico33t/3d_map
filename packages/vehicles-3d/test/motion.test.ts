import { expect, it } from 'vitest';
import { createVehicleMotion } from '../src/index.js';

it('places the first fix immediately, interpolates position with immediate heading, and stops at the fix', () => {
  const motion = createVehicleMotion();
  expect(motion.target({ longitude: 12, latitude: 42, heading: 350 })).toEqual({ longitude: 12, latitude: 42, heading: 350 });
  expect(motion.target({ longitude: 14, latitude: 44, heading: 10 }, 10000)).toEqual({ longitude: 12, latitude: 42, heading: 10 });
  expect(motion.advance(5000)).toEqual({ longitude: 13, latitude: 43, heading: 10 });
  expect(motion.active).toBe(true);
  expect(motion.advance(10000)).toEqual({ longitude: 14, latitude: 44, heading: 10 });
  expect(motion.active).toBe(false);
  expect(motion.advance(100000)?.longitude).toBe(14);
});
it('retargets without a jump and supports paused clocks and reset on vehicle changes', () => {
  const motion = createVehicleMotion();
  motion.target({ longitude: 0, latitude: 0, heading: 0 });
  motion.target({ longitude: 2, latitude: 2, heading: 90 }, 10000);
  const shown = motion.advance(3000);
  expect(motion.advance(0)).toEqual(shown);
  expect(motion.target({ longitude: 3, latitude: 3, heading: 180 }, 5000)).toEqual({ ...shown, heading: 180 });
  expect(motion.advance(5000)).toEqual({ longitude: 3, latitude: 3, heading: 180 });
  motion.reset();
  expect(motion.advance(10)).toBeUndefined();
  expect(motion.active).toBe(false);
  expect(motion.target({ longitude: 20, latitude: 40, heading: 0 }).longitude).toBe(20);
});
it('crosses the antimeridian on the short path and rejects invalid inputs', () => {
  const motion = createVehicleMotion();
  motion.target({ longitude: 179, latitude: 0, heading: 0 });
  motion.target({ longitude: -179, latitude: 0, heading: 0 }, 1000);
  expect(Math.abs(motion.advance(500)!.longitude)).toBe(180);
  expect(() => motion.advance(-1)).toThrow();
  expect(() => motion.target({ longitude: NaN, latitude: 0, heading: 0 })).toThrow();
});

it('updates direction immediately even when the position has not changed', () => {
  const motion = createVehicleMotion();
  motion.target({ longitude: 12, latitude: 42, heading: 0 });
  expect(motion.target({ longitude: 12, latitude: 42, heading: 270 }, 10000)).toEqual({ longitude: 12, latitude: 42, heading: 270 });
  expect(motion.active).toBe(false);
});
