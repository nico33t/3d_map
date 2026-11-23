import { SECURITY_HEADERS, clearSessionCookie, type AccessEnv } from './auth';
import { LIVE_FIELDS } from './live';

/**
 * Read-only proxy towards the platform API with the signed-in user's token.
 * Only the routes and query parameters listed here are forwarded; everything
 * else is 404. The caller must already have admitted the user (role check).
 */
interface Route {
  pattern: RegExp;
  upstream: (match: RegExpMatchArray) => string;
  query: readonly string[];
  /** Forced query values (e.g. bounded pages so the Worker never parses a whole fleet at once). */
  force?: (query: URLSearchParams) => void;
  /** Keep only these fields of each row: less personal data reaches the browser. */
  project?: readonly string[];
}

export const LIVE_PAGE_SIZE = 200;

const ROUTES: readonly Route[] = [
  {
    pattern: /^\/last-locations$/, upstream: () => '/api/last-locations', query: ['page', 'limit'], project: LIVE_FIELDS,
    force: query => {
      const page = Number(query.get('page')), limit = Number(query.get('limit'));
      query.set('page', String(Number.isInteger(page) && page >= 1 && page <= 50 ? page : 1));
      query.set('limit', String(Number.isInteger(limit) && limit >= 1 && limit <= LIVE_PAGE_SIZE ? limit : LIVE_PAGE_SIZE));
    },
  },
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
  let route: Route | undefined;
  let base: URL;
  try { base = new URL(env.PLATFORM_API_URL ?? ''); } catch { return json(503, 'NOT_CONFIGURED', 'Servizio GPS non configurato.'); }
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') return json(503, 'NOT_CONFIGURED', 'Servizio GPS non configurato.');
  for (const candidate of ROUTES) {
    const match = path.match(candidate.pattern);
    if (!match) continue;
    route = candidate;
    target = new URL(candidate.upstream(match), base.origin);
    for (const name of candidate.query) {
      const value = url.searchParams.get(name);
      if (value === null) continue;
      if (!QUERY_VALUE.test(value)) return json(400, 'INVALID_QUERY', `Parametro ${name} non valido.`);
      target.searchParams.set(name, value);
    }
    candidate.force?.(target.searchParams);
    break;
  }
  if (!target || !route) return json(404, 'NOT_FOUND', 'Percorso non disponibile.');

  const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${token}` });
  const etag = request.headers.get('If-None-Match');
  if (etag && etag.length <= 200 && !route.project) headers.set('If-None-Match', etag);
  let upstream: Response;
  try {
    upstream = await fetcher(target.toString(), { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return json(502, 'UPSTREAM_UNAVAILABLE', 'Servizio GPS non raggiungibile.');
  }
  if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) return json(502, 'UPSTREAM_REDIRECT', 'Risposta inattesa del servizio GPS.');
  // Never pass upstream cookies or caching to the browser.
  const out = new Headers({ 'Cache-Control': 'private, no-store', ...SECURITY_HEADERS });
  // The platform refused a token that verifies locally (e.g. revoked by a logout elsewhere):
  // drop our own copy so the next page load goes back through the shared login.
  if (upstream.status === 401) out.append('Set-Cookie', clearSessionCookie());
  if (route.project && upstream.ok && request.method === 'GET') {
    let body: unknown;
    try { body = await upstream.json(); } catch { return json(502, 'INVALID_RESPONSE', 'Risposta del servizio GPS non valida.'); }
    out.set('Content-Type', 'application/json');
    return new Response(JSON.stringify(projectRows(body, route.project)), { status: upstream.status, headers: out });
  }
  for (const name of ['Content-Type', 'ETag']) { const value = upstream.headers.get(name); if (value) out.set(name, value); }
  return new Response(upstream.status === 304 || request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

/** Keeps only `fields` of each row, for both the plain array and the paginated envelope. */
export function projectRows(body: unknown, fields: readonly string[]): unknown {
  const pick = (row: unknown) => {
    if (!row || typeof row !== 'object') return null;
    const out: Record<string, unknown> = {};
    for (const field of fields) if (field in row) out[field] = (row as Record<string, unknown>)[field];
    return out;
  };
  if (Array.isArray(body)) return body.map(pick).filter(Boolean);
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    const envelope = body as { data: unknown[]; page?: unknown; limit?: unknown; count?: unknown };
    return { data: envelope.data.map(pick).filter(Boolean), page: envelope.page, limit: envelope.limit, count: envelope.count };
  }
  return { data: [] };
}
