import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { audiA1, vehicles, paintVehicleGlb, resolveVehicleColor } from '../src/index.js';
const original = readFileSync(new URL('../assets/audi/audi-a1-quattro.glb', import.meta.url));
const input = original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength) as ArrayBuffer;
function json(buffer: ArrayBuffer) { return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, new DataView(buffer).getUint32(12, true)))); }
describe('vehicle body paint', () => {
  it('defaults to silver only for supported models and validates saved choices', () => {
    expect(resolveVehicleColor(audiA1)).toBe('silver');
    expect(resolveVehicleColor(audiA1, 'invalid')).toBe('silver');
    expect(resolveVehicleColor(audiA1, 'red')).toBe('red');
    expect(resolveVehicleColor(vehicles[0]!, 'red')).toBe('original');
  });
  it('changes only Audi body color, preserving other materials, geometry, and embedded textures', async () => {
    const painted = await paintVehicleGlb(input, audiA1, 'zinc').arrayBuffer();
    const before = json(input), after = json(painted);
    const index = before.materials.findIndex((m: {name:string}) => audiA1.paint!.materials.includes(m.name));
    const factor = after.materials[index].pbrMetallicRoughness.baseColorFactor;
    expect(factor.slice(0, 2)).toEqual([expect.closeTo(.3564, 3), expect.closeTo(.3564, 3)]);
    expect(factor[3]).toBe(1);
    after.materials[index].pbrMetallicRoughness.baseColorFactor = before.materials[index].pbrMetallicRoughness.baseColorFactor;
    expect(after).toEqual(before);
    const tail = (b: ArrayBuffer) => new Uint8Array(b, 20 + new DataView(b).getUint32(12, true));
    expect(Buffer.compare(Buffer.from(tail(input)), Buffer.from(tail(painted)))).toBe(0);
    expect(new DataView(painted).getUint32(8, true)).toBe(painted.byteLength);
    expect(painted.byteLength % 4).toBe(0);
  });
  it('can restore the original model exactly', async () => {
    const restored = await paintVehicleGlb(input, audiA1, 'original').arrayBuffer();
    expect(Buffer.compare(Buffer.from(restored), original)).toBe(0);
    expect(() => paintVehicleGlb(new ArrayBuffer(20), audiA1)).toThrow();
  });
});

it('isolates only front and rear Audi rings and preserves all triangles and existing materials', async () => {
  const output = await paintVehicleGlb(input, audiA1, 'original', 'black').arrayBuffer();
  const before = json(input), after = json(output);
  expect(after.materials.slice(0, before.materials.length)).toEqual(before.materials);
  expect(after.materials.at(-1).pbrMetallicRoughness.baseColorFactor).toEqual([.004, .004, .004, 1]);
  const changed = after.meshes.filter((m: unknown, i: number) => JSON.stringify(m) !== JSON.stringify(before.meshes[i]));
  expect(changed).toHaveLength(1);
  const readIndices = (b: ArrayBuffer, d: any, accessorIndex: number) => {
    const a = d.accessors[accessorIndex], v = d.bufferViews[a.bufferView];
    const view = new DataView(b), offset = 28 + view.getUint32(12, true) + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return Array.from({length: a.count}, (_, i) => a.componentType === 5123 ? view.getUint16(offset + i * 2, true) : view.getUint32(offset + i * 4, true));
  };
  const chromeIndex = before.materials.findIndex((m: any) => m.name.endsWith('_ChromeTrims'));
  const originalMesh = before.meshes.find((m: any) => m.primitives[0].material === chromeIndex);
  const originalIndices = readIndices(input, before, originalMesh.primitives[0].indices);
  const trims = readIndices(output, after, changed[0].primitives[0].indices);
  const rings = readIndices(output, after, changed[0].primitives[1].indices);
  const triangles = (indices: number[]) => Array.from({length: indices.length / 3}, (_, i) => indices.slice(i * 3, i * 3 + 3).join(',')).sort();
  expect(triangles([...trims, ...rings])).toEqual(triangles(originalIndices));
  expect(rings.length).toBeGreaterThan(1000);
  expect(changed[0].primitives[1].material).toBe(before.materials.length);
  const a = before.accessors[originalMesh.primitives[0].attributes.POSITION], v = before.bufferViews[a.bufferView];
  const positions = new DataView(input); const offset = 28 + positions.getUint32(12, true) + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const selected = rings.map(i => [0, 4, 8].map(k => positions.getFloat32(offset + i * (v.byteStride ?? 12) + k, true)));
  expect(selected.some(p => p[1]! < 3)).toBe(true);
  expect(selected.some(p => p[1]! > 175)).toBe(true);
  expect(selected.every(p => p[0]! > 37 && p[0]! < 50 && (p[1]! < 3 || p[1]! > 175))).toBe(true);
});
