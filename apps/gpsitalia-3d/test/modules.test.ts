import { describe, expect, it } from 'vitest';
import { moduleAssetDenied, moduleEnabled, userModules, VIDEO_ASSET_PREFIX } from '../src/modules';

const creator = { id: '1', role: 'creator' };
const admin = { id: '2', role: 'admin' };

describe('moduleEnabled', () => {
  it.each([undefined, '', '   ', ',', 'creator', 'role:', 'role:*', 'ROLE:creator', 'role:creator;id:2', 'id:1 2', 'role:crea tor'])(
    'grants nothing for %o', (rules) => {
      expect(moduleEnabled(rules, creator)).toBe(false);
    });

  it('switches on by role', () => {
    expect(moduleEnabled('role:creator', creator)).toBe(true);
    expect(moduleEnabled('role:creator', admin)).toBe(false);
  });

  it('switches on by user id, ignoring malformed neighbours', () => {
    expect(moduleEnabled('garbage, id:2 , role:x', admin)).toBe(true);
    expect(moduleEnabled('id:2', creator)).toBe(false);
  });

  it('an id rule never matches a role named like it, and vice versa', () => {
    expect(moduleEnabled('id:creator', creator)).toBe(false);
    expect(moduleEnabled('role:1', creator)).toBe(false);
  });
});

describe('userModules', () => {
  it('is off for everyone when the module is not configured, creator included', () => {
    expect(userModules({}, creator)).toEqual({ video: false });
  });
  it('opening the map to more roles does not open the module', () => {
    expect(userModules({ ALLOWED_ROLES: 'creator, admin' } as never, admin)).toEqual({ video: false });
  });
  it('reads MODULO_VIDEO', () => {
    expect(userModules({ MODULO_VIDEO: 'role:creator' }, creator)).toEqual({ video: true });
    expect(userModules({ MODULO_VIDEO: 'role:creator' }, admin)).toEqual({ video: false });
  });
});

describe('moduleAssetDenied', () => {
  const bundle = `${VIDEO_ASSET_PREFIX}Ab12Cd.js`;
  it('hides the video bundle from users without the module', () => {
    expect(moduleAssetDenied(bundle, {}, creator)).toBe(true);
    expect(moduleAssetDenied(bundle, { MODULO_VIDEO: 'role:creator' }, admin)).toBe(true);
  });
  it('serves it to enabled users', () => {
    expect(moduleAssetDenied(bundle, { MODULO_VIDEO: 'role:creator' }, creator)).toBe(false);
  });
  it('leaves every other asset alone', () => {
    expect(moduleAssetDenied('/assets/index-Ab12.js', {}, creator)).toBe(false);
    expect(moduleAssetDenied('/assets/other.js', {}, creator)).toBe(false);
  });
});
