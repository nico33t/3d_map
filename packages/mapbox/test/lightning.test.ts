// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createLightningEffect } from '../src/lightning.js';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function setup(reduced = false) {
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const container = document.createElement('div'); document.body.append(container);
  return { container, effect: createLightningEffect(container) };
}
it('draws lightning only when enabled and cancels all effects on stop and disposal', () => {
  const { container, effect } = setup();
  expect(container.querySelectorAll('path')).toHaveLength(0);
  effect.setEnabled(true); vi.advanceTimersByTime(800);
  expect(container.querySelectorAll('path')).toHaveLength(3);
  effect.setEnabled(false); vi.advanceTimersByTime(20000);
  expect(container.querySelectorAll('path')).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  effect.setEnabled(true); effect.destroy(); effect.destroy();
  expect(container.children).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('suppresses flashes for reduced motion preferences', () => {
  const { container, effect } = setup(true);
  effect.setEnabled(true); vi.advanceTimersByTime(20000);
  expect(container.querySelectorAll('path')).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  effect.destroy();
});
