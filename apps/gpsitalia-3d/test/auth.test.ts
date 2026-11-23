import { beforeAll, describe, expect, it } from 'vitest';
import { decideAccess, readCookie, verifyPlatformToken, importPublicKey, SESSION_COOKIE, type AccessEnv } from '../src/auth';

// Keys generated per run: no real key material in the repository.
let signer: CryptoKey, otherSigner: CryptoKey, pem = '';
const NOW = 1_800_000_000;
const ORIGIN = 'https://3d.example.test';

const b64url = (bytes: Uint8Array | string) => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let binary = ''; for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const generate = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);

async function sign(claims: Record<string, unknown>, key = signer, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' }) {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  return `${input}.${b64url(signature)}`;
}
const claims = (extra: Record<string, unknown> = {}) => ({ id: 1, name: 'Prova', surname: 'Utente', email: 'prova@example.test', role: 'creator', jti: 'x', iat: NOW - 10, exp: NOW + 3600, ...extra });
const env = (): AccessEnv => ({ JWT_PUBLIC_KEY: pem, AUTH_URL: 'https://auth.example.test', APP_URL: 'https://app.example.test' });
const request = (path: string, init: { cookie?: string; method?: string } = {}) =>
  new Request(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers: init.cookie ? { Cookie: init.cookie } : {} });

