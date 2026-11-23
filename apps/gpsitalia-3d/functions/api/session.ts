import { SECURITY_HEADERS, type PlatformUser } from '../../src/auth';

/** Who is signed in. The middleware has already admitted the user. */
export const onRequestGet = (context: { data: { user?: PlatformUser } }): Response => {
  const user = context.data.user;
  return new Response(JSON.stringify(user ? { data: { name: user.name, role: user.role, expiresAt: new Date(user.exp * 1000).toISOString() } } : { error: { code: 'UNAUTHENTICATED' } }), {
    status: user ? 200 : 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
  });
};
