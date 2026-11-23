import { badgeOptions, saveVehicleBadges, colorOptions, saveVehicleColor } from './vehicle-paint';
import { mountSelect, syncSelect, disposeSelectsWithin } from './ui-selects';
import { styleFleetButton } from './ui-controls';
import { audiA1, vehicles, getVehicle, createFleetAssignments } from '@3d-map/vehicles-3d';
import type { Device } from '@3d-map/aitrack';

const catalog = [audiA1, ...vehicles];
const storage = createFleetAssignments({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
export function modelOptions(select: HTMLSelectElement, selected: string) {
  select.replaceChildren(...catalog.map(model => new Option(`${model.name}${model.style === 'stylized' ? ' (generico)' : ''}`, model.id)));
  select.value = selected; syncSelect(select);
}
export function fleetModel(imei: string) {
  return getVehicle(storage.get(imei) ?? (imei === import.meta.env.VITE_AITRACK_DEVICE_IMEI ? audiA1.id : 'kenney-sedan'))!;
}
export function saveFleetModel(imei: string, model: string) {
  const saved = storage.set(imei, model);
  document.getElementById('fleet-save-state')!.textContent = saved
    ? 'Associazioni salvate in questo browser. I modelli Kenney sono rappresentazioni generiche.'
    : 'Salvataggio nel browser non disponibile: associazione valida solo per questa sessione.';
}
export function renderFleet(devices: readonly Device[], selected: string, onFollow: (imei: string) => void, onModel: (imei: string, model: string) => void, onColor: (imei: string) => void) {
  const list = document.getElementById('fleet-list')!;
  document.getElementById('fleet-state')!.textContent = `${devices.length} mezzi accessibili con la chiave attuale.`;
  disposeSelectsWithin(list);
  list.replaceChildren();
  const states: Record<string, string> = { moving: 'In movimento', parked: 'Fermo', offline: 'Offline', unknown: 'Stato sconosciuto' };
  for (const device of devices) {
    const imei = String(device.imei);
    const card = document.createElement('article'); card.className = 'fleet-card';
    const title = document.createElement('h3'); title.textContent = device.name || 'Mezzo senza nome';
    const detail = document.createElement('p'); detail.textContent = `${device.plate || 'Targa non disponibile'}\n${states[device.status] ?? 'Stato sconosciuto'}\nIMEI ${imei}`;
    const label = document.createElement('label'); label.textContent = 'Rappresentazione 3D';
    const select = document.createElement('select'); select.setAttribute('aria-label', `Modello 3D ${device.name || imei}`);
    modelOptions(select, fleetModel(imei).id);
    select.addEventListener('change', () => { onModel(imei, select.value); colorOptions(colorSelect, imei, fleetModel(imei)); badgeOptions(badgeSelect, imei, fleetModel(imei)); });
    const colorLabel = document.createElement('label'); colorLabel.textContent = 'Colore carrozzeria';
    const colorSelect = document.createElement('select'); colorSelect.setAttribute('aria-label', `Colore ${device.name || imei}`);
    colorOptions(colorSelect, imei, fleetModel(imei));
    colorSelect.addEventListener('change', () => {
      const persisted = saveVehicleColor(imei, fleetModel(imei), colorSelect.value);
      document.getElementById('fleet-save-state')!.textContent = persisted ? 'Colore salvato in questo browser.' : 'Colore valido solo per questa sessione.';
      onColor(imei);
    });
    colorLabel.append(colorSelect);
    const badgeLabel = document.createElement('label'); badgeLabel.textContent = 'Loghi Audi davanti e dietro';
    const badgeSelect = document.createElement('select'); badgeSelect.setAttribute('aria-label', `Loghi Audi ${device.name || imei}`);
    badgeOptions(badgeSelect, imei, fleetModel(imei));
    badgeSelect.addEventListener('change', () => {
      const persisted = saveVehicleBadges(imei, fleetModel(imei), badgeSelect.value);
      document.getElementById('fleet-save-state')!.textContent = persisted ? 'Scelta loghi salvata in questo browser.' : 'Loghi validi solo per questa sessione.';
      onColor(imei);
    });
    badgeLabel.append(badgeSelect);
    label.append(select);
    const button = document.createElement('button'); styleFleetButton(button); button.textContent = imei === selected ? 'Seguito sulla mappa' : 'Segui sulla mappa';
    button.addEventListener('click', () => onFollow(imei));
    card.append(title, detail, label, colorLabel, badgeLabel, button); list.append(card); mountSelect(select); mountSelect(colorSelect); mountSelect(badgeSelect);
  }
}
