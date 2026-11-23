/**
 * Access layer for 3d.gpsitalia.com, designed to run in a Cloudflare Pages Function.
 *
 * Login is shared with the platform: auth.gpsitalia.com issues an RS256 JWT that
 * reaches this site either as the shared `authToken` cookie or as `?token=` after
 * a login redirect. Only the public key is used here; no secret lives in the code.
 */

export interface AccessEnv {
  /** PEM (SPKI) public key of the platform tokens. Required. */
  JWT_PUBLIC_KEY?: string;
  /** Default https://auth.gpsitalia.com */
  AUTH_URL?: string;
  /** Default https://app.gpsitalia.com */
  APP_URL?: string;
  /** Comma separated roles admitted. Default "creator". */
  ALLOWED_ROLES?: string;
  /** Platform server origin used by the read-only proxy, e.g. https://api.example.com. Required for /api/platform. */
  PLATFORM_API_URL?: string;
}

export interface PlatformUser {
  id: string;
  name: string;
  role: string;
  exp: number;
}

export type TokenCheck =
  | { ok: true; user: PlatformUser }
  | { ok: false; reason: 'malformed' | 'algorithm' | 'signature' | 'expired' | 'not-yet-valid' | 'audience' | 'claims' };

export const SESSION_COOKIE = 'map3d_session';
export const SHARED_COOKIE = 'authToken';
const CLOCK_SKEW_S = 60;

const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const decodeJson = (segment: string): unknown => JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));

const keyCache = new Map<string, Promise<CryptoKey>>();

export function importPublicKey(pem: string): Promise<CryptoKey> {
  let key = keyCache.get(pem);
  if (!key) {
    const body = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
    if (!body) return Promise.reject(new Error('Missing public key.'));
    const der = base64UrlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_'));
    key = crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    keyCache.set(pem, key);
    key.catch(() => keyCache.delete(pem));
  }
  return key;
}

/** Verifies an app access token of the platform (same rules as the platform's other apps). */
export async function verifyPlatformToken(token: string, publicKey: CryptoKey, nowS = Math.floor(Date.now() / 1000)): Promise<TokenCheck> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return { ok: false, reason: 'malformed' };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: unknown, payload: unknown;
  try { header = decodeJson(headerPart); payload = decodeJson(payloadPart); } catch { return { ok: false, reason: 'malformed' }; }
  if (!header || typeof header !== 'object' || (header as { alg?: unknown }).alg !== 'RS256') return { ok: false, reason: 'algorithm' };
  let valid = false;
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64UrlToBytes(signaturePart), new TextEncoder().encode(`${headerPart}.${payloadPart}`));
  } catch { valid = false; }
  if (!valid) return { ok: false, reason: 'signature' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'claims' };
  const claims = payload as Record<string, unknown>;
  // Admin tokens carry aud, refresh tokens carry typ/rtv: neither is an app access token.
  if ('aud' in claims || 'typ' in claims || 'rtv' in claims) return { ok: false, reason: 'audience' };
  const { exp, iat, id, role } = claims;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return { ok: false, reason: 'claims' };
  if (exp <= nowS) return { ok: false, reason: 'expired' };
  if (typeof iat === 'number' && iat > nowS + CLOCK_SKEW_S) return { ok: false, reason: 'not-yet-valid' };
  if ((typeof id !== 'number' && typeof id !== 'string') || typeof role !== 'string' || !role) return { ok: false, reason: 'claims' };
  const name = [claims.name, claims.surname].filter(part => typeof part === 'string' && part).join(' ');
  return { ok: true, user: { id: String(id), name, role, exp } };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return undefined;
}

const allowedRoles = (env: AccessEnv) => (env.ALLOWED_ROLES ?? 'creator').split(',').map(role => role.trim()).filter(Boolean);
const authUrl = (env: AccessEnv) => (env.AUTH_URL ?? 'https://auth.gpsitalia.com').replace(/\/$/, '');
const appUrl = (env: AccessEnv) => env.APP_URL ?? 'https://app.gpsitalia.com';

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const withHeaders = (response: Response, extra: Record<string, string> = {}) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function messagePage(status: number, title: string, text: string, link: { href: string; label: string }) {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#111;font:16px/1.5 system-ui,sans-serif}main{max-width:420px;padding:24px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#555;margin:0 0 20px}a{display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}p{color:#aaa}a{background:#eee;color:#111}}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS } });
}

