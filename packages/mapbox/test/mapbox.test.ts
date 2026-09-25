// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAMERA } from '@3d-map/core';
import { createMapboxProvider, createMapboxVehicle, setMapboxEnvironment, setMapboxBasemap } from '../src/index.js';

const sdk = vi.hoisted(() => {
  class FakeMap {
    static instances: FakeMap[] = [];
    handlers = new Map<string, Set<(event?: any) => void>>();
    remove = vi.fn();
    resize = vi.fn();
    jumpTo = vi.fn();
    flyTo = vi.fn();
    setConfigProperty = vi.fn();
    setRain = vi.fn();
    updateImport = vi.fn();
    setPaintProperty = vi.fn();
    sources = new Map<string, any>();
    layers = new Map<string, any>();
    models = new Set<string>();
    getSource(id: string) { return this.sources.get(id); }
    addSource(id: string, options: any) { this.sources.set(id, { ...options, setData: vi.fn() }); }
    removeSource(id: string) { this.sources.delete(id); }
    getLayer(id: string) { return this.layers.get(id); }
    addLayer(layer: any) { this.layers.set(layer.id, layer); }
    removeLayer(id: string) { this.layers.delete(id); }
    addModel(id: string) { this.models.add(id); }
    listModels() { return [...this.models]; }
    hasModel(id: string) { return this.models.has(id); }
    removeModel(id: string) { this.models.delete(id); }
    constructor(public options: any) { FakeMap.instances.push(this); }
    on(type: string, callback: (event?: any) => void) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type)!.add(callback);
    }
    off(type: string, callback: (event?: any) => void) { this.handlers.get(type)?.delete(callback); }
    emit(type: string, event?: any) { for (const callback of [...(this.handlers.get(type) ?? [])]) callback(event); }
    loaded() { return false; }
    getCenter() { return { lng: this.options.center[0], lat: this.options.center[1] }; }
    getZoom() { return this.options.zoom; }
    getBearing() { return this.options.bearing; }
    getPitch() { return this.options.pitch; }
  }
  class FakeMarker {
    static instances: FakeMarker[] = [];
    remove = vi.fn();
    setLngLat = vi.fn().mockReturnThis();
    addTo = vi.fn().mockReturnThis();
    constructor(public options: { element: HTMLElement }) { FakeMarker.instances.push(this); }
    getElement() { return this.options.element; }
  }
  return { Map: FakeMap, Marker: FakeMarker };
});

vi.mock('mapbox-gl', () => ({ default: sdk }));

async function begin(signal?: AbortSignal, timeout = 1000) {
  const promise = createMapboxProvider({ accessToken: 'pk.test', loadTimeoutMs: timeout }).mount({
    container: document.createElement('div'), camera: DEFAULT_CAMERA, ...(signal ? { signal } : {}),
  });
  // Drain the lazy SDK import before manually delivering SDK events.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return { promise, native: sdk.Map.instances.at(-1)! };
}

