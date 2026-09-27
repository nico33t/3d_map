import type { MapSession } from '@3d-map/core';
import type { GeoJSONSource } from 'mapbox-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import { sessions } from './internal.js';

export interface MapboxAreaWallsOptions {
  id?: string;
  /** Wall height in meters, default 8. */
  heightM?: number;
  /** Wall opacity 0–1, default 0.55. */
  opacity?: number;
}
export interface MapboxAreaWalls {
  /** Walls: thin polygons with a `color` property. Footprints: closed area outlines. */
  update(walls: FeatureCollection<Polygon>, footprints?: FeatureCollection<Polygon>): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const empty: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: [] };

/** Translucent extruded walls on area perimeters, colored per feature (`properties.color`). */
export function createMapboxAreaWalls(session: MapSession, options: MapboxAreaWallsOptions = {}): MapboxAreaWalls {
  const context = sessions.get(session);
  if (!context) throw new Error('An active Mapbox session is required.');
  const { map, disposers } = context;
  const height = options.heightM ?? 8;
  const opacity = options.opacity ?? 0.55;
  if (!Number.isFinite(height) || height <= 0 || height > 500) throw new RangeError('Invalid wall height.');
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('Invalid wall opacity.');
  const prefix = `areas-${options.id ?? 'aitrack'}`;
  const wallSource = `${prefix}-walls`, floorSource = `${prefix}-floor`;
  const layers = [`${prefix}-floor`, `${prefix}-walls`];
  if (map.getSource(wallSource) || map.getSource(floorSource)) throw new Error(`Area walls already mounted: ${prefix}`);
  const paintColor = ['coalesce', ['get', 'color'], '#3b82f6'];
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    disposers.delete(destroy);
    for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [wallSource, floorSource]) if (map.getSource(id)) map.removeSource(id);
  };
  try {
    map.addSource(floorSource, { type: 'geojson', data: empty });
    map.addSource(wallSource, { type: 'geojson', data: empty });
    map.addLayer({ id: layers[0]!, type: 'fill', source: floorSource,
      paint: { 'fill-color': paintColor as never, 'fill-opacity': 0.12, 'fill-emissive-strength': 0.6 },
    });
    map.addLayer({ id: layers[1]!, type: 'fill-extrusion', source: wallSource,
      paint: {
        'fill-extrusion-color': paintColor as never, 'fill-extrusion-height': height, 'fill-extrusion-base': 0,
        'fill-extrusion-opacity': opacity, 'fill-extrusion-emissive-strength': 0.7,
        'fill-extrusion-vertical-gradient': true,
      },
    });
    disposers.add(destroy);
  } catch (error) { destroy(); throw error; }
  return {
    update(walls, footprints = empty) {
      if (destroyed) throw new Error('Area walls have been destroyed.');
      (map.getSource(wallSource) as GeoJSONSource).setData(walls);
      (map.getSource(floorSource) as GeoJSONSource).setData(footprints);
    },
    setVisible(visible) {
      if (destroyed) return;
      for (const id of layers) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    },
    destroy,
  };
}
