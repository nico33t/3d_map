export interface Camera {
    id: string;
    name: string;
    longitude: number;
    latitude: number;
    radiusMeters: number;
    enabled: boolean;
}
export interface Position {
    longitude: number;
    latitude: number;
}
export function distanceMeters(a: Position, b: Position): number {
    const rad = Math.PI / 180;
    const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function nearbyCameras(cameras: readonly Camera[], position: Position, previous: ReadonlySet<string> = new Set()): Camera[] {
    return cameras.filter(c => c.enabled && distanceMeters(c, position) <= c.radiusMeters * (previous.has(c.id) ? 1.15 : 1)).sort((a, b) => distanceMeters(a, position) - distanceMeters(b, position));
}
