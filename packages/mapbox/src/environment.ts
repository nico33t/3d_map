import type { MapSession } from '@3d-map/core';
import { sessions } from './internal.js';

export type LightPreset = 'day' | 'dawn' | 'dusk' | 'night';

/** Mapbox Standard visual effects; changing light does not reload the style. */
export function setMapboxEnvironment(session: MapSession, options: { light?: LightPreset; rain?: boolean }): void {
  const context = sessions.get(session);
  if (!context) throw new Error('An active Mapbox session is required.');
  if (options.light) context.map.setConfigProperty('basemap', 'lightPreset', options.light);
  if (options.rain !== undefined) context.map.setRain(options.rain ? {
    density: 0.5, intensity: 1, color: '#b2c4dc', opacity: 0.7,
    vignette: 0.6, 'vignette-color': '#283449', direction: [0, 80],
    'droplet-size': [2.6, 18.2], 'distortion-strength': 0.5, 'center-thinning': 0,
  } : null);
}