beforeAll(async () => {
  const pair = await generate();
  signer = pair.privateKey;
  otherSigner = (await generate()).privateKey;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  let binary = ''; for (const byte of spki) binary += String.fromCharCode(byte);
  pem = `-----BEGIN PUBLIC KEY-----\n${btoa(binary).match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
});

describe('verifyPlatformToken', () => {
  it('accepts a valid app access token', async () => {
    const result = await verifyPlatformToken(await sign(claims()), await importPublicKey(pem), NOW);
    expect(result).toEqual({ ok: true, user: { id: '1', name: 'Prova Utente', role: 'creator', exp: NOW + 3600 } });
  });
  it('accepts a PEM written on one line with literal \\n', async () => {
    const result = await verifyPlatformToken(await sign(claims()), await importPublicKey(pem.replace(/\n/g, '\\n')), NOW);
    expect(result.ok).toBe(true);
  });
  it.each([
    ['signed by another key', async () => sign(claims(), otherSigner), 'signature'],
    ['expired', async () => sign(claims({ exp: NOW })), 'expired'],
    ['issued in the future', async () => sign(claims({ iat: NOW + 600 })), 'not-yet-valid'],
    ['admin audience', async () => sign(claims({ aud: 'admin' })), 'audience'],
    ['refresh token', async () => sign(claims({ typ: 'refresh', rtv: 1 })), 'audience'],
    ['alg none', async () => sign(claims(), signer, { alg: 'none' }), 'algorithm'],
    ['HS256 header', async () => sign(claims(), signer, { alg: 'HS256' }), 'algorithm'],
    ['missing role', async () => sign(claims({ role: undefined })), 'claims'],
    ['missing exp', async () => sign(claims({ exp: undefined })), 'claims'],
    ['garbage', async () => 'not.a.jwt!', 'malformed'],
    ['two parts', async () => 'abc.def', 'malformed'],
  ])('rejects a token %s', async (_label, make, reason) => {
    const result = await verifyPlatformToken(await make(), await importPublicKey(pem), NOW);
    expect(result).toEqual({ ok: false, reason });
  });
  it('rejects a payload tampered after signing', async () => {
    const [header, , signature] = (await sign(claims({ role: 'user' }))).split('.');
    const forged = `${header}.${b64url(JSON.stringify(claims()))}.${signature}`;
    expect(await verifyPlatformToken(forged, await importPublicKey(pem), NOW)).toEqual({ ok: false, reason: 'signature' });
  });
});

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; map3d_session=abc; authToken=def', 'map3d_session')).toBe('abc');
    expect(readCookie('xauthToken=1', 'authToken')).toBeUndefined();
    expect(readCookie(null, 'authToken')).toBeUndefined();
  });
});

describe('decideAccess', () => {
  it('redirects to the shared login when there is no session, without leaking tokens', async () => {
    const decision = await decideAccess(request('/timelapse?imei=1'), env(), NOW);
    expect(decision.kind).toBe('respond');
    if (decision.kind !== 'respond') return;
    expect(decision.response.status).toBe(302);
    const location = new URL(decision.response.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://auth.example.test/login');
    expect(location.searchParams.get('redirect')).toBe(`${ORIGIN}/timelapse?imei=1`);
    expect(decision.response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('answers 401 JSON instead of redirecting API calls', async () => {
    const decision = await decideAccess(request('/api/session'), env(), NOW);
    expect(decision.kind === 'respond' && decision.response.status).toBe(401);
    if (decision.kind === 'respond') expect(decision.response.headers.get('Content-Type')).toContain('application/json');
  });

  it('admits a creator from the shared authToken cookie', async () => {
    const decision = await decideAccess(request('/', { cookie: `authToken=${await sign(claims())}` }), env(), NOW);
    expect(decision).toMatchObject({ kind: 'allow', user: { role: 'creator' } });
  });

  it('uses the own session cookie first when both are valid creators', async () => {
    const own = await sign(claims({ id: 7 }));
    const shared = await sign(claims({ id: 8 }));
    const decision = await decideAccess(request('/', { cookie: `authToken=${shared}; ${SESSION_COOKIE}=${own}` }), env(), NOW);
    expect(decision).toMatchObject({ kind: 'allow', user: { id: '7' }, token: own });
  });

  it('a non-creator own cookie (e.g. a foreign ?token= link) never locks out a signed-in creator', async () => {
    const own = await sign(claims({ id: 7, role: 'user' }));
    const shared = await sign(claims({ id: 8 }));
    const decision = await decideAccess(request('/', { cookie: `${SESSION_COOKIE}=${own}; authToken=${shared}` }), env(), NOW);
    expect(decision).toMatchObject({ kind: 'allow', user: { id: '8' }, token: shared });
  });

  it('falls back to the shared cookie when the own one has expired', async () => {
    const own = await sign(claims({ id: 7, exp: NOW - 1 }));
    const shared = await sign(claims({ id: 8 }));
    const decision = await decideAccess(request('/', { cookie: `${SESSION_COOKIE}=${own}; authToken=${shared}` }), env(), NOW);
    expect(decision).toMatchObject({ kind: 'allow', user: { id: '8' } });
  });

  it('shows «non disponibile» (403) to every role except creator, for pages and API', async () => {
    for (const role of ['admin', 'dev', 'reseller', 'user']) {
      const cookie = `authToken=${await sign(claims({ role }))}`;
      const page = await decideAccess(request('/', { cookie }), env(), NOW);
      expect(page.kind === 'respond' && page.response.status).toBe(403);
      if (page.kind === 'respond') expect(await page.response.text()).toContain('non disponibile');
      const api = await decideAccess(request('/api/session', { cookie }), env(), NOW);
      expect(api.kind === 'respond' && api.response.status).toBe(403);
    }
  });

  it('honours ALLOWED_ROLES when the founder opens the map to more roles', async () => {
    const decision = await decideAccess(request('/', { cookie: `authToken=${await sign(claims({ role: 'admin' }))}` }), { ...env(), ALLOWED_ROLES: 'creator, admin' }, NOW);
    expect(decision.kind).toBe('allow');
  });

  it('stores the returned access token in a host-only httpOnly cookie, drops the refresh token and cleans the URL', async () => {
    const token = await sign(claims());
    const decision = await decideAccess(request(`/storico?giorno=1&token=${token}&refreshToken=secret-refresh`), env(), NOW);
    expect(decision.kind === 'respond' && decision.response.status).toBe(302);
    if (decision.kind !== 'respond') return;
    expect(decision.response.headers.get('Location')).toBe(`${ORIGIN}/storico?giorno=1`);
    const cookie = decision.response.headers.get('Set-Cookie')!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/Secure/); expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toContain('Max-Age=3600');
    expect(cookie).not.toContain('secret-refresh');
    expect(decision.response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('does not bounce back to auth when the returned token is invalid (no redirect loop)', async () => {
    const decision = await decideAccess(request(`/?token=${await sign(claims(), otherSigner)}`), env(), NOW);
    expect(decision.kind === 'respond' && decision.response.status).toBe(401);
  });

  it('logs out everywhere through auth and clears the own cookie', async () => {
    const decision = await decideAccess(request('/logout'), env(), NOW);
    if (decision.kind !== 'respond') throw new Error('expected a response');
    const location = new URL(decision.response.headers.get('Location')!);
    expect(location.searchParams.get('logout')).toBe('1');
    expect(location.searchParams.get('redirect')).toBe(`${ORIGIN}/`);
    expect(decision.response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('serves robots.txt without a session', async () => {
    expect((await decideAccess(request('/robots.txt'), env(), NOW)).kind).toBe('public');
  });

  it('fails closed with 503 when the public key is not configured', async () => {
    const decision = await decideAccess(request('/', { cookie: `authToken=${await sign(claims())}` }), { ...env(), JWT_PUBLIC_KEY: '' }, NOW);
    expect(decision.kind === 'respond' && decision.response.status).toBe(503);
  });
});
