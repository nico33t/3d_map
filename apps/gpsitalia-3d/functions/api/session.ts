import { SECURITY_HEADERS, type PlatformUser } from '../../src/auth';
import { userModules, type ModulesEnv } from '../../src/modules';

/** Who is signed in, and which optional modules the server has switched on for them. */
export const onRequestGet = (context: { env: ModulesEnv; data: { user?: PlatformUser } }): Response => {
  const user = context.data.user;
  const body = user
    ? { data: { name: user.name, role: user.role, expiresAt: new Date(user.exp * 1000).toISOString(), modules: userModules(context.env, user) } }
    : { error: { code: 'UNAUTHENTICATED' } };
  return new Response(JSON.stringify(body), {
    status: user ? 200 : 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
  });
};
