import { decideAccess, withHeaders, type AccessEnv, type PlatformUser } from '../src/auth';
import { moduleAssetDenied, type ModulesEnv } from '../src/modules';

interface Context {
  request: Request;
  env: AccessEnv & ModulesEnv;
  data: { user?: PlatformUser; token?: string };
  next: () => Promise<Response>;
}

/** Runs before every page, asset and API route of the Pages project. */
export const onRequest = async (context: Context): Promise<Response> => {
  const decision = await decideAccess(context.request, context.env);
  if (decision.kind === 'respond') return decision.response;
  if (decision.kind === 'allow') { context.data.user = decision.user; context.data.token = decision.token; }
  const path = new URL(context.request.url).pathname;
  // A module bundle exists only for users the server switched it on for.
  if (decision.kind === 'allow' && moduleAssetDenied(path, context.env, decision.user)) {
    return withHeaders(new Response('Not found', { status: 404 }), { 'Cache-Control': 'private, no-store' });
  }
  const response = await context.next();
  if (decision.kind !== 'allow') return withHeaders(response);
  // Hashed bundles and models are private but cacheable; pages and data never.
  const cache = path.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : path.startsWith('/models/') ? 'private, max-age=86400' : 'private, no-store';
  return withHeaders(response, { 'Cache-Control': cache });
};
