import { paintVehicleGlb, resolveVehicleColor, vehicleColors, type VehicleAsset } from '@3d-map/vehicles-3d';
import { syncSelect } from './ui-selects';

const saved = new Map<string, string>();
const storageKey = (owner: string, model: VehicleAsset) => `3d-map.paint.v1.${owner}.${model.id}`;
export function vehicleColor(owner: string, model: VehicleAsset) {
  const key = storageKey(owner, model);
  let color = saved.get(key);
  if (!color) { try { color = localStorage.getItem(key) ?? undefined; } catch { /* Session-only storage. */ } }
  return resolveVehicleColor(model, color);
}
export function saveVehicleColor(owner: string, model: VehicleAsset, color: string) {
  const key = storageKey(owner, model); const value = resolveVehicleColor(model, color);
  saved.set(key, value);
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export function colorOptions(select: HTMLSelectElement, owner: string, model: VehicleAsset) {
  select.replaceChildren(...(model.paint ? vehicleColors.map(c => new Option(c.name, c.id)) : [new Option('Non disponibile · colore originale', 'original')]));
  select.disabled = !model.paint;
  select.value = vehicleColor(owner, model);
  syncSelect(select);
}
// A single source buffer is reused for body-color changes; generated URLs are released by the caller.
let source: { url: string; data: Promise<ArrayBuffer> } | undefined;
export async function prepareVehicleModel(model: VehicleAsset, color: string, badges: 'original' | 'black' = 'original'): Promise<{ url: string; release(): void }> {
  const url = new URL(`/${model.file}`, location.origin).href;
  if (!model.paint || (color === 'original' && badges === 'original')) return { url, release() {} };
  if (source?.url !== url) {
    const data = fetch(url).then(response => { if (!response.ok) throw Error('Modello 3D non disponibile'); return response.arrayBuffer(); });
    source = { url, data };
    void data.catch(() => { if (source?.data === data) source = undefined; });
  }
  const painted = URL.createObjectURL(paintVehicleGlb(await source.data, model, color, badges));
  return { url: painted, release: () => URL.revokeObjectURL(painted) };
}

export function vehicleBadges(owner: string, model: VehicleAsset): 'original' | 'black' {
  if (model.id !== 'audi-a1-quattro') return 'original';
  const key = storageKey(owner, model) + '.badges';
  let value = saved.get(key);
  if (!value) { try { value = localStorage.getItem(key) ?? undefined; } catch {} }
  return value === 'black' ? 'black' : 'original';
}
export function saveVehicleBadges(owner: string, model: VehicleAsset, value: string) {
  const key = storageKey(owner, model) + '.badges';
  const validated = model.id === 'audi-a1-quattro' && value === 'black' ? 'black' : 'original';
  saved.set(key, validated);
  try { localStorage.setItem(key, validated); return true; } catch { return false; }
}
export function badgeOptions(select: HTMLSelectElement, owner: string, model: VehicleAsset) {
  const supported = model.id === 'audi-a1-quattro';
  select.replaceChildren(...(supported ? [new Option('Originali', 'original'), new Option('Neri', 'black')] : [new Option('Disponibile solo per Audi A1', 'original')]));
  select.disabled = !supported;
  select.value = vehicleBadges(owner, model);
  syncSelect(select);
}
