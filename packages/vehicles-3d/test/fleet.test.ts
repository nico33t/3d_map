import { expect, it } from 'vitest';
import { createFleetAssignments } from '../src/index.js';
it('persists independent model assignments across instances', () => {
  let value: string | null = null;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  const fleet = createFleetAssignments(storage);
  fleet.set('000000000000001', 'audi-a1-quattro');
  fleet.set('000000000000002', 'kenney-suv');
  const restored = createFleetAssignments(storage);
  expect(restored.get('000000000000001')).toBe('audi-a1-quattro');
  expect(restored.get('000000000000002')).toBe('kenney-suv');
  expect(restored.get('000000000000003')).toBeUndefined();
});
it('ignores invalid persisted data and reports failed writes without losing the session assignment', () => {
  const fleet = createFleetAssignments({ getItem: () => '{"__proto__":"kenney-suv","000000000000001":"missing"}', setItem: () => { throw new Error('quota'); } });
  expect(fleet.get('000000000000001')).toBeUndefined();
  expect(fleet.set('000000000000001', 'kenney-van')).toBe(false);
  expect(fleet.get('000000000000001')).toBe('kenney-van');
  expect(() => fleet.set('invalid', 'kenney-van')).toThrow();
});