const sessionCookie = (token: string, maxAgeS: number) => `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeS))}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const isApiRequest = (url: URL) => url.pathname === '/api' || url.pathname.startsWith('/api/');
const PUBLIC_PATHS = new Set(['/robots.txt']);

export type AccessDecision =
  | { kind: 'allow'; user: PlatformUser; token: string }
  | { kind: 'respond'; response: Response };

/**
 * Decides what to do with a request before any page, asset or API is served.
 * Pure function of request, env and clock: unit tested without Cloudflare.
 */
export async function decideAccess(request: Request, env: AccessEnv, nowS = Math.floor(Date.now() / 1000)): Promise<AccessDecision | { kind: 'public' }> {
  const url = new URL(request.url);
  if (PUBLIC_PATHS.has(url.pathname)) return { kind: 'public' };

  if (url.pathname === '/logout') {
    const back = new URL('/login', authUrl(env));
    back.searchParams.set('logout', '1');
    back.searchParams.set('redirect', `${url.origin}/`);
    return { kind: 'respond', response: redirect(back.toString(), [clearSessionCookie()]) };
  }

  let key: CryptoKey;
  try { key = await importPublicKey(env.JWT_PUBLIC_KEY ?? ''); }
  catch {
    return { kind: 'respond', response: messagePage(503, 'Mappa 3D non configurata', 'L’accesso non può essere verificato in questo momento. Riprova più tardi.', { href: appUrl(env), label: 'Torna all’app' }) };
  }

  const loginRedirect = () => {
    const target = new URL('/login', authUrl(env));
    const back = new URL(url.toString());
    back.searchParams.delete('token'); back.searchParams.delete('refreshToken');
    target.searchParams.set('redirect', back.toString());
    return redirect(target.toString(), [clearSessionCookie()]);
  };

  // Return from auth.gpsitalia.com with ?token=…&refreshToken=…: keep only the
  // access token in a host-only httpOnly cookie, drop the refresh token, clean the URL.
  const returned = url.searchParams.get('token');
  if (returned !== null) {
    const clean = new URL(url.toString());
    clean.searchParams.delete('token'); clean.searchParams.delete('refreshToken');
    const check = await verifyPlatformToken(returned, key, nowS);
    if (!check.ok) {
      // Never bounce back to auth here: a key mismatch would loop forever.
      return { kind: 'respond', response: messagePage(401, 'Accesso non riuscito', 'Non è stato possibile verificare l’accesso. Riprova dall’app.', { href: appUrl(env), label: 'Torna all’app' }) };
    }
    return { kind: 'respond', response: redirect(clean.toString(), [sessionCookie(returned, check.user.exp - nowS)]) };
  }

  const cookies = request.headers.get('Cookie');
  const candidates = [readCookie(cookies, SESSION_COOKIE), readCookie(cookies, SHARED_COOKIE)].filter((value): value is string => Boolean(value));
  // First valid token with an admitted role wins; otherwise keep the first valid
  // one for the 403 page. A stale or foreign own cookie can never lock out a
  // creator who is signed in on the shared cookie.
  const roles = allowedRoles(env);
  let user: PlatformUser | undefined, token = '';
  for (const candidate of candidates) {
    const check = await verifyPlatformToken(candidate, key, nowS);
    if (!check.ok) continue;
    if (roles.includes(check.user.role)) { user = check.user; token = candidate; break; }
    if (!user) user = check.user;
  }

  if (!user) {
    if (isApiRequest(url) || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return { kind: 'respond', response: new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sessione scaduta.' } }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS } }) };
    }
    return { kind: 'respond', response: loginRedirect() };
  }

  if (!roles.includes(user.role)) {
    if (isApiRequest(url)) {
      return { kind: 'respond', response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Non disponibile.' } }), { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS } }) };
    }
    return { kind: 'respond', response: messagePage(403, 'Mappa 3D non disponibile', 'Questa funzione non è ancora disponibile per il tuo account.', { href: appUrl(env), label: 'Vai all’app GPS Italia' }) };
  }

  return { kind: 'allow', user, token };
}

export { withHeaders };
