/**
 * Optional modules that are not part of any plan: each one is off for everyone
 * until it is switched on in the server environment, user by user or role by role.
 *
 * MODULO_VIDEO="role:creator"        every user with that role
 * MODULO_VIDEO="id:42, id:57"        only those user ids
 *
 * The decision is made on the server from the verified token, never from the client.
 */
export interface ModulesEnv {
  MODULO_VIDEO?: string;
}

export interface ModuleUser {
  id: string;
  role: string;
}

export interface UserModules {
  video: boolean;
}

/** Bundles of a module are emitted under this prefix and served only to enabled users. */
export const VIDEO_ASSET_PREFIX = '/assets/modulo-video-';

const RULE = /^(role|id):([\w.-]{1,64})$/;

/** True when the rule list names the user's id or role. Empty, unset or malformed entries grant nothing. */
export function moduleEnabled(rules: string | undefined, user: ModuleUser): boolean {
  if (!rules) return false;
  for (const raw of rules.split(',')) {
    const match = RULE.exec(raw.trim());
    if (!match) continue;
    const [, kind, value] = match;
    if (kind === 'role' && value === user.role) return true;
    if (kind === 'id' && value === user.id) return true;
  }
  return false;
}

export function userModules(env: ModulesEnv, user: ModuleUser): UserModules {
  return { video: moduleEnabled(env.MODULO_VIDEO, user) };
}

/** True when the request asks for a module bundle the user has not been given. */
export function moduleAssetDenied(pathname: string, env: ModulesEnv, user: ModuleUser): boolean {
  return pathname.startsWith(VIDEO_ASSET_PREFIX) && !userModules(env, user).video;
}
