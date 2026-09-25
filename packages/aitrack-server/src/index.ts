import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyAitrackWebhook } from '@3d-map/aitrack/webhooks';
import { createLocationHub } from './hub.js';
export { nextPollDelay, createLocationHub } from './hub.js';
export function createAitrackGateway(options: { apiKey: string; webhookSecret: string; fetch?: typeof fetch; requestSpacingMs?: number; runtimeState?: () => Record<string, unknown>; saveWebhookSecret?: (secret: string) => void }) {
  const fetcher = options.fetch ?? fetch;
  const lifetime = new AbortController();
  const streams = new Set<ServerResponse>();
  let queue: Promise<unknown> = Promise.resolve();
  let nextRequest = 0;
  let lastWebhook: string | null = null;
  let requests = 0;
  const seen = new Map<string, number>();
  const upstream = (path: string) => {
    const result = queue.then(async () => {
      lifetime.signal.throwIfAborted();
      if (!options.apiKey) throw new Error('Missing API key');
      const delay = Math.max(0, nextRequest - Date.now());
      if (delay) await new Promise<void>((resolve, reject) => {
        const done = () => { lifetime.signal.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, delay);
        const abort = () => { clearTimeout(timer); reject(new Error('Stopped')); };
        lifetime.signal.addEventListener('abort', abort, { once: true });
      });
      lifetime.signal.throwIfAborted();
      nextRequest = Date.now() + (options.requestSpacingMs ?? 4500); requests++;
      const response = await fetcher(`https://api.aitrack.it/api/v2${path}`, { headers: { 'X-API-Key': options.apiKey, Accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(12_000)]) });
      return { status: response.status, body: await response.text() };
    });
    queue = result.catch(() => {}); return result;
  };
  const hub = createLocationHub(async imei => {
    const result = await upstream(`/devices/${imei}/location`);
    if (result.status !== 200) throw new Error('Upstream error');
    return JSON.parse(result.body).data;
  });
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body));
  };
  const webhook = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/webhooks/aitrack' || req.method !== 'POST') return json(res, 404, { error: 'Not found' });
    if (!options.webhookSecret) return json(res, 503, { error: 'Webhook secret not configured' });
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 262144) { json(res, 413, { error: 'Payload too large' }); return; } chunks.push(bytes); }
      const raw = Buffer.concat(chunks);
      const signature = req.headers['x-aitrack-signature'];
      const version = req.headers['x-aitrack-signature-version'];
      if (!verifyAitrackWebhook(raw, typeof signature === 'string' ? signature : undefined, options.webhookSecret, typeof version === 'string' ? version : 'v1')) return json(res, 401, { error: 'Invalid signature' });
      const event = JSON.parse(raw.toString());
      const deliveryId = req.headers['x-aitrack-delivery-id'];
      const timestamp = Number(req.headers['x-aitrack-timestamp']);
      if (typeof deliveryId !== 'string' || !deliveryId || deliveryId.length > 256 || !Number.isFinite(timestamp) || Math.abs(Date.now()-timestamp)>300000) return json(res, 400, { error: 'Invalid delivery headers' });
      if (!event || typeof event !== 'object' || Array.isArray(event)) return json(res, 400, { error: 'Invalid event' });
      const now = Date.now(); for (const [id, time] of seen) if (now - time > 86400000) seen.delete(id);
      if (seen.has(deliveryId)) return json(res, 200, { received: true, duplicate: true });
      if (seen.size >= 10000) seen.delete(seen.keys().next().value!);
      seen.set(deliveryId, now); lastWebhook = new Date().toISOString();
      json(res, 202, { received: true });
      if (event.type !== 'ping') hub.notifyEvent();
    } catch { if (!res.headersSent) json(res, 400, { error: 'Invalid payload' }); }
  };
  const local = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    // This API is local-only: reject DNS rebinding and cross-site access.
    const host = req.headers.host ?? '';
    if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Local access only' });
    if (url.pathname === '/api/system/webhook-secret' && req.method === 'POST' && options.saveWebhookSecret) {
      if (req.headers.origin !== `http://${host}` || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Same-origin JSON required' });
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 2048) return json(res, 413, { error: 'Too large' }); chunks.push(bytes); }
        const { secret } = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof secret !== 'string' || !/^[A-Za-z0-9_=-]{16,256}$/.test(secret)) return json(res, 400, { error: 'Secret non valido.' });
        options.saveWebhookSecret(secret); options.webhookSecret = secret;
        return json(res, 200, { saved: true });
      } catch { return json(res, 400, { error: 'Salvataggio non riuscito.' }); }
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Read only' });
    if (url.pathname === '/api/system/status') return json(res, 200, { ...options.runtimeState?.(), transport: 'sse', activeDevices: hub.activeDevices, requests, lastWebhook, webhookConfigured: Boolean(options.webhookSecret), apiConfigured: Boolean(options.apiKey) });
    if (url.pathname === '/api/aitrack/live') {
      const imei = url.searchParams.get('device') ?? '';
      if (!/^\d{10,20}$/.test(imei)) return json(res, 400, { error: 'Invalid IMEI' });
      if (!options.apiKey) return json(res, 503, { error: 'Missing Aitrack API key' });
      if (streams.size >= 20) return json(res, 429, { error: 'Too many live connections' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n'); streams.add(res);
      const stop = hub.subscribe(imei, message => { if (!res.destroyed && res.writableLength < 65536) res.write(`event: ${message.type}\ndata: ${JSON.stringify(message.data)}\n\n`); });
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
      res.on('close', () => { clearInterval(heartbeat); stop(); streams.delete(res); }); return;
    }
    const path = url.pathname.slice('/api/aitrack'.length);
    if (!url.pathname.startsWith('/api/aitrack/') || !/^\/(devices(?:\/nearest|\/\d{10,20}(?:\/(?:location|history|commands))?)?|events)$/.test(path)) return json(res, 404, { error: 'Not found' });
    try { const result = await upstream(`${path}${url.search}`); if (!res.destroyed) { res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(result.body); } }
    catch { if (!res.destroyed) json(res, 502, { error: 'Aitrack non raggiungibile.' }); }
  };
  return { local, webhook, close() { lifetime.abort(); hub.close(); for (const stream of streams) stream.end(); streams.clear(); } };
}
