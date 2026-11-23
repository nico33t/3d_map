/** Normalizes /api/last-locations rows of the platform into map points. Pure. */
export interface LiveVehicle {
  imei: string;
  name: string;
  plate: string;
  longitude: number;
  latitude: number;
  heading: number;
  speedKmh: number;
  recordedAt: string;
  state: 'moving' | 'stopped' | 'stale';
}

const STALE_MS = 30 * 60_000;
const MOVING_KMH = 3;

const num = (value: unknown): number => typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;

export function normalizeLiveRows(body: unknown, nowMs = Date.now()): LiveVehicle[] {
  const rows = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : [];
  const out: LiveVehicle[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const imei = typeof r.imei === 'string' || typeof r.imei === 'number' ? String(r.imei) : '';
    if (!imei || seen.has(imei)) continue;
    const longitude = num(r.longitude), latitude = num(r.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 85.051129) continue;
    if (longitude === 0 && latitude === 0) continue;
    const time = typeof r.timestamp === 'string' || typeof r.timestamp === 'number' ? new Date(r.timestamp).getTime() : Number.NaN;
    if (!Number.isFinite(time)) continue;
    seen.add(imei);
    const speed = num(r.speed);
    const heading = num(r.heading);
    const speedKmh = Number.isFinite(speed) && speed > 0 ? speed : 0;
    const stale = nowMs - time > STALE_MS;
    out.push({
      imei,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `Mezzo ${imei.slice(-4)}`,
      plate: typeof r.targa === 'string' ? r.targa.trim() : '',
      longitude, latitude,
      heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0,
      speedKmh,
      recordedAt: new Date(time).toISOString(),
      state: stale ? 'stale' : speedKmh >= MOVING_KMH ? 'moving' : 'stopped',
    });
  }
  return out;
}

/** Fields the browser needs from a last-locations row: everything else is dropped by the proxy. */
export const LIVE_FIELDS = ['imei', 'name', 'targa', 'latitude', 'longitude', 'heading', 'speed', 'timestamp'] as const;

export interface FleetState {
  vehicles: Map<string, { vehicle: LiveVehicle; misses: number }>;
}

/** Polls missed before a vehicle leaves the map: pages can skip rows while vehicles move. */
export const MAX_MISSES = 3;

export function createFleetState(): FleetState { return { vehicles: new Map() }; }

/**
 * Merges one poll into the known fleet by IMEI. The platform pages by latest
 * timestamp, so a moving vehicle can slip between pages: it is kept until it
 * is missing from MAX_MISSES consecutive polls. An older point never replaces
 * a newer one.
 */
export function mergeFleet(state: FleetState, polled: readonly LiveVehicle[]): LiveVehicle[] {
  const seen = new Set<string>();
  for (const vehicle of polled) {
    seen.add(vehicle.imei);
    const known = state.vehicles.get(vehicle.imei);
    if (known && Date.parse(known.vehicle.recordedAt) > Date.parse(vehicle.recordedAt)) { known.misses = 0; continue; }
    state.vehicles.set(vehicle.imei, { vehicle, misses: 0 });
  }
  for (const [imei, entry] of state.vehicles) {
    if (seen.has(imei)) continue;
    entry.misses++;
    if (entry.misses >= MAX_MISSES) state.vehicles.delete(imei);
  }
  return [...state.vehicles.values()].map(entry => entry.vehicle);
}

/**
 * Full-fleet refresh interval by fleet size. Each refresh costs ceil(n/200)
 * paged reads on the platform (cached there for 30 s), so big fleets refresh
 * less often; the selected vehicle is refreshed separately and cheaply.
 */
export function fleetIntervalMs(count: number): number {
  if (count <= 200) return 30_000;
  if (count <= 1_000) return 60_000;
  if (count <= 3_000) return 120_000;
  return 180_000;
}

/** Selected vehicle: one primary-key row (/vehicles/:imei/location) every 10 s. */
export const SELECTED_INTERVAL_MS = 10_000;

/** Platform reads per minute for one open tab: the number the founder asked to bound. */
export function readsPerMinute(count: number, selected: boolean): number {
  const pages = Math.max(1, Math.ceil(count / 200));
  return pages * 60_000 / fleetIntervalMs(count) + (selected ? 60_000 / SELECTED_INTERVAL_MS : 0);
}

/** Single-location row ({latitude, longitude, speed, timestamp}, no heading) applied to a known vehicle. */
export function applyLocation(vehicle: LiveVehicle, body: unknown, nowMs = Date.now()): LiveVehicle | null {
  const row = body && typeof body === 'object' && !Array.isArray(body) ? ((body as { data?: unknown }).data ?? body) as Record<string, unknown> : null;
  if (!row) return null;
  const [normalized] = normalizeLiveRows([{ imei: vehicle.imei, name: vehicle.name, targa: vehicle.plate, heading: null, ...row }], nowMs);
  if (!normalized || Date.parse(normalized.recordedAt) <= Date.parse(vehicle.recordedAt)) return null;
  const moved = normalized.longitude !== vehicle.longitude || normalized.latitude !== vehicle.latitude;
  const toRad = Math.PI / 180;
  const heading = moved
    ? ((Math.atan2(Math.sin((normalized.longitude - vehicle.longitude) * toRad) * Math.cos(normalized.latitude * toRad),
        Math.cos(vehicle.latitude * toRad) * Math.sin(normalized.latitude * toRad) - Math.sin(vehicle.latitude * toRad) * Math.cos(normalized.latitude * toRad) * Math.cos((normalized.longitude - vehicle.longitude) * toRad)) / toRad) + 360) % 360
    : vehicle.heading;
  return { ...normalized, heading };
}
