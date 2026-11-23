import { createMap, type Camera, type MapSession } from '@3d-map/core';
import { createMapboxProvider, createMapboxFleetLayer, createMapboxVehicle, setMapboxBasemap, type MapboxBasemap, type MapboxVehicle } from '@3d-map/mapbox';
import { createVehicleMotion, getVehicle, getVehicleUrl } from '@3d-map/vehicles-3d';
import { normalizeLiveRows, type LiveVehicle } from '../src/live';
import { createInactivityWatch, DEFAULT_COUNTDOWN_MS } from '../src/inactivity';
import 'mapbox-gl/dist/mapbox-gl.css';
import './style.css';

const POLL_MS = 30_000; // the platform caches last-locations for 30 s
const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const LIST_LIMIT = 300;
const ITALY: Camera = { center: { longitude: 12.5, latitude: 42.2 }, zoom: 5.2, pitch: 0, bearing: 0 };

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const summary = el('summary'), list = el<HTMLUListElement>('list'), search = el<HTMLInputElement>('search');
const errorBox = el('error'), updated = el('updated');
const lifetime = new AbortController();

class SessionExpired extends Error {}

/** 401 from our own functions means the session ended: the middleware will send the user to auth. */
async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', signal });
  if (response.status === 401) throw new SessionExpired();
  if (!response.ok) throw new Error(`Errore ${response.status}`);
  return response.json();
}

function showError(message: string | null) {
  errorBox.hidden = !message;
  errorBox.textContent = message ?? '';
}

const formatTime = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const stateText: Record<LiveVehicle['state'], string> = { moving: 'In movimento', stopped: 'Fermo', stale: 'Dato non recente' };

