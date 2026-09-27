import { expect, it, vi } from 'vitest';
import { areaOutline, areaWalls, areaFootprints, createAitrackClient, type Area } from '../src/index.js';

const base = { name: 'Test', color: '#ff0000', center: null, radius_m: null, buffer_m: null, points: [] };
const circle: Area = { ...base, id: 1, type: 'circle', center: { lat: 45.4642, lng: 9.19 }, radius_m: 150 };
const polygon: Area = { ...base, id: 2, type: 'polygon', points: [{ lat: 45, lng: 9 }, { lat: 45.001, lng: 9 }, { lat: 45.001, lng: 9.001 }] };
const track: Area = { ...base, id: 3, type: 'polyline', buffer_m: 20, points: [{ lat: 45, lng: 9 }, { lat: 45.001, lng: 9.001 }, { lat: 45.002, lng: 9 }] };

it('reads areas from API v3 while devices stay on v2', async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [circle] })));
  const client = createAitrackClient({ apiKey: 'test-secret', fetch: fetcher });
  await client.listAreas({ type: 'circle', limit: 50 });
  await client.getArea(42);
  await client.listDevices();
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    'https://api.aitrack.it/api/v3/areas?type=circle&limit=50',
    'https://api.aitrack.it/api/v3/areas/42',
    'https://api.aitrack.it/api/v2/devices',
  ]);
  expect(() => client.getArea(0)).toThrow();
});

it('keeps the browser proxy base for areas and paginates', async () => {
  const page = Array.from({ length: 200 }, (_, i) => ({ ...circle, id: i + 1 }));
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: page }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: [circle] })));
  const all = await createAitrackClient({ baseUrl: '/api/aitrack', fetch: fetcher }).listAllAreas();
  expect(all).toHaveLength(201);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/aitrack/areas?limit=200&offset=0', '/api/aitrack/areas?limit=200&offset=200']);
});

it('builds outlines for circles, polygons and buffered tracks', () => {
  const ring = areaOutline(circle)!;
  expect(ring).toHaveLength(72);
  const meters = (Math.abs(ring[0]![0] - 9.19) * Math.PI / 180) * 6_371_008.8 * Math.cos(45.4642 * Math.PI / 180);
  expect(meters).toBeCloseTo(150, 0);
  expect(areaOutline(polygon)).toEqual([[9, 45], [9, 45.001], [9.001, 45.001]]);
  expect(areaOutline(track)!.length).toBeGreaterThan(20);
  expect(areaOutline({ ...base, id: 4, type: 'polygon', points: [{ lat: 45, lng: 9 }] })).toBeNull();
});

it('turns each perimeter edge into a colored wall segment', () => {
  const walls = areaWalls([polygon, circle]);
  expect(walls.features).toHaveLength(3 + 72);
  expect(walls.features[0]!.properties).toEqual({ id: 2, name: 'Test', color: '#ff0000', type: 'polygon' });
  expect(walls.features[0]!.geometry.coordinates[0]).toHaveLength(5);
  expect(areaWalls([{ ...polygon, color: 'red' }]).features[0]!.properties.color).toBe('#3b82f6');
  expect(areaFootprints([polygon]).features[0]!.geometry.coordinates[0]).toHaveLength(4);
});
