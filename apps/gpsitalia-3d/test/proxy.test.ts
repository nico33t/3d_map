import { describe, expect, it } from 'vitest';
import { proxyPlatform } from '../src/proxy';

const ORIGIN = 'https://3d.example.test';
const env = { PLATFORM_API_URL: 'https://api.example.test' };
const IMEI = '000000000000001';

function recorder(response: Response = new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json', ETag: 'W/"h-1"', 'Set-Cookie': 'authToken=leak; Domain=.example.test' } })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return response.clone(); }) as unknown as typeof fetch;
  return { calls, fetcher };
}
const get = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}${path}`, init);

describe('proxyPlatform', () => {
  it.each([
    ['/api/platform/last-locations?page=2&limit=100', 'https://api.example.test/api/last-locations?page=2&limit=100'],
    ['/api/platform/vehicles?limit=1000&offset=0', 'https://api.example.test/api/vehicles?limit=1000&offset=0'],
    [`/api/platform/vehicles/${IMEI}/location`, `https://api.example.test/api/vehicles/${IMEI}/location`],
    [`/api/platform/vehicles/${IMEI}/history?start=2026-11-22T00:00:00.000Z&end=2026-11-22T23:59:59.999Z&detail=light`, `https://api.example.test/api/vehicles/${IMEI}/history?start=2026-11-22T00%3A00%3A00.000Z&end=2026-11-22T23%3A59%3A59.999Z&detail=light&limit=20000`],
  ])('forwards %s with the user token', async (path, upstream) => {
    const { calls, fetcher } = recorder();
    const response = await proxyPlatform(get(path), 'user-jwt', env, fetcher);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(upstream);
    expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe('Bearer user-jwt');
    expect(calls[0]!.init.redirect).toBe('manual');
  });

  it('drops query parameters that are not on the list', async () => {
    const { calls, fetcher } = recorder();
    await proxyPlatform(get('/api/platform/vehicles?limit=5&userId=99&role=admin'), 't', env, fetcher);
    expect(calls[0]!.url).toBe('https://api.example.test/api/vehicles?limit=5');
  });

  it.each([
    '/api/platform/commands',
    '/api/platform/vehicles/123/history',
    '/api/platform/vehicles/000000000000001/block-engine',
    '/api/platform/../admin/users',
    '/api/platform/v2/devices',
    '/api/platform/last-locations/extra',
  ])('refuses %s without calling the platform', async (path) => {
    const { calls, fetcher } = recorder();
    const response = await proxyPlatform(get(path), 't', env, fetcher);
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s: read only', async (method) => {
    const { calls, fetcher } = recorder();
    const response = await proxyPlatform(get(`/api/platform/vehicles/${IMEI}/location`, { method, body: method === 'DELETE' ? null : '{}' }), 't', env, fetcher);
    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('rejects odd query values', async () => {
    const { calls, fetcher } = recorder();
    const response = await proxyPlatform(get(`/api/platform/vehicles/${IMEI}/history?start=${encodeURIComponent('x&role=admin')}`), 't', env, fetcher);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('never passes upstream cookies and disables caching', async () => {
    const { fetcher } = recorder();
    const response = await proxyPlatform(get('/api/platform/vehicles'), 't', env, fetcher);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('ETag')).toBe('W/"h-1"');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('passes If-None-Match and returns 304 without a body', async () => {
    const { calls, fetcher } = recorder(new Response(null, { status: 304, headers: { ETag: 'W/"h-1"' } }));
    const response = await proxyPlatform(get(`/api/platform/vehicles/${IMEI}/history`, { headers: { 'If-None-Match': 'W/"h-1"' } }), 't', env, fetcher);
    expect(new Headers(calls[0]!.init.headers).get('If-None-Match')).toBe('W/"h-1"');
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });

  it('keeps 401 from the platform so the client can renew the session', async () => {
    const { fetcher } = recorder(new Response('{"error":"Token scaduto"}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
    expect((await proxyPlatform(get('/api/platform/vehicles'), 't', env, fetcher)).status).toBe(401);
  });

  it('does not follow upstream redirects', async () => {
    const { fetcher } = recorder(new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example.test/' } }));
    expect((await proxyPlatform(get('/api/platform/vehicles'), 't', env, fetcher)).status).toBe(502);
  });

  it('answers 502 when the platform is unreachable', async () => {
    const fetcher = (async () => { throw new TypeError('network'); }) as unknown as typeof fetch;
    expect((await proxyPlatform(get('/api/platform/vehicles'), 't', env, fetcher)).status).toBe(502);
  });

  it.each([{}, { PLATFORM_API_URL: 'not a url' }, { PLATFORM_API_URL: 'http://api.example.test' }])('fails closed when PLATFORM_API_URL is %o', async (badEnv) => {
    const { calls, fetcher } = recorder();
    expect((await proxyPlatform(get('/api/platform/vehicles'), 't', badEnv, fetcher)).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('bounds last-locations pages so the Worker never parses a whole fleet', async () => {
    for (const [query, expected] of [['', 'page=1&limit=200'], ['?limit=5000&page=0', 'page=1&limit=200'], ['?page=99', 'page=1&limit=200'], ['?page=3&limit=50', 'page=3&limit=50']] as const) {
      const { calls, fetcher } = recorder(new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
      await proxyPlatform(get(`/api/platform/last-locations${query}`), 't', env, fetcher);
      expect(calls[0]!.url).toBe(`https://api.example.test/api/last-locations?${expected}`);
    }
  });

  it('strips personal fields from last-locations (phone, address, io…)', async () => {
    const upstream = { data: [{ imei: '000000000000001', name: 'A', targa: 'XX', latitude: 41, longitude: 12, heading: 1, speed: 2, timestamp: 't', telefono: '+39000', address: 'Via X', io: { a: 1 }, deletion_requested_at: null }], page: 1, limit: 200, count: 1 };
    const { fetcher } = recorder(new Response(JSON.stringify(upstream), { headers: { 'Content-Type': 'application/json', ETag: 'W/"x"' } }));
    const response = await proxyPlatform(get('/api/platform/last-locations'), 't', env, fetcher);
    const body = await response.json() as { data: Record<string, unknown>[]; count: number };
    expect(Object.keys(body.data[0]!).sort()).toEqual(['heading', 'imei', 'latitude', 'longitude', 'name', 'speed', 'targa', 'timestamp']);
    expect(body.count).toBe(1);
    expect(response.headers.get('ETag')).toBeNull();
  });

  it('answers 502 when last-locations is not JSON', async () => {
    const { fetcher } = recorder(new Response('<html>', { headers: { 'Content-Type': 'text/html' } }));
    expect((await proxyPlatform(get('/api/platform/last-locations'), 't', env, fetcher)).status).toBe(502);
  });

  it('clears the own session cookie when the platform answers 401', async () => {
    const { fetcher } = recorder(new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
    const response = await proxyPlatform(get('/api/platform/vehicles'), 't', env, fetcher);
    expect(response.status).toBe(401);
    expect(response.headers.get('Set-Cookie')).toMatch(/^map3d_session=;.*Max-Age=0/);
  });

  it('bounds the history limit to 20000 points', async () => {
    for (const [query, expected] of [['', '20000'], ['?limit=100000', '20000'], ['?limit=500', '500']] as const) {
      const { calls, fetcher } = recorder();
      await proxyPlatform(get(`/api/platform/vehicles/${IMEI}/history${query}`), 't', env, fetcher);
      expect(new URL(calls[0]!.url).searchParams.get('limit')).toBe(expected);
    }
  });
});
