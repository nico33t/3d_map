import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { vehicles, audiA1 } from '../src/index.js';

it('ships valid GLB v2 containers and every referenced external texture', () => {
  const root = fileURLToPath(new URL('../assets/', import.meta.url));
  for (const vehicle of [...vehicles, audiA1]) {
    const path = resolve(root, vehicle.file);
    const bytes = readFileSync(path);
    expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    const data = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    expect(data.meshes.length).toBeGreaterThan(0);
    if (vehicle.id === audiA1.id) {
      for (const mesh of data.meshes) for (const primitive of mesh.primitives) {
        // SketchUp LINES rendered as triangles caused the white surface artifacts.
        expect(primitive.mode ?? 4).toBe(4);
        const material = data.materials[primitive.material];
        expect(material.alphaMode === 'BLEND' && material.pbrMetallicRoughness?.baseColorFactor?.[3] === 0).toBe(false);
      }
    }
    for (const resource of [...(data.images ?? []), ...(data.buffers ?? [])]) {
      if (resource.uri && !resource.uri.startsWith('data:')) {
        expect(existsSync(resolve(dirname(path), resource.uri))).toBe(true);
      }
    }
    expect(existsSync(resolve(dirname(path), 'LICENSE.txt'))).toBe(true);
  }
});

it('grounds and centers every generic vehicle under one shared, meter-scaled pivot', () => {
  for (const vehicle of vehicles) {
    const bytes = readFileSync(fileURLToPath(new URL(`../assets/${vehicle.file}`, import.meta.url)));
    const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    const roots = doc.scenes[doc.scene ?? 0].nodes;
    expect(roots).toHaveLength(1);
    const root = doc.nodes[roots[0]];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    function visit(index: number, translation: number[], scale: number[]) {
      const node = doc.nodes[index];
      const offset = translation.map((value, axis) => value + (node.translation?.[axis] ?? 0) * scale[axis]!);
      const factors = scale.map((value, axis) => value * (node.scale?.[axis] ?? 1));
      if (node.mesh !== undefined) for (const primitive of doc.meshes[node.mesh].primitives) {
        const accessor = doc.accessors[primitive.attributes.POSITION];
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis]!, accessor.min[axis] * factors[axis]! + offset[axis]!);
          max[axis] = Math.max(max[axis]!, accessor.max[axis] * factors[axis]! + offset[axis]!);
        }
      }
      for (const child of node.children ?? []) visit(child, offset, factors);
    }
    visit(roots[0], [0, 0, 0], [1, 1, 1]);
    expect(min[1]).toBeCloseTo(0, 6);
    expect(min[0]! + max[0]!).toBeCloseTo(0, 6);
    expect(min[2]! + max[2]!).toBeCloseTo(0, 6);
    expect(max[2]! - min[2]!).toBeCloseTo(root.extras.lengthMeters, 6);
    // Source front wheels are on +Z, back wheels on -Z for every bundled model.
    const front = doc.nodes.filter((node: { name?: string }) => node.name?.startsWith('wheel-front'));
    const back = doc.nodes.filter((node: { name?: string }) => node.name?.startsWith('wheel-back'));
    expect(front.every((node: { translation: number[] }) => node.translation[2]! > 0)).toBe(true);
    expect(back.every((node: { translation: number[] }) => node.translation[2]! < 0)).toBe(true);
    expect(vehicle.headingOffset).toBe(180);
  }
});
