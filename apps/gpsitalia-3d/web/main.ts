import { createMap, type Camera, type MapSession } from '@3d-map/core';
import { createMapboxProvider, createMapboxFleetLayer, createMapboxVehicle, setMapboxBasemap, type MapboxBasemap, type MapboxVehicle } from '@3d-map/mapbox';
import { createVehicleMotion, getVehicle, getVehicleUrl } from '@3d-map/vehicles-3d';
import { createFleetState, mergeFleet, normalizeLiveRows, type LiveVehicle } from '../src/live';
import { sessionWorked, shouldAutoRelogin } from '../src/relogin';
import { dayRange, findStops, normalizeHistory, poseAt, trailUntil, type TrackPoint } from '../src/timelapse';
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

const storage = (() => { try { return window.sessionStorage; } catch { return undefined; } })();

/** Session refused: one automatic trip through the shared login, then stop (no reload loop). */
function sessionEnded() {
  if (shouldAutoRelogin(storage)) { location.reload(); return; }
  lifetime.abort();
  summary.textContent = 'Sessione scaduta.';
  const link = document.createElement('a'); link.href = '/logout'; link.textContent = 'Accedi di nuovo';
  list.replaceChildren(link);
}

/** All pages of the live positions (bounded). */
async function fetchPositions(signal: AbortSignal): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await getJson(`/api/platform/last-locations?page=${page}&limit=${PAGE_SIZE}`, signal) as { data?: unknown[] } | unknown[];
    const data = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
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
    if (error instanceof SessionExpired) { sessionEnded(); return; }
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

  // Data first: if the platform refuses the session no map load is spent.
  let firstRows: unknown[] | undefined;
  try { firstRows = await fetchPositions(lifetime.signal); }
  catch (error) {
    if (error instanceof SessionExpired) { sessionEnded(); return; }
    // Platform temporarily unavailable: show the map anyway, polling retries.
  }

  let map: MapSession;
  try {
    map = await createMap(createMapboxProvider({ accessToken: config.mapboxToken }), { container: el('map'), camera: ITALY, signal: lifetime.signal });
  } catch {
    if (!lifetime.signal.aborted) summary.textContent = 'Impossibile caricare la mappa.';
    return;
  }
  map.on('error', () => showError('Errore della mappa. Ricarica la pagina se il problema continua.'));

  let vehicles: LiveVehicle[] = [];
  const fleetState = createFleetState();
  let selected: string | null = null;
  let following = true;
  let framed = false;
  let car: MapboxVehicle | undefined;
  const motion = createVehicleMotion();
  const model = getVehicle('kenney-sedan')!;
  const modelUrl = getVehicleUrl(model.id, new URL('/models/', location.origin));

  const fleet = createMapboxFleetLayer(map, { onSelect: id => select(id) });

  // Timelapse of the selected vehicle's day. While it is open, live updates do not move the model.
  interface Replay { points: TrackPoint[]; from: number; to: number; t: number; playing: boolean }
  let replay: Replay | null = null;
  let replayController: AbortController | undefined;
  const replayTime = el<HTMLInputElement>('replay-time'), replayPlay = el<HTMLButtonElement>('replay-play');
  const replaySpeed = el<HTMLSelectElement>('replay-speed'), replayState = el('replay-state'), replayClock = el('replay-clock');
  const replayDay = el<HTMLInputElement>('replay-day');
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  replayDay.max = localDate();
  const drawReplay = () => {
    if (!replay || !car) return;
    const pose = poseAt(replay.points, replay.t);
    if (!pose) return;
    car.update(pose, pose.heading, trailUntil(replay.points, replay.t));
    if (following) map.setCamera({ ...map.getCamera(), center: pose });
    replayClock.textContent = `${new Date(replay.t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}, ${Math.round(pose.speedKmh)} km/h`;
    replayTime.value = String(Math.round((replay.t - replay.from) / Math.max(1, replay.to - replay.from) * 1000));
  };
  const setPlaying = (playing: boolean) => {
    if (!replay) return;
    replay.playing = playing;
    replayPlay.textContent = playing ? 'Pausa' : 'Riproduci';
  };
  const loadReplay = async () => {
    replayController?.abort();
    const imei = selected, range = dayRange(replayDay.value);
    if (!imei || !range) return;
    const controller = replayController = new AbortController();
    replay = null; replayPlay.disabled = true; replayTime.disabled = true; replayClock.textContent = '';
    replayState.textContent = 'Caricamento del percorso…';
    try {
      const body = await getJson(`/api/platform/vehicles/${imei}/history?start=${encodeURIComponent(new Date(range.from).toISOString())}&end=${encodeURIComponent(new Date(range.to).toISOString())}`, AbortSignal.any([controller.signal, lifetime.signal]));
      if (controller.signal.aborted || selected !== imei) return;
      const points = normalizeHistory(body);
      if (points.length < 2) { replayState.textContent = 'Nessun percorso registrato in questo giorno.'; return; }
      const stops = findStops(points);
      replay = { points, from: points[0]!.t, to: points.at(-1)!.t, t: points[0]!.t, playing: false };
      replayState.textContent = `${points.length} punti\n${stops.length} ${stops.length === 1 ? 'sosta' : 'soste'} di almeno 5 minuti\nDalle ${new Date(replay.from).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} alle ${new Date(replay.to).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
      replayPlay.disabled = false; replayTime.disabled = false;
      motion.reset(); following = true; el('follow').setAttribute('aria-pressed', 'true');
      setPlaying(false); drawReplay();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) { sessionEnded(); return; }
      replayState.textContent = 'Percorso non disponibile. Riprova.';
    }
  };
  const closeReplay = () => {
    replayController?.abort();
    replay = null;
    el('replay').hidden = true;
    el('selected').hidden = !selected;
    const imei = selected;
    if (imei) { selected = null; select(imei); }
  };
  el('replay-open').addEventListener('click', () => {
    if (!selected) return;
    el('replay').hidden = false; el('selected').hidden = true;
    if (!replayDay.value) replayDay.value = localDate();
    void loadReplay();
  }, { signal: lifetime.signal });
  replayDay.addEventListener('change', () => void loadReplay(), { signal: lifetime.signal });
  replayPlay.addEventListener('click', () => {
    if (!replay) return;
    if (!replay.playing && replay.t >= replay.to) replay.t = replay.from;
    setPlaying(!replay.playing);
  }, { signal: lifetime.signal });
  replayTime.addEventListener('input', () => {
    if (!replay) return;
    replay.t = replay.from + (replay.to - replay.from) * Number(replayTime.value) / 1000;
    drawReplay();
  }, { signal: lifetime.signal });
  el('replay-close').addEventListener('click', closeReplay, { signal: lifetime.signal });

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
    el('selected').hidden = !v || !el('replay').hidden;
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
    if (replay || !el('replay').hidden) { replayController?.abort(); replay = null; el('replay').hidden = true; }
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
    if (!replay && current && car && previous && current.recordedAt !== previous.recordedAt) {
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
      const rows = firstRows ?? await fetchPositions(signal);
      firstRows = undefined;
      if (signal.aborted) return;
      applyUpdate(mergeFleet(fleetState, normalizeLiveRows(rows)));
      sessionWorked(storage);
      updated.textContent = `Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      showError(null);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof SessionExpired) { sessionEnded(); return; }
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
    if (replay?.playing && !document.hidden) {
      replay.t = Math.min(replay.to, replay.t + delta * Number(replaySpeed.value));
      drawReplay();
      if (replay.t >= replay.to) setPlaying(false);
    } else if (!replay && car && motion.active && !document.hidden) {
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
