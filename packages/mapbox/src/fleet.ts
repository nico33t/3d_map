import type { MapSession } from '@3d-map/core';
import type { GeoJSONSource, MapMouseEvent } from 'mapbox-gl';
import type { FeatureCollection, Point } from 'geojson';
import { sessions } from './internal.js';

export type FleetPointState = 'moving' | 'stopped' | 'stale';

export interface FleetPoint {
  id: string;
  longitude: number;
  latitude: number;
  label: string;
  state: FleetPointState;
  heading?: number;
}

export interface MapboxFleetLayerOptions {
  id?: string;
  /** Called with the point id when a point is clicked. */
  onSelect?: (id: string) => void;
  /** Colors per state. */
  colors?: Partial<Record<FleetPointState, string>>;
}

export interface MapboxFleetLayer {
  update(points: readonly FleetPoint[]): void;
  /** Hides one point (e.g. the one drawn as a 3D model). */
  setHidden(id: string | null): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const DEFAULT_COLORS: Record<FleetPointState, string> = { moving: '#16a34a', stopped: '#2563eb', stale: '#9ca3af' };

/** Converts points to GeoJSON, skipping invalid coordinates. Pure: unit tested. */
export function fleetFeatures(points: readonly FleetPoint[], hidden: string | null = null): FeatureCollection<Point> {
  const features: FeatureCollection<Point>['features'] = [];
  const seen = new Set<string>();
  for (const point of points) {
    if (!point.id || seen.has(point.id) || point.id === hidden) continue;
    if (!Number.isFinite(point.longitude) || !Number.isFinite(point.latitude) || Math.abs(point.longitude) > 180 || Math.abs(point.latitude) > 85.051129) continue;
    seen.add(point.id);
    features.push({
      type: 'Feature', id: features.length,
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      properties: { id: point.id, label: point.label, state: point.state, heading: Number.isFinite(point.heading) ? point.heading : 0 },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Many vehicles as one GeoJSON source (thousands stay fast, unlike DOM markers):
 * colored circles by state, labels from zoom 13.
 */
export function createMapboxFleetLayer(session: MapSession, options: MapboxFleetLayerOptions = {}): MapboxFleetLayer {
  const context = sessions.get(session);
  if (!context) throw new Error('An active Mapbox session is required.');
  const { map, disposers } = context;
  const prefix = `fleet-${options.id ?? 'live'}`;
  const source = prefix, circles = `${prefix}-circles`, labels = `${prefix}-labels`;
  if (map.getSource(source)) throw new Error(`Fleet layer already mounted: ${prefix}`);
  const colors = { ...DEFAULT_COLORS, ...options.colors };
  let points: readonly FleetPoint[] = [];
  let hidden: string | null = null;
  let destroyed = false;
  const click = (event: MapMouseEvent) => {
    const id = event.features?.[0]?.properties?.id;
    if (typeof id === 'string') options.onSelect?.(id);
  };
  const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const leave = () => { map.getCanvas().style.cursor = ''; };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    disposers.delete(destroy);
    map.off('click', circles, click); map.off('mouseenter', circles, enter); map.off('mouseleave', circles, leave);
    for (const id of [labels, circles]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(source)) map.removeSource(source);
  };
  try {
    map.addSource(source, { type: 'geojson', data: fleetFeatures([]) });
    map.addLayer({
      id: circles, type: 'circle', source, slot: 'top',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 12, 6, 17, 9],
        'circle-color': ['match', ['get', 'state'], 'moving', colors.moving, 'stopped', colors.stopped, colors.stale],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-emissive-strength': 1,
      },
    } as never);
    map.addLayer({
      id: labels, type: 'symbol', source, slot: 'top', minzoom: 13,
      layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5, 'text-emissive-strength': 1 },
    } as never);
    map.on('click', circles, click); map.on('mouseenter', circles, enter); map.on('mouseleave', circles, leave);
    disposers.add(destroy);
  } catch (error) { destroy(); throw error; }
  const render = () => { if (!destroyed) (map.getSource(source) as GeoJSONSource).setData(fleetFeatures(points, hidden)); };
  return {
    update(next) { if (destroyed) throw new Error('Fleet layer has been destroyed.'); points = next; render(); },
    setHidden(id) { hidden = id; render(); },
    setVisible(visible) { if (!destroyed) for (const id of [circles, labels]) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'); },
    destroy,
  };
}
