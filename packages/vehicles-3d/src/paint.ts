import { blackAudiBadges } from './badges.js';
import type { VehicleAsset } from './index.js';

export const vehicleColors = Object.freeze([
  { id: 'zinc', name: 'Grigio zinco', hex: '#a1a1aa' },
  { id: 'white', name: 'Bianco', hex: '#eeeeea' },
  { id: 'black', name: 'Nero', hex: '#202124' },
  { id: 'silver', name: 'Argento', hex: '#b9bdc2' },
  { id: 'red', name: 'Rosso', hex: '#b52228' },
  { id: 'blue', name: 'Blu', hex: '#234e89' },
  { id: 'green', name: 'Verde', hex: '#34594c' },
  { id: 'original', name: 'Colore originale', hex: null },
]);
export function resolveVehicleColor(model: VehicleAsset, selected?: string): string {
  if (!model.paint) return 'original';
  return vehicleColors.some(c => c.id === selected) ? selected! : model.paint.defaultColor;
}

/** Rewrites only explicitly approved body materials; geometry and embedded textures stay intact. */
export function paintVehicleGlb(buffer: ArrayBuffer, model: VehicleAsset, selected?: string, badges: 'original' | 'black' = 'original'): Blob {
  if (badges === 'black' && model.id === 'audi-a1-quattro') buffer = blackAudiBadges(buffer);
  const color = vehicleColors.find(c => c.id === resolveVehicleColor(model, selected))!;
  if (!color.hex || !model.paint) return new Blob([buffer], { type: 'model/gltf-binary' });
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw Error('Invalid GLB model');
  const length = view.getUint32(12, true);
  if (20 + length > buffer.byteLength) throw Error('Invalid GLB JSON length');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const rgb = [1, 3, 5].map(i => linear(parseInt(color.hex!.slice(i, i + 2), 16) / 255));
  let changed = 0;
  for (const material of json.materials ?? []) {
    if (!model.paint.materials.includes(material.name)) continue;
    material.pbrMetallicRoughness ??= {};
    material.pbrMetallicRoughness.baseColorFactor = [...rgb, material.pbrMetallicRoughness.baseColorFactor?.[3] ?? 1];
    changed++;
  }
  if (!changed) throw Error('Body material unavailable');
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(encoded.length / 4) * 4); padded.fill(32); padded.set(encoded);
  const header = new ArrayBuffer(20); const out = new DataView(header);
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true);
  out.setUint32(8, 20 + padded.length + buffer.byteLength - 20 - length, true);
  out.setUint32(12, padded.length, true); out.setUint32(16, 0x4e4f534a, true);
  return new Blob([header, padded, new Uint8Array(buffer, 20 + length)], { type: 'model/gltf-binary' });
}