async function start() {
  let config: { mapboxToken: string; appUrl: string };
  try {
    const body = await getJson('/api/config', lifetime.signal) as { data?: { mapboxToken?: string; appUrl?: string } };
    if (!body.data?.mapboxToken) throw new Error('Mappa non configurata.');
    config = { mapboxToken: body.data.mapboxToken, appUrl: body.data.appUrl ?? 'https://app.gpsitalia.com' };
  } catch (error) {
    if (error instanceof SessionExpired) { location.reload(); return; }
    summary.textContent = 'Mappa non disponibile. Riprova più tardi.';
    return;
  }

  // Inactivity: 10 minutes, then «Sei ancora qui?» with 60 seconds, then back to the app.
  const dialog = el<HTMLDialogElement>('idle-dialog');
  const idleText = el('idle-text');
  const leave = () => { lifetime.abort(); location.replace(config.appUrl); };
  const countdownText = (s: number) => `Per non consumare la mappa 3D senza nessuno davanti, tra ${s} secondi torni all’app GPS Italia.`;
  const idle = createInactivityWatch({
    onWarn: s => { idleText.textContent = countdownText(s); if (!dialog.open) dialog.showModal(); },
    onTick: s => { idleText.textContent = countdownText(s); },
    onResume: () => { if (dialog.open) dialog.close(); },
    onExpire: leave,
  });
  idleText.textContent = countdownText(DEFAULT_COUNTDOWN_MS / 1000);
  el('idle-stay').addEventListener('click', () => idle.confirm(), { signal: lifetime.signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); idle.confirm(); }, { signal: lifetime.signal });
  let lastMove = 0;
  const activity = () => idle.activity();
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(type, activity, { passive: true, signal: lifetime.signal });
  window.addEventListener('pointermove', () => { const now = Date.now(); if (now - lastMove > 5_000) { lastMove = now; activity(); } }, { passive: true, signal: lifetime.signal });

  let map: MapSession;
  try {
    map = await createMap(createMapboxProvider({ accessToken: config.mapboxToken }), { container: el('map'), camera: ITALY, signal: lifetime.signal });
  } catch {
    if (!lifetime.signal.aborted) summary.textContent = 'Impossibile caricare la mappa.';
    return;
  }
  map.on('error', () => showError('Errore della mappa. Ricarica la pagina se il problema continua.'));

  let vehicles: LiveVehicle[] = [];
  let selected: string | null = null;
  let following = true;
  let framed = false;
  let car: MapboxVehicle | undefined;
  const motion = createVehicleMotion();
  const model = getVehicle('kenney-sedan')!;
  const modelUrl = getVehicleUrl(model.id, new URL('/models/', location.origin));

  const fleet = createMapboxFleetLayer(map, { onSelect: id => select(id) });

  const renderList = () => {
    const query = search.value.trim().toLowerCase();
    const filtered = (query ? vehicles.filter(v => v.name.toLowerCase().includes(query) || v.plate.toLowerCase().includes(query) || v.imei.includes(query)) : vehicles)
      .slice().sort((a, b) => a.name.localeCompare(b.name, 'it')).slice(0, LIST_LIMIT);
    list.replaceChildren(...filtered.map(v => {
      const item = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button';
      const dot = document.createElement('span'); dot.className = `dot ${v.state}`;
      const name = document.createElement('span'); name.className = 'name'; name.textContent = v.name;
      const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = v.plate ? `${v.plate}, ${stateText[v.state].toLowerCase()}` : stateText[v.state];
      button.append(dot, name, meta);
      button.addEventListener('click', () => select(v.imei));
      item.append(button);
      return item;
    }));
  };

  const renderSummary = () => {
    const moving = vehicles.filter(v => v.state === 'moving').length;
    const stale = vehicles.filter(v => v.state === 'stale').length;
    summary.textContent = `${vehicles.length} mezzi sulla mappa\n${moving} in movimento\n${stale} con dato non recente`;
  };

  const renderSelected = () => {
    const v = vehicles.find(x => x.imei === selected);
    el('selected').hidden = !v;
    if (!v) return;
    el('selected-name').textContent = v.name;
    el('selected-detail').textContent = [v.plate || null, `${stateText[v.state]}, ${Math.round(v.speedKmh)} km/h`, `Ultimo dato: ${formatTime(v.recordedAt)}`].filter(Boolean).join('\n');
  };

  const frameAll = () => {
    const points = vehicles.filter(v => v.state !== 'stale');
    const source = points.length ? points : vehicles;
    if (!source.length) return;
    const south = Math.min(...source.map(v => v.latitude)), north = Math.max(...source.map(v => v.latitude));
    const west = Math.min(...source.map(v => v.longitude)), east = Math.max(...source.map(v => v.longitude));
    const latitude = (south + north) / 2, longitude = (west + east) / 2;
    const spanM = Math.max((north - south) * 111_320, (east - west) * 111_320 * Math.cos(latitude * Math.PI / 180), 500);
    const zoom = Math.max(4, Math.min(15, Math.log2(40_075_016 * Math.cos(latitude * Math.PI / 180) * 600 / 512 / spanM)));
    map.setCamera({ center: { longitude, latitude }, zoom, pitch: 45, bearing: 0 }, { animate: true });
  };

  function clearCar() { car?.destroy(); car = undefined; motion.reset(); }

  function select(imei: string | null) {
    idle.activity();
    if (imei === selected) return;
    clearCar();
    selected = imei;
    fleet.setHidden(imei);
    following = true;
    el('follow').setAttribute('aria-pressed', 'true');
    renderSelected();
    const v = vehicles.find(x => x.imei === imei);
    if (!v) return;
    const pose = motion.target({ longitude: v.longitude, latitude: v.latitude, heading: v.heading }, 0);
    car = createMapboxVehicle(map, { id: `selected-${imei}`, modelUrl, position: pose, scale: model.mapScale, headingOffset: model.headingOffset });
    car.update(pose, pose.heading, []);
    map.setCamera({ center: pose, zoom: 18, pitch: 62, bearing: map.getCamera().bearing }, { animate: true });
  }

  const applyUpdate = (next: LiveVehicle[]) => {
    const previous = vehicles.find(v => v.imei === selected);
    vehicles = next;
    fleet.update(vehicles.map(v => ({ id: v.imei, longitude: v.longitude, latitude: v.latitude, label: v.name, state: v.state, heading: v.heading })));
    renderSummary(); renderList(); renderSelected();
    const current = vehicles.find(v => v.imei === selected);
    if (selected && !current) { select(null); return; }
    if (current && car && previous && current.recordedAt !== previous.recordedAt) {
      // Animate towards the new GPS point; never extrapolate beyond it.
      const duration = Math.max(1_000, Math.min(POLL_MS, Date.parse(current.recordedAt) - Date.parse(previous.recordedAt)));
      motion.target({ longitude: current.longitude, latitude: current.latitude, heading: current.heading }, duration);
    }
    if (!framed && vehicles.length) { framed = true; frameAll(); }
  };

  let pollController: AbortController | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    clearTimeout(pollTimer);
    pollController?.abort();
    if (document.hidden || lifetime.signal.aborted) return;
    const controller = pollController = new AbortController();
    const signal = AbortSignal.any([controller.signal, lifetime.signal]);
    try {
      const rows: unknown[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const body = await getJson(`/api/platform/last-locations?page=${page}&limit=${PAGE_SIZE}`, signal) as { data?: unknown[] } | unknown[];
        const data = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      if (signal.aborted) return;
      applyUpdate(normalizeLiveRows(rows));
      updated.textContent = `Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      showError(null);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof SessionExpired) { location.reload(); return; }
      showError('Posizioni non aggiornate. Nuovo tentativo tra poco.');
    } finally {
      if (!signal.aborted) pollTimer = setTimeout(() => void poll(), POLL_MS);
    }
  };

  let previousFrame = performance.now();
  const animate = (now: number) => {
    if (lifetime.signal.aborted) return;
    const delta = Math.min(now - previousFrame, 100);
    previousFrame = now;
    if (car && motion.active && !document.hidden) {
      const pose = motion.advance(delta);
      if (pose) {
        car.update(pose, pose.heading, []);
        if (following) map.setCamera({ ...map.getCamera(), center: pose });
      }
    }
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);

  search.addEventListener('input', renderList, { signal: lifetime.signal });
  el('deselect').addEventListener('click', () => { select(null); frameAll(); }, { signal: lifetime.signal });
  el('follow').addEventListener('click', () => {
    following = !following;
    el('follow').setAttribute('aria-pressed', String(following));
    const v = vehicles.find(x => x.imei === selected);
    if (following && v) map.setCamera({ ...map.getCamera(), center: { longitude: v.longitude, latitude: v.latitude } }, { animate: true });
  }, { signal: lifetime.signal });

  let basemap: MapboxBasemap = 'standard';
  let switching = false;
  for (const [id, target] of [['standard', 'standard'], ['hybrid', 'hybrid']] as const) {
    el(id).addEventListener('click', async () => {
      if (switching || basemap === target) return;
      switching = true;
      try {
        await setMapboxBasemap(map, target, lifetime.signal);
        basemap = target;
        el('standard').setAttribute('aria-pressed', String(basemap === 'standard'));
        el('hybrid').setAttribute('aria-pressed', String(basemap === 'hybrid'));
      } catch { if (!lifetime.signal.aborted) showError('Cambio mappa non riuscito.'); }
      finally { switching = false; }
    }, { signal: lifetime.signal });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(pollTimer); pollController?.abort(); return; }
    idle.check();
    void poll();
  }, { signal: lifetime.signal });

  lifetime.signal.addEventListener('abort', () => { idle.stop(); clearTimeout(pollTimer); pollController?.abort(); clearCar(); }, { once: true });
  await poll();
}

window.addEventListener('pagehide', event => { if (!event.persisted) lifetime.abort(); });
void start();
