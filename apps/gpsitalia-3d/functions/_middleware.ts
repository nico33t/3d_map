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
  return withHeaders(response, decision.kind === 'allow' ? { 'Cache-Control': 'private, no-store' } : {});
};
