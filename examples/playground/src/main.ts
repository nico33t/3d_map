import { syncSelect } from './ui-selects';
import { mountCameras } from './cameras';
import { mountSystem } from './system';
import { mountShadcnControls, setControlPressed, setControlDisabled } from './ui-controls';
import { createMap, type Coordinates, type Camera } from '@3d-map/core';
import { createMapboxProvider, createMapboxVehicle, createLightningEffect, setMapboxEnvironment, setMapboxBasemap, type MapboxBasemap, type MapboxVehicle } from '@3d-map/mapbox';
import { audiA1, createVehicleRoute, createVehicleMotion, type RoutePoint } from '@3d-map/vehicles-3d';
import { createAitrackClient, watchAitrackLive, AitrackError, type Location, type Device } from '@3d-map/aitrack';
import { fleetModel, saveFleetModel, modelOptions, renderFleet } from './fleet';
import { getVehicle } from '@3d-map/vehicles-3d';
import { refreshDeviceSelector } from './device-selector';
import 'mapbox-gl/dist/mapbox-gl.css';
import './style.css';

const hourAtStartup = new Date().getHours();
let savedTheme = 'auto';
try { savedTheme = localStorage.getItem('3d-map.theme') ?? 'auto'; } catch { /* Optional preference storage. */ }
const startupLight = savedTheme === 'day' || savedTheme === 'night' ? savedTheme : hourAtStartup >= 7 && hourAtStartup < 19 ? 'day' : 'night';
document.documentElement.dataset.theme = startupLight;
document.documentElement.classList.toggle('dark', startupLight === 'night');
const unmountControls = mountShadcnControls();
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const container = element('map');
const status = element('status');
const statusVisibility = new MutationObserver(() => {
  status.hidden = !/errore|error|impossibile|non disponibile|non accessibile|non riuscito|non raggiungibile|inserisci|fuori dall/i.test(status.textContent ?? '');
});
statusVisibility.observe(status, { childList: true, characterData: true, subtree: true });
const reset = element<HTMLButtonElement>('reset');
const pause = element<HTMLButtonElement>('pause');
const follow = element<HTMLButtonElement>('follow');
const source = element<HTMLSelectElement>('data-source');
const speed = element('speed');
const distance = element('distance');
const progress = element<HTMLProgressElement>('progress');
const timeLabel = element('data-time');
const lifetime = new AbortController();
mountSystem(lifetime.signal);
const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
let imei = ((import.meta.env.VITE_AITRACK_DEVICE_IMEI as string | undefined) ?? '').trim();
if (!imei) { source.value = 'demo'; syncSelect(source); }
const client = createAitrackClient({ baseUrl: '/api/aitrack' });
const coordinates = ([longitude, latitude]: RoutePoint): Coordinates => ({ longitude, latitude });
const route = createVehicleRoute([
  [12.49070, 41.89110], [12.49018, 41.89149], [12.48957, 41.89194],
  [12.48898, 41.89238], [12.48836, 41.89286], [12.48774, 41.89333],
  [12.48712, 41.89381], [12.48657, 41.89420], [12.48598, 41.89451],
]);
const camera: Camera = { center: coordinates(route.sample(0).position), zoom: 19, pitch: 62, bearing: -35 };

