import { AitrackError, createAitrackClient, type Location } from './index.js';
/** SSE reconnects automatically. Legacy deployments fall back to slower client polling. */
export function watchAitrackLive(imei: string, handlers: { onLocation: (location: Location) => void; onError?: (error: unknown) => void }, options: { signal?: AbortSignal } = {}) {
  if (!/^\d{10,20}$/.test(imei)) throw new Error('Invalid IMEI.');
  if (options.signal?.aborted) return () => {};
  let stopped = false;
  let failures = 0;
  let lastRecorded = -Infinity;
  let fallback: (() => void) | undefined;
  const deliver = (location: Location) => {
    const time = Date.parse(location.recorded_at);
    if (!stopped && Number.isFinite(time) && time > lastRecorded && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) { lastRecorded = time; handlers.onLocation(location); }
  };
  if (typeof EventSource === 'undefined') return createAitrackClient({ baseUrl: '/api/aitrack' }).watchLocation(imei, { ...handlers, onLocation: deliver }, { intervalMs: 30_000, ...(options.signal ? { signal: options.signal } : {}) });
  const stream = new EventSource(`/api/aitrack/live?device=${encodeURIComponent(imei)}`);
  stream.addEventListener('open', () => { failures = 0; fallback?.(); fallback = undefined; });
  stream.addEventListener('location', event => { try { deliver(JSON.parse((event as MessageEvent).data)); } catch { handlers.onError?.(new Error('Dato live non valido.')); } });
  stream.addEventListener('problem', () => handlers.onError?.(new AitrackError('Aitrack non disponibile. Riconnessione automatica…', 502, 'UPSTREAM_UNAVAILABLE')));
  stream.addEventListener('error', () => {
    if (stopped) return;
    failures++;
    if (failures >= 3 && !fallback) fallback = createAitrackClient({ baseUrl: '/api/aitrack' }).watchLocation(imei, { ...handlers, onLocation: deliver }, { intervalMs: 30_000, ...(options.signal ? { signal: options.signal } : {}) });
  });
  const stop = () => { stopped = true; stream.close(); fallback?.(); options.signal?.removeEventListener('abort', stop); };
  options.signal?.addEventListener('abort', stop, { once: true });
  return stop;
}
