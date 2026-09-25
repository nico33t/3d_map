export { createVehicleMotion, type VehiclePose } from './motion.js';
export { createFleetAssignments, type FleetStorage } from './fleet.js';
/** Asset metadata is independent of Mapbox, Google and the rendering library. */
export { createVehicleRoute, type RoutePoint } from './route.js';
export interface VehicleAsset {
  readonly id: string;
  readonly name: string;
  /** Path relative to the package assets directory. Preserve adjacent textures. */
  readonly file: string;
  /** Per-asset placement calibration for a native map model layer. */
  readonly mapScale: number;
  readonly headingOffset: number;
  readonly format: 'glb';
  readonly style: 'stylized' | 'realistic';
  readonly author: string;
  readonly sourceUrl: string;
  readonly license: 'CC0-1.0' | 'CC-BY-4.0';
  readonly licenseUrl: string;
  readonly attribution: string | null;
}

const source = {
  mapScale: 1.8, headingOffset: 180,
  format: 'glb', style: 'stylized', author: 'Kenney',
  sourceUrl: 'https://kenney.nl/assets/car-kit',
  license: 'CC0-1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: null,
} as const;

/** Bundled CC0 starter vehicles. No network request happens on import. */
export const vehicles: readonly VehicleAsset[] = Object.freeze([
  Object.freeze({ ...source, id: 'kenney-sedan', name: 'Berlina', file: 'kenney/sedan.glb' }),
  Object.freeze({ ...source, id: 'kenney-suv', name: 'SUV', file: 'kenney/suv.glb' }),
  Object.freeze({ ...source, id: 'kenney-suv-luxury', name: 'SUV luxury', file: 'kenney/suv-luxury.glb' }),
  Object.freeze({ ...source, id: 'kenney-hatchback-sports', name: 'Compatta sportiva', file: 'kenney/hatchback-sports.glb' }),
  Object.freeze({ ...source, id: 'kenney-van', name: 'Van', file: 'kenney/van.glb' }),
]);

/** User-supplied realistic asset, with its own CC BY license. */
export const audiA1: VehicleAsset = Object.freeze({
  mapScale: 1.8, headingOffset: 180,
  id: 'audi-a1-quattro', name: 'Audi A1 Quattro (A1II)',
  file: 'audi/audi-a1-quattro.glb', format: 'glb', style: 'realistic',
  author: 'Mona x Supercars / GT Cars: Hyperspeed (@Car2022)',
  sourceUrl: 'https://sketchfab.com/3d-models/audi-a1-quattro-a1ii-c0ca74fba3b24326b898bfc556909b57',
  license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Audi A1 Quattro (A1II) by Car2022, CC BY 4.0. Scale/pivot adjusted; invisible helper lines removed.',
});

export function getVehicle(id: string): VehicleAsset | undefined {
  return id === audiA1.id ? audiA1 : vehicles.find((vehicle) => vehicle.id === id);
}

/** baseUrl is the absolute HTTP(S) URL where the host app serves the assets folder. */
export function getVehicleUrl(id: string, baseUrl: string | URL): string {
  const vehicle = getVehicle(id);
  if (!vehicle) throw new Error(`Unknown vehicle: ${id}`);
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Asset base URL must use HTTP(S).');
  if (base.search || base.hash) throw new Error('Asset base URL must not contain a query or fragment.');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(vehicle.file, base).href;
}
