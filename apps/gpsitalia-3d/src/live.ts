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
