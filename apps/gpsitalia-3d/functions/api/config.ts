import { SECURITY_HEADERS } from '../../src/auth';

interface ConfigEnv { MAPBOX_TOKEN?: string; APP_URL?: string }

/**
 * Browser configuration, served only after the middleware admitted the user:
 * the public Mapbox token never sits in the static bundle.
 */
export const onRequestGet = (context: { env: ConfigEnv }): Response => {
  const token = context.env.MAPBOX_TOKEN ?? '';
  const ok = token.startsWith('pk.');
  return new Response(JSON.stringify(ok ? { data: { mapboxToken: token, appUrl: context.env.APP_URL ?? 'https://app.gpsitalia.com' } } : { error: { code: 'NOT_CONFIGURED', message: 'Mappa non configurata.' } }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
  });
};
