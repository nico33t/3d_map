/** WGS84 coordinates in degrees. */
export interface Coordinates {
  longitude: number;
  latitude: number;
}

/** Zoom uses the Web Mercator 512px tile convention. Adapters translate it. */
export interface Camera {
  center: Coordinates;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface MapMarker {
  id: string;
  position: Coordinates;
  label: string;
}

export interface MapEvents {
  cameraChange: Camera;
  click: Coordinates;
  markerClick: { id: string };
  error: Error;
}

export type Unsubscribe = () => void;

/** The portable subset. Engine-specific styles and credentials belong to providers. */
export interface MapSession {
  getCamera(): Camera;
  setCamera(camera: Camera, options?: { animate?: boolean }): void;
  /** Replaces the complete marker collection. Duplicate IDs are rejected. */
  setMarkers(markers: readonly MapMarker[]): void;
  on<K extends keyof MapEvents>(event: K, listener: (value: MapEvents[K]) => void): Unsubscribe;
  resize(): void;
  /** Idempotent; other operations after disposal throw. */
  destroy(): void;
}

export interface MountOptions {
  container: HTMLElement;
  camera: Camera;
  signal?: AbortSignal;
}

export interface MapProvider {
  readonly id: string;
  /** Resolves when usable. Rejection or cancellation must release all resources. */
  mount(options: MountOptions): Promise<MapSession>;
}

export const DEFAULT_CAMERA: Readonly<Camera> = Object.freeze({
  center: Object.freeze({ longitude: 12.4924, latitude: 41.8902 }),
  zoom: 15,
  bearing: 0,
  pitch: 55,
});

export function validateCoordinates(point: Coordinates): void {
  if (!Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 ||
      !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 85.051129) {
    throw new RangeError('Coordinates must be finite: longitude ±180, latitude ±85.051129.');
  }
}

export function validateCamera(camera: Camera): void {
  validateCoordinates(camera.center);
  if (!Number.isFinite(camera.zoom) || camera.zoom < 0 || camera.zoom > 22 ||
      !Number.isFinite(camera.bearing) || !Number.isFinite(camera.pitch) ||
      camera.pitch < 0 || camera.pitch > 85) {
    throw new RangeError('Camera requires zoom 0–22, pitch 0–85 and a finite bearing.');
  }
}

export function validateMarkers(markers: readonly MapMarker[]): void {
  const ids = new Set<string>();
  for (const marker of markers) {
    validateCoordinates(marker.position);
    if (!marker.id.trim() || ids.has(marker.id)) throw new Error('Marker IDs must be nonempty and unique.');
    ids.add(marker.id);
  }
}

/** Keeps application code independent of the selected engine. */
export async function createMap(provider: MapProvider, options: MountOptions): Promise<MapSession> {
  validateCamera(options.camera);
  options.signal?.throwIfAborted();
  return provider.mount(options);
}
