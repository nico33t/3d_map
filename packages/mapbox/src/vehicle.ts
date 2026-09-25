import { validateCoordinates, type Coordinates, type MapSession } from '@3d-map/core';
import type { GeoJSONSource } from 'mapbox-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { sessions } from './internal.js';

export interface MapboxVehicleOptions {
  id: string;
  modelUrl: string;
  position: Coordinates;
  /** Visual scale multiplier; the supplied GLB should already use meters. */
  scale?: number;
  headingOffset?: number;
}

export interface MapboxVehicle {
  update(position: Coordinates, heading: number, trail: readonly Coordinates[]): void;
  destroy(): void;
}

/** Optional Mapbox extension. Assets and route logic remain engine-independent. */
export function createMapboxVehicle(session: MapSession, options: MapboxVehicleOptions): MapboxVehicle {
  const context = sessions.get(session);
  if (!context) throw new Error('An active Mapbox session is required.');
  const { map, disposers } = context;
  const scale = options.scale ?? 1;
  const offset = options.headingOffset ?? 0;
  if (!options.id.trim() || !options.modelUrl.trim()) throw new Error('Vehicle ID and model URL are required.');
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(offset)) throw new RangeError('Invalid vehicle scale or heading offset.');
  validateCoordinates(options.position);
  const prefix = `vehicle-${options.id}`;
  const modelId = `${prefix}-asset`;
  const pointId = `${prefix}-point`;
  const trailId = `${prefix}-trail`;
  const glowId = `${prefix}-glow`;
  const routeData = (trail: readonly Coordinates[]): FeatureCollection => ({
    type: 'FeatureCollection',
    features: trail.length < 2 ? [] : [{ type: 'Feature', properties: {}, geometry: {
      type: 'LineString', coordinates: trail.map((p) => [p.longitude, p.latitude]),
    } }],
  });
  const pointData = (p: Coordinates): Feature<Point> => ({
    type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
  });
  if (map.getSource(pointId) || map.getSource(trailId) || map.getLayer(prefix) || map.listModels().includes(modelId)) {
    throw new Error(`Vehicle ID already mounted: ${options.id}`);
  }
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    disposers.delete(destroy);
    for (const id of [prefix, trailId, glowId]) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [pointId, trailId]) if (map.getSource(id)) map.removeSource(id);
    if (map.hasModel(modelId)) map.removeModel(modelId);
  };
  try {
    map.addModel(modelId, options.modelUrl);
    map.addSource(pointId, { type: 'geojson', data: pointData(options.position) });
    map.addSource(trailId, { type: 'geojson', lineMetrics: true, data: routeData([]) });
    map.addLayer({ id: glowId, type: 'line', source: trailId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#16b8ff', 'line-width': 15, 'line-blur': 7, 'line-opacity': 0.45 },
    });
    map.addLayer({ id: trailId, type: 'line', source: trailId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 5, 'line-emissive-strength': 1,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#1678c2', 1, '#5cf5ff'],
      },
    });
    map.addLayer({ id: prefix, type: 'model', source: pointId,
      layout: { 'model-id': modelId },
      paint: { 'model-scale': [scale, scale, scale], 'model-rotation': [0, 0, offset],
        'model-rotation-transition': { duration: 0 }, 'model-cast-shadows': true,
        'model-emissive-strength': 0.15,
      },
    });
    disposers.add(destroy);
  } catch (error) { destroy(); throw error; }
  return {
    update(position, heading, trail) {
      if (destroyed) throw new Error('Vehicle has been destroyed.');
      validateCoordinates(position);
      if (!Number.isFinite(heading)) throw new RangeError('Heading must be finite.');
      trail.forEach(validateCoordinates);
      (map.getSource(pointId) as GeoJSONSource).setData(pointData(position));
      (map.getSource(trailId) as GeoJSONSource).setData(routeData(trail));
      map.setPaintProperty(prefix, 'model-rotation', [0, 0, heading + offset]);
    },
    destroy,
  };
}
