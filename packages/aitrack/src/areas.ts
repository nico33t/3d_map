import type { Feature, FeatureCollection, Polygon } from 'geojson';

export type AreaType = 'circle' | 'polygon' | 'polyline' | 'point';
export interface AreaPoint { lat: number; lng: number }
/** Aitrack API v3 (beta) area shape: https://docs.aitrack.it/en/api/v3/areas/ */
export interface Area {
  id: number;
  name: string;
  color: string;
  type: AreaType;
  center: AreaPoint | null;
  radius_m: number | null;
  buffer_m: number | null;
  points: AreaPoint[];
  external_id?: string | null;
  dwell_seconds?: number;
  metrics?: { area_m2: number | null; perimeter_m: number | null; length_m: number | null };
  bounds?: { south: number; west: number; north: number; east: number } | null;
  created_at?: string | null;
}
export interface AreaWallProperties { id: number; name: string; color: string; type: AreaType }

const EARTH = 6_371_008.8;
const rad = Math.PI / 180;
const validPoint = (p: AreaPoint | null | undefined): p is AreaPoint =>
  !!p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 85.051129 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
const color = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : '#3b82f6';

/** Local equirectangular frame in meters around an origin: precise enough at geofence scale. */
function frame(origin: AreaPoint) {
  const k = Math.cos(origin.lat * rad);
  return {
    toXY: (p: AreaPoint): [number, number] => [(p.lng - origin.lng) * rad * EARTH * k, (p.lat - origin.lat) * rad * EARTH],
    toLngLat: ([x, y]: [number, number]): [number, number] => [origin.lng + x / (rad * EARTH * k), origin.lat + y / (rad * EARTH)],
  };
}

function circle(center: AreaPoint, radius: number, steps = 72): [number, number][] {
  const { toLngLat } = frame(center);
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) { const a = (i / steps) * 2 * Math.PI; ring.push(toLngLat([Math.cos(a) * radius, Math.sin(a) * radius])); }
  return ring;
}

/** Outline of a track buffer: offset sides with mitered joins and round caps. */
function corridor(points: AreaPoint[], width: number): [number, number][] {
  const { toXY, toLngLat } = frame(points[0]!);
  const xy = points.map(toXY).filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1]![0], p[1] - all[i - 1]![1]) > 0.01);
  if (xy.length < 2) return circle(points[0]!, width);
  const normal = (a: [number, number], b: [number, number]): [number, number] => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]); return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
  };
  const side = (sign: 1 | -1) => xy.map((p, i): [number, number] => {
    const before = i > 0 ? normal(xy[i - 1]!, p) : undefined;
    const after = i < xy.length - 1 ? normal(p, xy[i + 1]!) : undefined;
    let [nx, ny] = before && after ? [before[0] + after[0], before[1] + after[1]] : (before ?? after)!;
    const length = Math.hypot(nx, ny) || 1; nx /= length; ny /= length;
    const reference = before ?? after!;
    const miter = Math.min(4, 1 / Math.max(0.25, nx * reference[0] + ny * reference[1]));
    return [p[0] + sign * nx * width * miter, p[1] + sign * ny * width * miter];
  });
  const cap = (at: [number, number], from: [number, number]): [number, number][] => {
    const start = Math.atan2(from[1] - at[1], from[0] - at[0]);
    return Array.from({ length: 11 }, (_, i) => { const a = start - (i / 10) * Math.PI; return [at[0] + Math.cos(a) * width, at[1] + Math.sin(a) * width]; });
  };
  const left = side(1), right = side(-1);
  return [...left, ...cap(xy.at(-1)!, left.at(-1)!).slice(1, -1), ...right.reverse(), ...cap(xy[0]!, right.at(-1)!).slice(1, -1)].map(toLngLat);
}

/** Closed outline ([lng, lat], RFC 7946 order) of any Aitrack area, or null if its data is unusable. */
export function areaOutline(area: Area): [number, number][] | null {
  if (area.type === 'circle' || area.type === 'point') {
    const radius = area.radius_m ?? 50;
    if (!validPoint(area.center) || !Number.isFinite(radius) || radius <= 0 || radius > 100_000) return null;
    return circle(area.center, radius);
  }
  const points = (area.points ?? []).filter(validPoint);
  if (area.type === 'polygon' && points.length >= 3) return points.map(p => [p.lng, p.lat]);
  if (area.type === 'polyline' && points.length >= 2) {
    const buffer = area.buffer_m ?? 50;
    return Number.isFinite(buffer) && buffer > 0 && buffer <= 5000 ? corridor(points, buffer) : null;
  }
  return null;
}

/**
 * Engine-independent geometry for "virtual walls": each edge of every area becomes a thin
 * quad, ready for any extrusion renderer. Colors are the ones saved in Aitrack.
 */
export function areaWalls(areas: readonly Area[], options: { thicknessM?: number } = {}): FeatureCollection<Polygon, AreaWallProperties> {
  const thickness = options.thicknessM ?? 0.6;
  if (!Number.isFinite(thickness) || thickness <= 0 || thickness > 50) throw new RangeError('Invalid wall thickness.');
  const features: Feature<Polygon, AreaWallProperties>[] = [];
  for (const area of areas) {
    const outline = areaOutline(area);
    if (!outline) continue;
    const properties = { id: area.id, name: area.name, color: color(area.color), type: area.type };
    const origin = { lng: outline[0]![0], lat: outline[0]![1] };
    const { toXY, toLngLat } = frame(origin);
    const xy = outline.map(([lng, lat]) => toXY({ lng, lat }));
    for (let i = 0; i < xy.length; i++) {
      const a = xy[i]!, b = xy[(i + 1) % xy.length]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.01) continue;
      // Extend slightly past each vertex so adjacent segments close the corner.
      const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length;
      const ox = -uy * thickness / 2, oy = ux * thickness / 2, ex = ux * thickness / 2, ey = uy * thickness / 2;
      const quad = ([[a[0] - ex + ox, a[1] - ey + oy], [b[0] + ex + ox, b[1] + ey + oy], [b[0] + ex - ox, b[1] + ey - oy], [a[0] - ex - ox, a[1] - ey - oy]] as [number, number][]).map(toLngLat);
      features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[...quad, quad[0]!]] } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Area footprints as closed polygons, for a translucent ground fill. */
export function areaFootprints(areas: readonly Area[]): FeatureCollection<Polygon, AreaWallProperties> {
  const features: Feature<Polygon, AreaWallProperties>[] = [];
  for (const area of areas) {
    const outline = areaOutline(area);
    if (outline) features.push({ type: 'Feature', properties: { id: area.id, name: area.name, color: color(area.color), type: area.type }, geometry: { type: 'Polygon', coordinates: [[...outline, outline[0]!]] } });
  }
  return { type: 'FeatureCollection', features };
}
