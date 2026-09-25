import type { Location } from '@3d-map/aitrack';
export interface LiveMessage { type: 'location' | 'problem'; data: unknown }
type Listener = (message: LiveMessage) => void;
interface Watch { listeners: Set<Listener>; last?: Location; timer?: ReturnType<typeof setTimeout>; busy: boolean; failures: number }
export function nextPollDelay(location?: Location, previous?: Location): number {
  if (!location) return 15_000;
  if (Date.now() - Date.parse(location.recorded_at) > 180_000) return 60_000;
  if (location.speed_kmh < 2) return 45_000;
  const cadence = previous ? Date.parse(location.recorded_at) - Date.parse(previous.recorded_at) : 10_000;
  return Math.max(10_000, Math.min(30_000, cadence > 0 ? cadence : 10_000));
}
/** One adaptive upstream watch per IMEI, shared by all browser tabs. */
export function createLocationHub(fetchLocation: (imei: string) => Promise<Location>) {
  const watches = new Map<string, Watch>();
  let stopped = false;
  const refresh = async (imei: string, watch: Watch) => {
    if (stopped || watches.get(imei) !== watch || watch.busy) return;
    clearTimeout(watch.timer); watch.busy = true;
    let delay = 15_000;
    try {
      const location = await fetchLocation(imei);
      if (!Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180 || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 85.051129 || !Number.isFinite(Date.parse(location.recorded_at))) throw new Error('Posizione Aitrack non valida.');
      delay = nextPollDelay(location, watch.last); watch.failures = 0;
      if (!watch.last || Date.parse(location.recorded_at) > Date.parse(watch.last.recorded_at)) {
        watch.last = location;
        for (const listener of watch.listeners) listener({ type: 'location', data: location });
      }
    } catch {
      watch.failures++;
      delay = Math.min(120_000, 15_000 * 2 ** Math.min(watch.failures, 3));
      for (const listener of watch.listeners) listener({ type: 'problem', data: { message: 'Aitrack non disponibile. Riconnessione automatica…' } });
    } finally {
      watch.busy = false;
      if (!stopped && watches.get(imei) === watch && watch.listeners.size) watch.timer = setTimeout(() => void refresh(imei, watch), delay);
    }
  };
  return {
    subscribe(imei: string, listener: Listener) {
      if (!/^\d{10,20}$/.test(imei)) throw new Error('Invalid IMEI.');
      let watch = watches.get(imei);
      if (!watch) { watch = { listeners: new Set(), busy: false, failures: 0 }; watches.set(imei, watch); }
      watch.listeners.add(listener);
      if (watch.last) listener({ type: 'location', data: watch.last });
      else void refresh(imei, watch);
      const active = watch;
      return () => { active.listeners.delete(listener); if (!active.listeners.size) { clearTimeout(active.timer); watches.delete(imei); } };
    },
    // Event payload schemas are not documented: refresh active devices instead of inventing coordinates.
    notifyEvent() { for (const [imei, watch] of watches) void refresh(imei, watch); },
    get activeDevices() { return watches.size; },
    close() { stopped = true; for (const watch of watches.values()) { clearTimeout(watch.timer); watch.listeners.clear(); } watches.clear(); },
  };
}
