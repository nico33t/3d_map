import { SECURITY_HEADERS, type AccessEnv } from './auth';

/**
 * Read-only proxy towards the platform API with the signed-in user's token.
 * Only the routes and query parameters listed here are forwarded; everything
 * else is 404. The caller must already have admitted the user (role check).
 */
const ROUTES: readonly { pattern: RegExp; upstream: (match: RegExpMatchArray) => string; query: readonly string[] }[] = [
  { pattern: /^\/last-locations$/, upstream: () => '/api/last-locations', query: ['page', 'limit'] },
  { pattern: /^\/vehicles$/, upstream: () => '/api/vehicles', query: ['limit', 'offset'] },
  { pattern: /^\/vehicles\/(\d{10,20})\/location$/, upstream: m => `/api/vehicles/${m[1]}/location`, query: [] },
  { pattern: /^\/vehicles\/(\d{10,20})\/history$/, upstream: m => `/api/vehicles/${m[1]}/history`, query: ['start', 'end', 'limit', 'detail'] },
];

export const PROXY_PREFIX = '/api/platform';
const QUERY_VALUE = /^[\w:.+-]{1,64}$/;

const json = (status: number, code: string, message: string) => new Response(JSON.stringify({ error: { code, message } }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
});

export async function proxyPlatform(request: Request, token: string, env: AccessEnv, fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, 'METHOD_NOT_ALLOWED', 'Solo lettura.');
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${PROXY_PREFIX}/`)) return json(404, 'NOT_FOUND', 'Percorso non disponibile.');
  const path = url.pathname.slice(PROXY_PREFIX.length);
  let target: URL | undefined;
  let base: URL;
  try { base = new URL(env.PLATFORM_API_URL ?? ''); } catch { return json(503, 'NOT_CONFIGURED', 'Servizio GPS non configurato.'); }
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') return json(503, 'NOT_CONFIGURED', 'Servizio GPS non configurato.');
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;
    target = new URL(route.upstream(match), base.origin);
    for (const name of route.query) {
      const value = url.searchParams.get(name);
      if (value === null) continue;
      if (!QUERY_VALUE.test(value)) return json(400, 'INVALID_QUERY', `Parametro ${name} non valido.`);
      target.searchParams.set(name, value);
    }
    break;
  }
  if (!target) return json(404, 'NOT_FOUND', 'Percorso non disponibile.');

  const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${token}` });
  const etag = request.headers.get('If-None-Match');
  if (etag && etag.length <= 200) headers.set('If-None-Match', etag);
  let upstream: Response;
  try {
    upstream = await fetcher(target.toString(), { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return json(502, 'UPSTREAM_UNAVAILABLE', 'Servizio GPS non raggiungibile.');
  }
  if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) return json(502, 'UPSTREAM_REDIRECT', 'Risposta inattesa del servizio GPS.');
  // Never pass upstream cookies or caching to the browser.
  const out = new Headers({ 'Cache-Control': 'private, no-store', ...SECURITY_HEADERS });
  for (const name of ['Content-Type', 'ETag']) { const value = upstream.headers.get(name); if (value) out.set(name, value); }
  return new Response(upstream.status === 304 || request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}
