import type { MapSession } from '@3d-map/core';
import { createMapboxAreaWalls } from '@3d-map/mapbox';
import { AitrackError, areaFootprints, areaWalls, createAitrackClient, type Area } from '@3d-map/aitrack';
import { setControlDisabled, setControlPressed } from './ui-controls';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Aitrack geofences (API v3 beta) as translucent walls in the area's own color. */
export function mountAreas(map: MapSession, client: ReturnType<typeof createAitrackClient>, signal: AbortSignal, browse: () => void) {
  const state = el('areas-state');
  const walls = createMapboxAreaWalls(map, { heightM: 8, opacity: 0.55 });
  signal.addEventListener('abort', () => walls.destroy(), { once: true });
  let visible = true;
  let areas: Area[] = [];
  const frame = () => {
    const bounds = areas.map(area => area.bounds).filter(b => b && [b.south, b.west, b.north, b.east].every(Number.isFinite)) as NonNullable<Area['bounds']>[];
    if (!bounds.length) return;
    const south = Math.min(...bounds.map(b => b.south)), north = Math.max(...bounds.map(b => b.north));
    const west = Math.min(...bounds.map(b => b.west)), east = Math.max(...bounds.map(b => b.east));
    const latitude = (south + north) / 2, longitude = (west + east) / 2;
    const spanM = Math.max((north - south) * 111_320, (east - west) * 111_320 * Math.cos(latitude * Math.PI / 180), 60);
    const zoom = Math.max(3, Math.min(18, Math.log2(40_075_016 * Math.cos(latitude * Math.PI / 180) * 600 / 512 / spanM)));
    browse();
    map.setCamera({ ...map.getCamera(), center: { longitude, latitude }, zoom, pitch: 60 }, { animate: true });
  };
  el('toggle-areas').addEventListener('click', () => {
    visible = !visible; walls.setVisible(visible); setControlPressed('toggle-areas', visible);
  }, { signal });
  el('frame-areas').addEventListener('click', frame, { signal });
  void client.listAllAreas(signal).then(result => {
    if (signal.aborted) return;
    areas = result;
    walls.update(areaWalls(areas), areaFootprints(areas));
    state.textContent = areas.length ? `${areas.length} ${areas.length === 1 ? 'area' : 'aree'} (API v3 beta)` : 'Nessuna area configurata.';
    setControlDisabled('toggle-areas', !areas.length);
    setControlDisabled('frame-areas', !areas.length);
  }).catch(error => {
    if (signal.aborted) return;
    state.textContent = error instanceof AitrackError && error.code === 'INSUFFICIENT_SCOPE'
      ? 'Aree non visibili: la chiave API non ha il permesso read_areas.'
      : `Aree non disponibili: ${error instanceof Error ? error.message : 'errore sconosciuto'}.`;
  });
}
