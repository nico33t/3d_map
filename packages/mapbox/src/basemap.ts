import type { MapSession } from '@3d-map/core';
import { sessions } from './internal.js';

export type MapboxBasemap = 'standard' | 'hybrid';
/** Updates only the basemap import; custom vehicle layers and model assets stay mounted. */
export async function setMapboxBasemap(session: MapSession, basemap: MapboxBasemap, signal?: AbortSignal): Promise<void> {
  const context = sessions.get(session);
  if (!context) throw new Error('An active Mapbox session is required.');
  signal?.throwIfAborted();
  const { map, disposers } = context;
  const url = basemap === 'hybrid' ? 'mapbox://styles/mapbox/standard-satellite' : 'mapbox://styles/mapbox/standard';
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      map.off('style.import.load', loaded);
      map.off('error', failed);
      signal?.removeEventListener('abort', aborted);
      disposers.delete(removed);
    };
    const loaded = () => { cleanup(); resolve(); };
    const failed = (event: { error: Error }) => { cleanup(); reject(event.error); };
    const aborted = () => { cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    const removed = () => { cleanup(); reject(new Error('Map session destroyed during style change.')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Caricamento della mappa scaduto.')); }, 30_000);
    map.on('style.import.load', loaded);
    map.on('error', failed);
    signal?.addEventListener('abort', aborted, { once: true });
    disposers.add(removed);
    try { map.updateImport('basemap', url); } catch (error) { cleanup(); reject(error); }
  });
}