async function start() {
  if (!token || token === 'pk.your_public_mapbox_token') {
    status.textContent = 'Inserisci VITE_MAPBOX_ACCESS_TOKEN nel file .env nella cartella principale.';
    return;
  }
  try {
    const map = await createMap(createMapboxProvider({ accessToken: token }), {
      container, camera, signal: lifetime.signal,
    });
    map.on('error', (error) => { status.textContent = `Errore della mappa: ${error.message}`; });
    let car: MapboxVehicle | undefined;
    let changingBasemap = false;
    let devices: Device[] = [];
    let demoModel = audiA1;
    let renderId = 0;
    let currentHeading = 0;
    let currentTrail: readonly Coordinates[] = [];
    const modelSelect = element<HTMLSelectElement>('vehicle-model');
    const fleetDialog = element<HTMLDialogElement>('fleet-dialog');
    const activeModel = () => mode === 'demo' ? demoModel : fleetModel(imei);
    const updateIdentity = () => {
      const model = activeModel();
      const device = devices.find(device => String(device.imei) === imei);
      element('vehicle-title').textContent = mode === 'demo' ? model.name : device?.name || 'Veicolo Aitrack';
      modelOptions(modelSelect, model.id);
      const credit = element('asset-credit');
      const author = document.createElement('a'); author.href = model.sourceUrl; author.target = '_blank'; author.rel = 'noreferrer'; author.textContent = model.id === audiA1.id ? 'Car2022' : model.author;
      const license = document.createElement('a'); license.href = model.licenseUrl; license.target = '_blank'; license.rel = 'noreferrer'; license.textContent = model.license;
      credit.replaceChildren('Modello: ', author, ' · ', license, model.attribution ? ' · modello modificato' : ' · generico');
    };
    let mode: 'live' | 'demo' = 'live';
    let playing = true;
    let following = true;
    let traveled = 0;
    let previous = performance.now();
    let lastDraw = 0;
    let frame = 0;
    let currentPosition: Coordinates | undefined;
    let lastLocation: Location | undefined;
    let liveTrail: Coordinates[] = [];
    const liveMotion = createVehicleMotion();
    let liveController: AbortController | undefined;
    let stopPolling: (() => void) | undefined;
    const cameras = mountCameras(map, lifetime.signal, () => { following = false; follow.setAttribute('aria-pressed', 'false'); follow.textContent = 'Segui veicolo'; });
    const render = (position: Coordinates, heading: number, trail: readonly Coordinates[]) => {
      cameras.updatePosition(position);
      currentPosition = position; currentHeading = heading; currentTrail = [...trail];
      const model = activeModel();
      if (!car) car = createMapboxVehicle(map, {
        id: `fleet-${++renderId}`, modelUrl: new URL(`/${model.file}`, window.location.origin).href,
        position, scale: model.mapScale, headingOffset: model.headingOffset,
      });
      car.update(position, heading, trail);
      if (following) map.setCamera({ ...map.getCamera(), center: position });
    };
    const drawDemo = () => {
      const sample = route.sample(traveled);
      render(coordinates(sample.position), sample.heading, sample.trail.map(coordinates));
      distance.textContent = Math.round(sample.traveled).toString();
      progress.value = sample.traveled / route.totalMeters * 100;
      speed.textContent = playing && !sample.finished ? '30' : '0';
      if (sample.finished) {
        playing = false; pause.textContent = 'Terminato'; pause.disabled = true;
        status.textContent = 'Percorso completato. Premi Ricomincia per ripartire.';
      }
    };
    const updateTime = () => {
      if (mode !== 'live' || !lastLocation) return;
      const stale = Date.now() - Date.parse(lastLocation.recorded_at) > 120_000;
      timeLabel.textContent = `${stale ? 'Posizione non recente · ' : 'Ultimo dato · '}${new Date(lastLocation.recorded_at).toLocaleString('it-IT')}`;
    };
    const onLocation = (location: Location) => {
      if (mode !== 'live' || !playing) return;
      if (Math.abs(location.latitude) > 85.051129) {
        status.textContent = 'Posizione fuori dall’area supportata dalla mappa.'; return;
      }
      const timestamp = Date.parse(location.recorded_at);
      if (!Number.isFinite(timestamp) || (lastLocation && timestamp <= Date.parse(lastLocation.recorded_at))) return;
      const position = { longitude: location.longitude, latitude: location.latitude };
      const last = currentPosition;
      let heading = location.heading ?? currentHeading;
      if (last && (last.longitude !== position.longitude || last.latitude !== position.latitude)) {
        const longitudeDelta = Math.abs(last.longitude - position.longitude);
        if (longitudeDelta < 180) heading = location.heading ?? createVehicleRoute([[last.longitude, last.latitude], [position.longitude, position.latitude]]).sample(0).heading;
      }
      // Commit only the already displayed trail. The incoming endpoint is revealed by animation.
      if (last) liveTrail = [...currentTrail].slice(-1999);
      else {
        const tail = liveTrail.at(-1);
        if (!tail || tail.longitude !== position.longitude || tail.latitude !== position.latitude) liveTrail.push(position);
        liveTrail = liveTrail.slice(-2000);
      }
      const duration = lastLocation ? Math.max(1000, Math.min(10_000, timestamp - Date.parse(lastLocation.recorded_at))) : 0;
      const pose = liveMotion.target({ ...position, heading }, duration);
      lastLocation = location;
      render(pose, pose.heading, liveTrail);
      speed.textContent = Number.isFinite(location.speed_kmh) ? Math.round(location.speed_kmh).toString() : '—';
      distance.textContent = liveTrail.length.toString();
      status.textContent = `Aitrack collegato · dispositivo ${imei} · sincronizzazione automatica`;
      updateTime();
    };
    const beginLivePolling = () => {
      stopPolling?.();
      stopPolling = watchAitrackLive(imei, {
        onLocation,
        onError(error) {
          if (error instanceof AitrackError && error.code === 'DEVICE_NOT_FOUND') {
            playing = false; pause.textContent = 'Riprova';
            status.textContent = `Aitrack: il dispositivo ${imei} non è accessibile con questa chiave. Controlla l’elenco dei dispositivi.`;
            timeLabel.textContent = 'Nessuna posizione disponibile per questo dispositivo.';
          } else {
            status.textContent = error instanceof Error ? error.message : 'Aitrack non raggiungibile.';
          }
        },
      }, { signal: liveController!.signal });
    };
    const switchMode = async () => {
      liveController?.abort(); stopPolling?.(); cameras.reset();
      car?.destroy(); car = undefined; currentPosition = undefined;
      currentTrail = []; currentHeading = 0; liveMotion.reset();
      mode = source.value === 'demo' ? 'demo' : 'live';
      updateIdentity();
      playing = true; traveled = 0; liveTrail = []; lastLocation = undefined;
      previous = performance.now(); pause.disabled = false;
      speed.textContent = '—'; distance.textContent = '0';
      progress.hidden = mode === 'live';
      element('device-controls').hidden = mode !== 'live';
      element('mode-label').textContent = mode === 'live' ? 'Aitrack · Live' : 'DRIVE SIMULATION';
      element('vehicle-description').textContent = mode === 'live' ? `Dispositivo ${imei} · GPS reale, movimento interpolato.` : 'Un giro tra i Fori Imperiali. La scia racconta il percorso.';
      element('distance-label').textContent = mode === 'live' ? 'punti nella scia' : 'metri percorsi';
      reset.textContent = mode === 'live' ? 'Pulisci scia' : 'Ricomincia';
      pause.textContent = mode === 'live' ? 'Sospendi' : 'Pausa';
      if (mode === 'demo') {
        timeLabel.textContent = 'Percorso dimostrativo · nessun GPS reale';
        status.textContent = 'Veicolo in movimento · simulazione'; drawDemo(); return;
      }
      status.textContent = 'Connessione ad Aitrack…';
      timeLabel.textContent = 'In attesa della prima posizione…';
      liveController = new AbortController();
      const active = liveController;
      // History is optional; start live updates even if the history scope is missing.
      try {
        const to = new Date();
        const { data } = await client.getHistory(imei, { from: new Date(to.getTime() - 3_600_000).toISOString(), to: to.toISOString(), limit: 1000 }, active.signal);
        if (active.signal.aborted) return;
        const sorted = data.filter(p => Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 85.051129 && Number.isFinite(Date.parse(p.recorded_at))).sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
        liveTrail = sorted.map(p => ({ longitude: p.longitude, latitude: p.latitude }));
      } catch { /* A denied or empty history must not block the latest location. */ }
      if (!active.signal.aborted) beginLivePolling();
    };
    const animate = (now: number) => {
      if (lifetime.signal.aborted) return;
      const delta = document.hidden ? 0 : Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (mode === 'demo' && playing) {
        traveled = Math.min(route.totalMeters, traveled + delta * 8.33);
        if (now - lastDraw >= 33) { drawDemo(); lastDraw = now; }
      }
      if (mode === 'live' && playing && liveMotion.active && !document.hidden) {
        const pose = liveMotion.advance(delta * 1000);
        if (pose) {
          const trail = [...liveTrail, { longitude: pose.longitude, latitude: pose.latitude }];
          render(pose, pose.heading, trail);
          if (!liveMotion.active) liveTrail = trail.slice(-2000);
          distance.textContent = trail.length.toString();
        }
      }
      frame = requestAnimationFrame(animate);
    };
    reset.disabled = pause.disabled = follow.disabled = false;
    const deviceSelect = element<HTMLSelectElement>('device-select');
    let deviceListController: AbortController | undefined;
    const showFleet = () => renderFleet(devices, mode === 'live' ? imei : '', selected => {
      imei = selected; deviceSelect.value = selected; source.value = 'live'; syncSelect(deviceSelect); syncSelect(source);
      fleetDialog.close(); void switchMode();
    }, (selected, model) => {
      saveFleetModel(selected, model);
      if (mode === 'live' && selected === imei) replaceModel();
    });
    const replaceModel = () => {
      car?.destroy(); car = undefined; updateIdentity();
      if (currentPosition) render(currentPosition, currentHeading, currentTrail);
    };
    modelSelect.addEventListener('change', () => {
      if (mode === 'demo') demoModel = getVehicle(modelSelect.value)!;
      else saveFleetModel(imei, modelSelect.value);
      replaceModel();
    }, { signal: lifetime.signal });
    element('open-fleet').addEventListener('click', () => { showFleet(); fleetDialog.showModal(); }, { signal: lifetime.signal });
    element('close-fleet').addEventListener('click', () => fleetDialog.close(), { signal: lifetime.signal });
    const refreshDevices = () => {
      deviceListController?.abort();
      deviceListController = new AbortController();
      const active = deviceListController;
      void refreshDeviceSelector(client, deviceSelect, element('device-state'), imei, active.signal).then(result => {
        if (active.signal.aborted) return;
        devices = result ?? [];
        if (!imei && deviceSelect.value) imei = deviceSelect.value;
        updateIdentity(); showFleet();
        if (!result) element('fleet-state').textContent = element('device-state').textContent;
      });
    };
    deviceSelect.addEventListener('change', () => {
      imei = deviceSelect.value;
      element('device-state').textContent = 'Dispositivo selezionato dall’elenco Aitrack.';
      void switchMode();
    }, { signal: lifetime.signal });
    element('refresh-devices').addEventListener('click', () => { refreshDevices(); void switchMode(); }, { signal: lifetime.signal });
    refreshDevices();
    source.addEventListener('change', () => { void switchMode(); }, { signal: lifetime.signal });
    pause.addEventListener('click', () => {
      playing = !playing;
      pause.textContent = playing ? (mode === 'live' ? 'Sospendi' : 'Pausa') : 'Riprendi';
      if (mode === 'live') {
        if (playing) beginLivePolling(); else stopPolling?.();
        status.textContent = playing ? 'Ripresa aggiornamenti Aitrack…' : 'Aggiornamenti Aitrack sospesi';
      } else { status.textContent = playing ? 'Veicolo in movimento · simulazione' : 'Simulazione in pausa'; drawDemo(); }
    }, { signal: lifetime.signal });
    reset.addEventListener('click', () => {
      if (mode === 'live') {
        liveTrail = currentPosition ? [{ ...currentPosition }] : [];
        if (currentPosition) render(currentPosition, currentHeading, liveTrail);
        distance.textContent = liveTrail.length.toString();
      } else {
        traveled = 0; playing = true; previous = performance.now(); pause.disabled = false; pause.textContent = 'Pausa';
        status.textContent = 'Veicolo in movimento · simulazione'; drawDemo();
      }
    }, { signal: lifetime.signal });
    follow.addEventListener('click', () => {
      following = !following;
      follow.setAttribute('aria-pressed', String(following));
      follow.textContent = following ? 'Segui veicolo' : 'Camera libera';
      if (following && currentPosition) map.setCamera({ ...camera, center: currentPosition });
    }, { signal: lifetime.signal });
    let rainy = false;
    let stormy = false;
    const lightning = createLightningEffect(container);
    const storm = element<HTMLButtonElement>('storm'); setControlDisabled('storm', false);
    const syncWeather = () => {
      setMapboxEnvironment(map, { rain: rainy || stormy });
      lightning.setEnabled(stormy);
      setControlPressed('rain', rainy || stormy);
      setControlPressed('storm', stormy);
    };
    storm.addEventListener('click', () => { stormy = !stormy; syncWeather(); }, { signal: lifetime.signal });
    let light: 'day' | 'night' = startupLight;
    let automaticLight = savedTheme !== 'day' && savedTheme !== 'night';
    const applyTheme = () => {
      if (automaticLight) { const hour = new Date().getHours(); light = hour >= 7 && hour < 19 ? 'day' : 'night'; }
      try { localStorage.setItem('3d-map.theme', automaticLight ? 'auto' : light); } catch { /* Keep the selected theme for this session. */ }
      document.documentElement.dataset.theme = light;
      document.documentElement.classList.toggle('dark', light === 'night');
      if (!changingBasemap) setMapboxEnvironment(map, { light });
      setControlPressed('day', !automaticLight && light === 'day');
      setControlPressed('night', !automaticLight && light === 'night');
      setControlPressed('auto-light', automaticLight);
    };
    const autoLight = element<HTMLButtonElement>('auto-light'); setControlDisabled('auto-light', false);
    autoLight.addEventListener('click', () => { automaticLight = true; applyTheme(); }, { signal: lifetime.signal });
    applyTheme();
    const themeClock = setInterval(applyTheme, 60_000);
    let basemap: MapboxBasemap = 'standard';
    const styleButtons = ['standard-map', 'hybrid-map', 'day', 'night', 'rain', 'storm', 'auto-light'].map(id => element<HTMLButtonElement>(id));
    for (const [id, target] of [['standard-map', 'standard'], ['hybrid-map', 'hybrid']] as const) {
      const button = element<HTMLButtonElement>(id); setControlDisabled(id, false);
      button.addEventListener('click', async () => {
        if (changingBasemap || target === basemap) return;
        changingBasemap = true;
        styleButtons.forEach(control => { setControlDisabled(control.id, true); });
        status.textContent = 'Caricamento della mappa…';
        let ready = false;
        try {
          await setMapboxBasemap(map, target, lifetime.signal);
          basemap = target; ready = true;
          status.textContent = target === 'hybrid' ? 'Ibrida 3D · satellite, strade ed edifici' : 'Mappa standard 3D';
        } catch (error) {
          if (lifetime.signal.aborted) return;
          status.textContent = 'Cambio mappa non riuscito. Ripristino della vista precedente…';
          try { await setMapboxBasemap(map, basemap, lifetime.signal); ready = true; }
          catch { status.textContent = 'Mappa non disponibile. Ricarica la pagina per riprovare.'; }
        } finally {
          if (ready && !lifetime.signal.aborted) {
            changingBasemap = false;
            setMapboxEnvironment(map, { light, rain: rainy || stormy });
            styleButtons.forEach(control => { setControlDisabled(control.id, false); });
            setControlPressed('standard-map', basemap === 'standard');
            setControlPressed('hybrid-map', basemap === 'hybrid');
          }
        }
      }, { signal: lifetime.signal });
    }
    for (const preset of ['day', 'night'] as const) {
      const button = element<HTMLButtonElement>(preset); setControlDisabled(preset, false);
      button.addEventListener('click', () => {
        automaticLight = false; light = preset; applyTheme();
      }, { signal: lifetime.signal });
    }
    const rain = element<HTMLButtonElement>('rain'); setControlDisabled('rain', false);
    rain.addEventListener('click', () => {
      if (rainy || stormy) { rainy = false; stormy = false; } else rainy = true;
      syncWeather();
    }, { signal: lifetime.signal });
    const panel = element('drive-panel');
    const togglePanel = element<HTMLButtonElement>('toggle-panel');
    const setPanel = (open: boolean) => {
      panel.hidden = !open;
      document.body.classList.toggle('panel-open', open);
      togglePanel.setAttribute('aria-expanded', String(open));
      togglePanel.textContent = open ? 'Chiudi pannello' : 'Controlli';
      if (!open) togglePanel.focus();
      map.resize();
    };
    togglePanel.addEventListener('click', () => setPanel(panel.hidden), { signal: lifetime.signal });
    element('close-panel').addEventListener('click', () => setPanel(false), { signal: lifetime.signal });
    const observer = new ResizeObserver(() => map.resize()); observer.observe(container);
    const clock = setInterval(updateTime, 15_000);
    lifetime.signal.addEventListener('abort', () => {
      lightning.destroy(); clearInterval(themeClock);
      liveController?.abort(); deviceListController?.abort(); stopPolling?.(); cancelAnimationFrame(frame); observer.disconnect(); clearInterval(clock);
    }, { once: true });
    frame = requestAnimationFrame(animate);
    await switchMode();
  } catch (error) {
    if (!lifetime.signal.aborted) status.textContent = error instanceof Error ? error.message : 'Impossibile caricare la mappa.';
  }
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) lifetime.abort(); });
if (import.meta.hot) import.meta.hot.dispose(() => { lifetime.abort(); statusVisibility.disconnect(); unmountControls(); });
void start();

if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('/sw.js').catch(() => {});
