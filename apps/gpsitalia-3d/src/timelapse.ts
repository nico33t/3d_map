/** History playback (timelapse) of one vehicle. Pure functions: unit tested. */
export interface TrackPoint { t: number; longitude: number; latitude: number; speedKmh: number; heading: number | null }
export interface TrackPose { longitude: number; latitude: number; heading: number; speedKmh: number }
export interface Stop { from: number; to: number; longitude: number; latitude: number }

const num = (value: unknown): number => typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;

/** Platform rows ({timestamp, latitude, longitude, speed, angle}) → sorted, deduplicated points. */
export function normalizeHistory(body: unknown): TrackPoint[] {
  const rows = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : [];
  const points: TrackPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const t = typeof r.timestamp === 'string' || typeof r.timestamp === 'number' ? new Date(r.timestamp).getTime() : Number.NaN;
    const longitude = num(r.longitude), latitude = num(r.latitude);
    if (!Number.isFinite(t) || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 85.051129 || (longitude === 0 && latitude === 0)) continue;
    const speed = num(r.speed), angle = num(r.angle ?? r.heading);
    points.push({ t, longitude, latitude, speedKmh: Number.isFinite(speed) && speed > 0 ? speed : 0, heading: Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : null });
  }
  points.sort((a, b) => a.t - b.t);
  return points.filter((p, i) => i === 0 || p.t !== points[i - 1]!.t);
}

const bearing = (a: TrackPoint, b: TrackPoint) => {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.longitude - a.longitude) * toRad) * Math.cos(b.latitude * toRad);
  const x = Math.cos(a.latitude * toRad) * Math.sin(b.latitude * toRad) - Math.sin(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.cos((b.longitude - a.longitude) * toRad);
  return ((Math.atan2(y, x) / toRad) + 360) % 360;
};

/** Index of the last point with p.t <= t (−1 before the first). */
export function indexAt(points: readonly TrackPoint[], t: number): number {
  let lo = 0, hi = points.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Gaps longer than this are not interpolated: the vehicle waits at the last point. */
export const MAX_GAP_MS = 10 * 60_000;

/** Pose at time t, linearly interpolated between recorded points (never beyond them). */
export function poseAt(points: readonly TrackPoint[], t: number): TrackPose | null {
  if (!points.length) return null;
  const i = indexAt(points, t);
  if (i < 0) { const p = points[0]!; return { longitude: p.longitude, latitude: p.latitude, heading: p.heading ?? 0, speedKmh: 0 }; }
  const a = points[i]!, b = points[i + 1];
  const headingOf = (from: TrackPoint, to?: TrackPoint) => to && (to.longitude !== from.longitude || to.latitude !== from.latitude) ? bearing(from, to) : from.heading ?? 0;
  if (!b || b.t - a.t > MAX_GAP_MS) return { longitude: a.longitude, latitude: a.latitude, heading: headingOf(points[i - 1] ?? a, a) || (a.heading ?? 0), speedKmh: b ? 0 : a.speedKmh };
  const ratio = (t - a.t) / (b.t - a.t);
  return {
    longitude: a.longitude + (b.longitude - a.longitude) * ratio,
    latitude: a.latitude + (b.latitude - a.latitude) * ratio,
    heading: headingOf(a, b),
    speedKmh: a.speedKmh + (b.speedKmh - a.speedKmh) * ratio,
  };
}

/** Trail up to time t (bounded), ending at the interpolated pose. */
export function trailUntil(points: readonly TrackPoint[], t: number, maxPoints = 3000): { longitude: number; latitude: number }[] {
  const i = indexAt(points, t);
  if (i < 0) return [];
  const trail = points.slice(Math.max(0, i + 1 - maxPoints), i + 1).map(p => ({ longitude: p.longitude, latitude: p.latitude }));
  const pose = poseAt(points, t);
  if (pose) trail.push({ longitude: pose.longitude, latitude: pose.latitude });
  return trail;
}

/** Stops: speed under `kmh` (or a recording gap) for at least `minMs`. */
export function findStops(points: readonly TrackPoint[], minMs = 5 * 60_000, kmh = 3): Stop[] {
  const stops: Stop[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const a = points[start]!, b = points[end]!;
    if (b.t - a.t >= minMs) stops.push({ from: a.t, to: b.t, longitude: a.longitude, latitude: a.latitude });
    start = -1;
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const gap = i > 0 && p.t - points[i - 1]!.t > MAX_GAP_MS;
    if (gap && start < 0) { start = i - 1; close(i); }
    if (p.speedKmh < kmh) { if (start < 0) start = i; }
    else close(i);
  }
  if (start >= 0) close(points.length - 1);
  return stops;
}

/** Local day [00:00, 24:00) for an <input type=date> value, as epoch ms. */
export function dayRange(isoDate: string): { from: number; to: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const from = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  const to = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1).getTime();
  return Number.isFinite(from) ? { from, to } : null;
}

export const PLAYBACK_SPEEDS = [60, 300, 900, 3600] as const;