beforeEach(() => { sdk.Map.instances.length = 0; sdk.Marker.instances.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('Mapbox adapter lifecycle', () => {
  it('updates the vehicle and its traveled trail, then cleans up with the session', async () => {
    const { promise, native } = await begin(); native.emit('load'); const map = await promise;
    const car = createMapboxVehicle(map, { id: 'test', modelUrl: '/car.glb', position: DEFAULT_CAMERA.center });
    const target = { longitude: 12.49, latitude: 41.89 };
    car.update(target, 90, [DEFAULT_CAMERA.center, target]);
    expect(native.getSource('vehicle-test-point').setData).toHaveBeenCalledWith(expect.objectContaining({ geometry: { type: 'Point', coordinates: [12.49, 41.89] } }));
    expect(native.getSource('vehicle-test-trail').setData.mock.calls[0][0].features[0].geometry.coordinates).toHaveLength(2);
    expect(() => createMapboxVehicle(map, { id: 'test', modelUrl: '/car.glb', position: target })).toThrow('already mounted');
    map.destroy();
    expect(native.sources.size).toBe(0); expect(native.layers.size).toBe(0); expect(native.models.size).toBe(0);
    expect(() => car.update(target, 90, [])).toThrow('destroyed');
  });

  it('toggles native rain and Standard lighting without replacing the style', async () => {
    const { promise, native } = await begin(); native.emit('load'); const map = await promise;
    setMapboxEnvironment(map, { light: 'night', rain: true });
    expect(native.setConfigProperty).toHaveBeenCalledWith('basemap', 'lightPreset', 'night');
    expect(native.setRain).toHaveBeenCalledWith(expect.objectContaining({ intensity: 1 }));
    setMapboxEnvironment(map, { rain: false });
    expect(native.setRain).toHaveBeenLastCalledWith(null);
    map.destroy();
    expect(() => setMapboxEnvironment(map, { light: 'day' })).toThrow('active');
  });

  it('maps camera commands, forwards events and unsubscribes', async () => {
    const { promise, native } = await begin();
    native.emit('load');
    const map = await promise;
    expect(map.getCamera().center.longitude).toBeCloseTo(DEFAULT_CAMERA.center.longitude);
    expect(native.options.accessToken).toBe('pk.test');
    map.setCamera(DEFAULT_CAMERA);
    map.setCamera(DEFAULT_CAMERA, { animate: true });
    expect(native.jumpTo).toHaveBeenCalledOnce();
    expect(native.flyTo).toHaveBeenCalledOnce();
    const change = vi.fn();
    const off = map.on('cameraChange', change);
    native.emit('moveend');
    off();
    native.emit('moveend');
    expect(change).toHaveBeenCalledOnce();
    const error = vi.fn();
    map.on('error', error);
    const failure = new Error('tile unavailable');
    native.emit('error', { error: failure });
    expect(error).toHaveBeenCalledWith(failure);
    map.destroy();
    map.destroy();
    expect(native.remove).toHaveBeenCalledOnce();
    expect(() => map.resize()).toThrow('destroyed');
  });

  it('reconciles markers, keeps labels as text and removes click listeners', async () => {
    const { promise, native } = await begin();
    native.emit('load');
    const map = await promise;
    const selected = vi.fn();
    map.on('markerClick', selected);
    const item = { id: 'rome', label: '<b>Roma</b>', position: DEFAULT_CAMERA.center };
    map.setMarkers([item]);
    const marker = sdk.Marker.instances[0]!;
    expect(marker.getElement().querySelector('b')).toBeNull();
    marker.getElement().click();
    expect(selected).toHaveBeenCalledWith({ id: 'rome' });
    map.setMarkers([{ ...item, label: 'Roma aggiornata' }]);
    expect(sdk.Marker.instances).toHaveLength(1);
    expect(marker.getElement().textContent).toBe('Roma aggiornata');
    expect(() => map.setMarkers([item, item])).toThrow('unique');
    expect(marker.remove).not.toHaveBeenCalled();
    map.setMarkers([]);
    marker.getElement().click();
    expect(selected).toHaveBeenCalledOnce();
    expect(marker.remove).toHaveBeenCalledOnce();
    map.destroy();
  });

  it('releases an initializing map when aborted', async () => {
    const controller = new AbortController();
    const { promise, native } = await begin(controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    expect(native.remove).toHaveBeenCalledOnce();
    expect(native.handlers.get('load')?.size).toBe(0);
  });

  it('disposes an already mounted map on abort', async () => {
    const controller = new AbortController();
    const { promise, native } = await begin(controller.signal);
    native.emit('load');
    const map = await promise;
    controller.abort();
    expect(native.remove).toHaveBeenCalledOnce();
    expect(() => map.getCamera()).toThrow('destroyed');
  });

  it('cleans up on initial SDK failure', async () => {
    const { promise, native } = await begin();
    const rejection = expect(promise).rejects.toThrow('unauthorized');
    native.emit('error', { error: new Error('unauthorized') });
    await rejection;
    expect(native.remove).toHaveBeenCalledOnce();
  });

  it('times out and removes a map that never loads', async () => {
    vi.useFakeTimers();
    const { promise, native } = await begin(undefined, 50);
    const rejection = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(native.remove).toHaveBeenCalledOnce();
  });

  it('keeps independent instances alive when another is destroyed', async () => {
    const first = await begin();
    const second = await begin();
    first.native.emit('load'); second.native.emit('load');
    const one = await first.promise;
    const two = await second.promise;
    one.destroy();
    expect(second.native.remove).not.toHaveBeenCalled();
    two.resize();
    expect(second.native.resize).toHaveBeenCalledOnce();
    two.destroy();
  });
});


it('waits for a hybrid style, cleans listeners, and can switch back', async () => {
  const { promise, native } = await begin(); native.emit('load'); const map = await promise;
  const vehicle = createMapboxVehicle(map, { id: 'persistent', modelUrl: '/car.glb', position: DEFAULT_CAMERA.center });
  const change = setMapboxBasemap(map, 'hybrid');
  expect(native.updateImport).toHaveBeenLastCalledWith('basemap', 'mapbox://styles/mapbox/standard-satellite');
  native.emit('style.import.load'); await change;
  expect(native.hasModel('vehicle-persistent-asset')).toBe(true);
  vehicle.update(DEFAULT_CAMERA.center, 30, []);
  expect(native.handlers.get('style.import.load')?.size).toBe(0);
  const back = setMapboxBasemap(map, 'standard');
  native.emit('style.import.load'); await back;
  expect(native.updateImport).toHaveBeenLastCalledWith('basemap', 'mapbox://styles/mapbox/standard');
  map.destroy();
});
it('rejects an interrupted style change and releases listeners', async () => {
  const { promise, native } = await begin(); native.emit('load'); const map = await promise;
  const abort = new AbortController();
  const change = setMapboxBasemap(map, 'hybrid', abort.signal);
  abort.abort();
  await expect(change).rejects.toThrow();
  expect(native.handlers.get('style.import.load')?.size).toBe(0);
  const pending = setMapboxBasemap(map, 'standard');
  map.destroy();
  await expect(pending).rejects.toThrow('destroyed');
});
