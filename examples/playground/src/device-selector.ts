import type { createAitrackClient, Device } from '@3d-map/aitrack';

/** Keep the requested IMEI selected; changing the tracked device is an explicit UI action. */
export async function refreshDeviceSelector(
  client: ReturnType<typeof createAitrackClient>,
  select: HTMLSelectElement,
  state: HTMLElement,
  requested: string,
  signal: AbortSignal,
): Promise<Device[] | undefined> {
  select.disabled = true;
  state.textContent = 'Verifica dei dispositivi accessibili…';
  try {
    const devices = [];
    for (let offset = 0; ; offset += 200) {
      const response = await client.listDevices({ limit: 200, offset }, signal);
      if (!Array.isArray(response.data)) throw new Error('Elenco dispositivi Aitrack non valido.');
      devices.push(...response.data);
      if (response.data.length < 200) break;
      if (devices.length >= 10_000) throw new Error('Elenco troppo esteso per il playground.');
    }
    if (signal.aborted) return;
    if (!requested && devices[0]) requested = String(devices[0].imei);
    const available = devices.some(device => String(device.imei) === requested);
    select.replaceChildren();
    if (!available) {
      const missing = new Option(`${requested} · non accessibile`, requested, true, true);
      missing.disabled = true;
      select.add(missing);
    }
    for (const device of devices) {
      const imei = String(device.imei);
      select.add(new Option(`${device.name || 'Dispositivo'}${device.plate ? ` · ${device.plate}` : ''}`, imei, false, imei === requested));
    }
    select.value = requested;
    select.disabled = devices.length === 0;
    state.textContent = available
      ? `${devices.length} dispositivi accessibili con questa chiave.`
      : `L’IMEI richiesto non compare tra i ${devices.length} dispositivi accessibili. Seleziona un dispositivo dall’elenco oppure usa la chiave dell’account corretto.`;
    return devices;
  } catch (error) {
    if (!signal.aborted) state.textContent = error instanceof Error ? error.message : 'Impossibile leggere i dispositivi Aitrack.';
  }
}
