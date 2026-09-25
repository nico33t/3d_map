export { watchAitrackLive } from './live.js';
export interface Location {
  latitude: number;
  longitude: number;
  speed_kmh: number;
  recorded_at: string;
  altitude_m?: number;
  heading?: number;
  satellites?: number;
}
export interface Device {
  id: number | string;
  imei: string;
  name: string;
  plate?: string | null;
  device_model?: string | null;
  odometer_km?: number | null;
  status: 'moving' | 'parked' | 'offline' | 'unknown';
  groups?: string[];
  location?: Location | null;
  updated_at?: string;
}
export interface FleetEvent {
  id: number | string;
  type: string;
  message: string;
  device_imei: string;
  data: Record<string, unknown>;
  read: boolean;
  occurred_at: string;
}
export interface Command {
  id: number | string;
  type: string;
  status: 'pending' | 'sent' | 'canceled';
  queued_at: string;
  sent_at: string | null;
}
export interface ApiResponse<T> {
  data: T;
  meta?: { pagination?: { limit: number; offset: number; count: number }; [key: string]: unknown };
}
export class AitrackError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message); this.name = 'AitrackError';
  }
}
export interface ClientOptions {
  /** Server: https://api.aitrack.it/api/v2. Browser: own-origin proxy URL. */
  baseUrl?: string;
  /** Server only. Do not embed API keys in a browser bundle. */
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
type Query = Record<string, string | number | undefined>;

export function createAitrackClient(options: ClientOptions = {}) {
  const base = (options.baseUrl ?? 'https://api.aitrack.it/api/v2').replace(/\/$/, '');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) throw new Error('A fetch implementation is required.');
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Invalid request timeout.');
  const devicePath = (imei: string) => {
    if (!/^\d{10,20}$/.test(imei)) throw new Error('IMEI must contain 10–20 digits.');
    return `/devices/${imei}`;
  };
  async function request<T>(path: string, query: Query = {}, signal?: AbortSignal): Promise<ApiResponse<T>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Aitrack request timed out.')), timeoutMs);
    try {
      const response = await fetcher(`${base}${path}${params.size ? `?${params}` : ''}`, {
        method: 'GET', headers: { Accept: 'application/json', ...(options.apiKey ? { 'X-API-Key': options.apiKey } : {}) },
        signal: controller.signal, redirect: 'error', cache: 'no-store',
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
        const message = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? String(error.message) : `Aitrack HTTP ${response.status}`;
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : `HTTP_${response.status}`;
        throw new AitrackError(message, response.status, code);
      }
      if (!body || typeof body !== 'object' || !('data' in body)) throw new AitrackError('Invalid Aitrack response envelope.', response.status, 'INVALID_RESPONSE');
      return body as ApiResponse<T>;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  const getLocation = (imei: string, signal?: AbortSignal) => request<Location>(`${devicePath(imei)}/location`, {}, signal);
  return {
    listDevices: (query: { limit?: number; offset?: number } = {}, signal?: AbortSignal) => request<Device[]>('/devices', query, signal),
    getDevice: (imei: string, signal?: AbortSignal) => request<Device>(devicePath(imei), {}, signal),
    getLocation,
    getHistory: (imei: string, query: { from: string; to: string; limit?: number }, signal?: AbortSignal) => request<Location[]>(`${devicePath(imei)}/history`, query, signal),
    nearestDevices: (query: { lat: number; lng: number; limit?: number; max_km?: number }, signal?: AbortSignal) => request<(Device & { distance_km: number })[]>('/devices/nearest', query, signal),
    listEvents: (query: { type?: string; device?: string; from?: string; to?: string; limit?: number; offset?: number } = {}, signal?: AbortSignal) => request<FleetEvent[]>('/events', query, signal),
    listCommands: (imei: string, query: { status?: string; limit?: number } = {}, signal?: AbortSignal) => request<Command[]>(`${devicePath(imei)}/commands`, query, signal),
    /** Sequential polling: default 360 requests/hour; bounded backoff for failures. */
    watchLocation(imei: string, handlers: { onLocation: (location: Location) => void; onError?: (error: unknown) => void }, config: { intervalMs?: number; signal?: AbortSignal } = {}) {
      devicePath(imei);
      const interval = config.intervalMs ?? 10_000;
      if (!Number.isFinite(interval) || interval < 5_000) throw new RangeError('Polling interval must be at least 5 seconds.');
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let failures = 0;
      let lastRecorded = -Infinity;
      const stop = () => { controller.abort(); clearTimeout(timer); config.signal?.removeEventListener('abort', stop); };
      const tick = async () => {
        let fatal = false;
        try {
          const { data } = await getLocation(imei, controller.signal);
          const time = Date.parse(data.recorded_at);
          if (!Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90 || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180 || !Number.isFinite(time)) throw new AitrackError('Invalid location data.', 200, 'INVALID_LOCATION');
          failures = 0;
          if (!controller.signal.aborted && time > lastRecorded) { lastRecorded = time; handlers.onLocation(data); }
        } catch (error) {
          if (!controller.signal.aborted) {
            failures++;
            fatal = error instanceof AitrackError && (error.status === 400 || error.status === 403 || error.code === 'DEVICE_NOT_FOUND');
            handlers.onError?.(error);
          }
        } finally {
          if (fatal) stop();
          else if (!controller.signal.aborted) timer = setTimeout(tick, Math.min(120_000, interval * 2 ** Math.min(failures, 4)));
        }
      };
      if (config.signal?.aborted) stop();
      else { config.signal?.addEventListener('abort', stop, { once: true }); void tick(); }
      return stop;
    },
  };
}
