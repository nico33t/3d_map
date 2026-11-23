import { decideAccess, withHeaders, type AccessEnv, type PlatformUser } from '../src/auth';

interface Context {
  request: Request;
  env: AccessEnv;
  data: { user?: PlatformUser; token?: string };
  next: () => Promise<Response>;
}

/** Runs before every page, asset and API route of the Pages project. */
export const onRequest = async (context: Context): Promise<Response> => {
  const decision = await decideAccess(context.request, context.env);
  if (decision.kind === 'respond') return decision.response;
  if (decision.kind === 'allow') { context.data.user = decision.user; context.data.token = decision.token; }
  const response = await context.next();
  if (decision.kind !== 'allow') return withHeaders(response);
  const path = new URL(context.request.url).pathname;
  // Hashed bundles and models are private but cacheable; pages and data never.
  const cache = path.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : path.startsWith('/models/') ? 'private, max-age=86400' : 'private, no-store';
  return withHeaders(response, { 'Cache-Control': cache });
};
