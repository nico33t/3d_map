export type RoutePoint = readonly [longitude: number, latitude: number];
const radians = Math.PI / 180;

function distance(a: RoutePoint, b: RoutePoint): number {
  const lat1 = a[1] * radians;
  const lat2 = b[1] * radians;
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((b[0] - a[0]) * radians / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Local road-route interpolation in meters, independent of animation and map SDK. */
export function createVehicleRoute(points: readonly RoutePoint[]) {
  if (points.length < 2) throw new Error('A route needs at least two points.');
  const route = points.map(([lng, lat]): RoutePoint => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85.051129) throw new RangeError('Invalid route coordinate.');
    return [lng, lat];
  });
  const lengths = route.slice(1).map((point, index) => distance(route[index]!, point));
  if (lengths.some((length) => length <= 0)) throw new Error('Consecutive route points must differ.');
  if (route.slice(1).some((point, index) => Math.abs(point[0] - route[index]![0]) > 180)) throw new Error('Split routes at the antimeridian.');
  const totalMeters = lengths.reduce((sum, length) => sum + length, 0);
  return {
    totalMeters,
    sample(meters: number) {
      if (!Number.isFinite(meters)) throw new RangeError('Distance must be finite.');
      const traveled = Math.min(totalMeters, Math.max(0, meters));
      let remaining = traveled;
      let index = 0;
      while (index < lengths.length - 1 && remaining >= lengths[index]!) { remaining -= lengths[index]!; index++; }
      const a = route[index]!;
      const b = route[index + 1]!;
      const ratio = remaining / lengths[index]!;
      const position: RoutePoint = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
      const deltaLng = (b[0] - a[0]) * radians;
      const y = Math.sin(deltaLng) * Math.cos(b[1] * radians);
      const x = Math.cos(a[1] * radians) * Math.sin(b[1] * radians) - Math.sin(a[1] * radians) * Math.cos(b[1] * radians) * Math.cos(deltaLng);
      const heading = (Math.atan2(y, x) / radians + 360) % 360;
      return { position, heading, trail: [...route.slice(0, index + 1), position], finished: traveled === totalMeters, traveled };
    },
  };
}
