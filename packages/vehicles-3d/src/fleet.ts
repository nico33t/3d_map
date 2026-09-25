import { getVehicle } from './index.js';

/** Host-provided storage keeps this module usable independently of the browser or map engine. */
export interface FleetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function createFleetAssignments(storage: FleetStorage, key = '3d-map.fleet.models.v1') {
  let assignments: Record<string, string> = Object.create(null);
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [imei, model] of Object.entries(parsed)) {
        if (/^\d{10,20}$/.test(imei) && typeof model === 'string' && getVehicle(model)) assignments[imei] = model;
      }
    }
  } catch { /* Corrupt or unavailable storage must not prevent tracking. */ }
  return {
    get(imei: string) { return assignments[imei]; },
    /** Returns false when the assignment works in memory but cannot be persisted. */
    set(imei: string, model: string): boolean {
      if (!/^\d{10,20}$/.test(imei) || !getVehicle(model)) throw new Error('Invalid fleet assignment.');
      assignments[imei] = model;
      try { storage.setItem(key, JSON.stringify(assignments)); return true; } catch { return false; }
    },
  };
}
