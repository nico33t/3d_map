export interface VehiclePose {
  longitude: number;
  latitude: number;
  heading: number;
}
const wrap = (angle: number) => ((angle % 360) + 360) % 360;

/** Frame-clock driven interpolation. Retarget from the displayed pose, never extrapolate GPS. */
export function createVehicleMotion() {
  let current: VehiclePose | undefined;
  let start: VehiclePose | undefined;
  let target: VehiclePose | undefined;
  let elapsed = 0;
  let duration = 0;
  return {
    get active() { return elapsed < duration; },
    reset() { current = start = target = undefined; elapsed = duration = 0; },
    target(pose: VehiclePose, durationMs = 10_000): VehiclePose {
      if (![pose.longitude, pose.latitude, pose.heading, durationMs].every(Number.isFinite)
        || Math.abs(pose.longitude) > 180 || Math.abs(pose.latitude) > 85.051129 || durationMs < 0) throw new RangeError('Invalid vehicle motion target.');
      target = { ...pose, heading: wrap(pose.heading) };
      if (current) current = { ...current, heading: target.heading };
      start = current ? { ...current } : { ...target };
      elapsed = 0;
      duration = current && (current.longitude !== target.longitude || current.latitude !== target.latitude) ? durationMs : 0;
      if (duration === 0) current = { ...target };
      return { ...current! };
    },
    advance(deltaMs: number): VehiclePose | undefined {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('Invalid frame delta.');
      if (!start || !target) return undefined;
      elapsed = Math.min(duration, elapsed + deltaMs);
      const t = duration ? elapsed / duration : 1;
      // Position eases; direction changes immediately when a fix arrives.
      const ratio = t * t * (3 - 2 * t);
      const longitudeDelta = wrap(target.longitude - start.longitude + 180) - 180;
      current = {
        longitude: t === 1 ? target.longitude : wrap(start.longitude + longitudeDelta * ratio + 180) - 180,
        latitude: start.latitude + (target.latitude - start.latitude) * ratio,
        heading: target.heading,
      };
      return { ...current };
    },
  };
}
