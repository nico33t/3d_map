import { describe, expect, it, vi } from 'vitest';
import { createMap, DEFAULT_CAMERA, validateCamera, validateMarkers, type MapProvider } from '../src/index.js';

describe('portable map contract', () => {
  it('rejects invalid cameras before invoking the provider', async () => {
    const mount = vi.fn();
    const provider: MapProvider = { id: 'test', mount };
    await expect(createMap(provider, { container: {} as HTMLElement, camera: { ...DEFAULT_CAMERA, zoom: NaN } })).rejects.toThrow(RangeError);
    expect(mount).not.toHaveBeenCalled();
    expect(() => validateCamera({ ...DEFAULT_CAMERA, center: { longitude: 190, latitude: 0 } })).toThrow(RangeError);
    expect(() => validateCamera({ ...DEFAULT_CAMERA, pitch: 90 })).toThrow(RangeError);
  });

  it('accepts a different provider without importing Mapbox', async () => {
    const session = { destroy: vi.fn() };
    const mount = vi.fn().mockResolvedValue(session);
    const result = await createMap({ id: 'alternative', mount }, { container: {} as HTMLElement, camera: DEFAULT_CAMERA });
    expect(result).toBe(session);
  });

  it('does not mount after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const mount = vi.fn();
    await expect(createMap({ id: 'test', mount }, {
      container: {} as HTMLElement, camera: DEFAULT_CAMERA, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mount).not.toHaveBeenCalled();
  });

  it('rejects duplicate IDs and invalid marker coordinates', () => {
    const marker = { id: 'rome', label: 'Roma', position: DEFAULT_CAMERA.center };
    expect(() => validateMarkers([marker, marker])).toThrow('unique');
    expect(() => validateMarkers([{ ...marker, position: { longitude: 0, latitude: Infinity } }])).toThrow(RangeError);
  });
});
