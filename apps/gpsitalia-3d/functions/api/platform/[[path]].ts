import type { AccessEnv } from '../../../src/auth';
import { proxyPlatform } from '../../../src/proxy';

/** Read-only platform data. The middleware has re-checked token and role for this very request. */
export const onRequest = (context: { request: Request; env: AccessEnv; data: { token?: string } }): Promise<Response> | Response => {
  if (!context.data.token) return new Response(null, { status: 401 });
  return proxyPlatform(context.request, context.data.token, context.env);
};
