/** Pure parts of the timelapse video export (module «video»): unit tested, no DOM. */

export type VideoFormatId = 'orizzontale' | 'verticale' | 'quadrato';

export const VIDEO_FORMATS: Record<VideoFormatId, { width: number; height: number; label: string; ratio: string }> = {
  orizzontale: { width: 1920, height: 1080, label: 'Orizzontale', ratio: '16:9' },
  verticale: { width: 1080, height: 1920, label: 'Verticale', ratio: '9:16' },
  quadrato: { width: 1080, height: 1080, label: 'Quadrato', ratio: '1:1' },
};

export const VIDEO_DURATIONS_S = [30, 60, 120] as const;
export const VIDEO_FPS = 30;
export const VIDEO_BITRATE = 8_000_000;
/** Time given to the map to load tiles after the camera moves, before recording starts. */
export const VIDEO_WARMUP_MS = 2_000;

const TYPES = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4', label: 'MP4' },
  { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm', label: 'WebM' },
  { mimeType: 'video/webm', extension: 'webm', label: 'WebM' },
] as const;

export type VideoType = (typeof TYPES)[number];

/** Best container the browser can record: MP4 first (plays everywhere), WebM otherwise. */
export function pickVideoType(isSupported: (mimeType: string) => boolean): VideoType | null {
  for (const type of TYPES) {
    try { if (isSupported(type.mimeType)) return type; } catch { /* treat as unsupported */ }
  }
  return null;
}

/** Source rectangle that fills the output like CSS object-fit: cover (centered crop). */
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number): { sx: number; sy: number; sw: number; sh: number } {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return { sx: 0, sy: 0, sw: Math.max(0, srcW), sh: Math.max(0, srcH) };
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale, sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/** Moment of the day shown after `elapsedMs` of a `durationMs` video covering [from, to]. */
export function recordingTime(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0) || !(to > from)) return from;
  const f = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return from + (to - from) * f;
}

/** Minutes of the day shown per second of video, rounded (for the labels). */
export function minutesPerSecond(from: number, to: number, durationS: number): number {
  if (!(durationS > 0) || !(to > from)) return 0;
  return Math.max(1, Math.round((to - from) / 60_000 / durationS));
}

/** Rough final size in MB at the target bitrate. */
export function estimateMegabytes(durationS: number, bitrate = VIDEO_BITRATE): number {
  return Math.max(1, Math.round(durationS * bitrate / 8 / 1_000_000));
}

/** ASCII file name from the mezzo name and day; never contains the plate. */
export function videoFileName(name: string, day: string, extension: string): string {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'mezzo';
  const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'giorno';
  const safeExt = /^(mp4|webm)$/.test(extension) ? extension : 'webm';
  return `timelapse-${slug}-${safeDay}.${safeExt}`;
}

/** Camera that frames a whole track (same projection math as the fleet framing). */
export function routeCamera(points: readonly { longitude: number; latitude: number }[], viewportPx = 600, pitch = 50): { center: { longitude: number; latitude: number }; zoom: number; pitch: number; bearing: number } | null {
  const valid = points.filter(p => Number.isFinite(p.longitude) && Number.isFinite(p.latitude));
  if (!valid.length) return null;
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const p of valid) { south = Math.min(south, p.latitude); north = Math.max(north, p.latitude); west = Math.min(west, p.longitude); east = Math.max(east, p.longitude); }
  const latitude = (south + north) / 2, longitude = (west + east) / 2;
  const cos = Math.cos(latitude * Math.PI / 180);
  const spanM = Math.max((north - south) * 111_320, (east - west) * 111_320 * cos, 300) * 1.25;
  const zoom = Math.max(4, Math.min(17, Math.log2(40_075_016 * cos * viewportPx / 512 / spanM)));
  return { center: { longitude, latitude }, zoom, pitch, bearing: 0 };
}

/** «sabato 22 novembre 2026» from YYYY-MM-DD, in local time. */
export function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
