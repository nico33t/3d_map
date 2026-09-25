export { createLightningEffect, type LightningEffect } from './lightning.js';
export { setMapboxBasemap, type MapboxBasemap } from './basemap.js';
import {
  validateCamera, validateMarkers,
  type Camera, type MapEvents, type MapProvider, type MapSession,
} from '@3d-map/core';
import type { Map as MapboxMap, Marker as MapboxMarker } from 'mapbox-gl';
import { sessions } from './internal.js';
export { createMapboxVehicle, type MapboxVehicleOptions, type MapboxVehicle } from './vehicle.js';
export { setMapboxEnvironment, type LightPreset } from './environment.js';

export interface MapboxProviderOptions {
  accessToken: string;
  style?: string;
  /** Maximum time to wait for the initial style, default 30 seconds. */
  loadTimeoutMs?: number;
}

function readCamera(map: MapboxMap): Camera {
  const center = map.getCenter();
  return {
    center: { longitude: ((center.lng + 180) % 360 + 360) % 360 - 180, latitude: center.lat },
    zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
  };
}

export function createMapboxProvider(options: MapboxProviderOptions): MapProvider {
  const { accessToken, style = 'mapbox://styles/mapbox/standard', loadTimeoutMs = 30_000 } = options;
  if (!accessToken.trim()) throw new Error('A Mapbox public access token is required.');
  if (!Number.isFinite(loadTimeoutMs) || loadTimeoutMs <= 0) throw new RangeError('loadTimeoutMs must be positive.');

  return {
    id: 'mapbox',
    async mount({ container, camera, signal }) {
      validateCamera(camera);
      signal?.throwIfAborted();
      // Lazy loading keeps imports safe in SSR and avoids loading unused engines.
      const { default: mapboxgl } = await import('mapbox-gl');
      signal?.throwIfAborted();
      const map = new mapboxgl.Map({
        container, accessToken,
        style: { version: 8, sources: {}, layers: [], imports: [{ id: 'basemap', url: style }] },
        center: [camera.center.longitude, camera.center.latitude],
        zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch,
        minZoom: 0, maxZoom: 22, maxPitch: 85,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            map.off('load', onLoad);
            map.off('error', onError);
            signal?.removeEventListener('abort', onAbort);
          };
          const onLoad = () => { cleanup(); resolve(); };
          const onError = (event: { error: Error }) => { cleanup(); reject(event.error); };
          const onAbort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
          const timer = setTimeout(() => { cleanup(); reject(new Error('Mapbox initialization timed out.')); }, loadTimeoutMs);
          map.on('load', onLoad);
          map.on('error', onError);
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) onAbort();
          else if (map.loaded()) onLoad();
        });
      } catch (error) {
        map.remove();
        throw error;
      }

      let destroyed = false;
      const disposers = new Set<() => void>();
      const markers = new Map<string, { marker: MapboxMarker; dispose: () => void }>();
      const listeners = new Map<keyof MapEvents, Set<(value: never) => void>>();
      const assertActive = () => { if (destroyed) throw new Error('Map session has been destroyed.'); };
      const emit = <K extends keyof MapEvents>(event: K, value: MapEvents[K]) => {
        for (const listener of [...(listeners.get(event) ?? [])]) listener(value as never);
      };
      map.on('moveend', () => emit('cameraChange', readCamera(map)));
      map.on('click', (event) => emit('click', {
        longitude: ((event.lngLat.lng + 180) % 360 + 360) % 360 - 180,
        latitude: event.lngLat.lat,
      }));
      map.on('error', (event) => emit('error', event.error));

      const session: MapSession = {
        getCamera() { assertActive(); return readCamera(map); },
        setCamera(next, { animate = false } = {}) {
          assertActive();
          validateCamera(next);
          const target = {
            center: [next.center.longitude, next.center.latitude] as [number, number],
            zoom: next.zoom, bearing: next.bearing, pitch: next.pitch,
          };
          if (animate) map.flyTo(target);
          else map.jumpTo(target);
        },
        setMarkers(next) {
          assertActive();
          validateMarkers(next);
          const keep = new Set(next.map(({ id }) => id));
          for (const [id, entry] of markers) {
            if (!keep.has(id)) { entry.dispose(); markers.delete(id); }
          }
          for (const item of next) {
            const existing = markers.get(item.id);
            if (existing) {
              existing.marker.setLngLat([item.position.longitude, item.position.latitude]);
              existing.marker.getElement().textContent = item.label;
              continue;
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'map3d-marker';
            button.textContent = item.label;
            const onClick = (event: MouseEvent) => { event.stopPropagation(); emit('markerClick', { id: item.id }); };
            button.addEventListener('click', onClick);
            const marker = new mapboxgl.Marker({ element: button })
              .setLngLat([item.position.longitude, item.position.latitude]).addTo(map);
            markers.set(item.id, { marker, dispose: () => {
              button.removeEventListener('click', onClick);
              marker.remove();
            } });
          }
        },
        on(event, listener) {
          assertActive();
          let bucket = listeners.get(event);
          if (!bucket) { bucket = new Set(); listeners.set(event, bucket); }
          const callback = listener as (value: never) => void;
          bucket.add(callback);
          return () => { bucket.delete(callback); };
        },
        resize() { assertActive(); map.resize(); },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          for (const dispose of disposers) dispose();
          disposers.clear();
          sessions.delete(session);
          signal?.removeEventListener('abort', onSessionAbort);
          for (const entry of markers.values()) entry.dispose();
          markers.clear();
          listeners.clear();
          map.remove();
        },
      };
      const onSessionAbort = () => session.destroy();
      sessions.set(session, { map, disposers });
      signal?.addEventListener('abort', onSessionAbort, { once: true });
      if (signal?.aborted) {
        session.destroy();
        signal.throwIfAborted();
      }
      return session;
    },
  };
}
