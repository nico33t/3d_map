import type { MapSession } from '@3d-map/core';
import type { Map } from 'mapbox-gl';

/** Engine internals never leak through the portable core contract. */
export const sessions = new WeakMap<MapSession, { map: Map; disposers: Set<() => void> }>();
