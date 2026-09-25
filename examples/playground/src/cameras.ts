import { nearbyCameras, type Camera, type Position } from '@3d-map/rtsp';
import type { MapSession } from '@3d-map/core';
import { styleFleetButton } from './ui-controls';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export function mountCameras(map: MapSession, signal: AbortSignal, browse: () => void) {
    const dialog = el<HTMLDialogElement>('camera-dialog'), list = el('camera-list'), state = el('camera-state'), dock = el('camera-dock');
    const toggle = el<HTMLInputElement>('camera-enabled'), search = el<HTMLInputElement>('camera-search'), form = el<HTMLFormElement>('camera-form');
    let enabled = false, cameras: Camera[] = [], position: Position | undefined, lastCheck = 0, near = new Set<string>();
    const pinned = new Set<string>(), dismissed = new Set<string>(), players = new Map<string, () => void>();
    const request = async (path: string, method = 'GET', body?: unknown) => {
        const response = await fetch('/api/cameras' + path, { method, signal, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const data = await response.json();
        if (!response.ok)
            throw Error(data.error ?? 'Telecamere non disponibili');
        return data;
    };
    const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; styleFleetButton(b); b.onclick = action; return b; };
    const failure = (error: unknown) => { if (!signal.aborted)
        state.textContent = error instanceof Error ? error.message : 'Operazione non riuscita'; };
    function open(camera: Camera) {
        if (!enabled || !camera.enabled)
            return;
        if (!pinned.has(camera.id) && pinned.size >= 3) {
            state.textContent = 'Chiudi uno dei tre video aperti prima di aprirne un altro.';
            return;
        }
        pinned.add(camera.id);
        dismissed.delete(camera.id);
        dialog.close();
        browse();
        map.setCamera({ ...map.getCamera(), center: camera, zoom: 17 }, { animate: true });
        sync();
    }
    function drawList() {
        list.replaceChildren();
        for (const camera of cameras.filter(c => c.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))) {
            const row = document.createElement('div');
            row.className = 'camera-row';
            const title = document.createElement('strong');
            title.textContent = camera.name;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = camera.enabled;
            checkbox.setAttribute('aria-label', `Attiva ${camera.name}`);
            checkbox.onchange = () => { void request('/' + camera.id, 'PATCH', { enabled: checkbox.checked }).then(refresh).catch(failure); };
            const view = button('Mostra sulla mappa', () => open(camera));
            view.disabled = !enabled || !camera.enabled;
            row.append(checkbox, title, view, button('Rimuovi', () => { void request('/' + camera.id, 'DELETE', {}).then(refresh).catch(failure); }));
            list.append(row);
        }
        if (!cameras.length)
            list.textContent = 'Nessuna telecamera collegata. Aggiungi una delle tue telecamere RTSP.';
        map.setMarkers(enabled ? cameras.filter(c => c.enabled).map(c => ({ id: 'camera:' + c.id, position: c, label: '📹 ' + c.name })) : []);
    }
    function addPlayer(camera: Camera) {
        const tile = document.createElement('section');
        tile.className = 'camera-tile';
        tile.setAttribute('aria-label', camera.name);
        const header = document.createElement('header'), title = document.createElement('strong'), note = document.createElement('p'), video = document.createElement('video');
        title.textContent = camera.name;
        note.textContent = 'Connessione…';
        note.setAttribute('role', 'status');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.controls = true;
        const close = button('×', () => { pinned.delete(camera.id); dismissed.add(camera.id); sync(); });
        close.setAttribute('aria-label', `Chiudi ${camera.name}`);
        header.append(title, close);
        tile.append(header, video, note);
        dock.append(tile);
        let disposed = false, hls: import('hls.js').default | undefined, retry: ReturnType<typeof setTimeout> | undefined, lastTime = -1, stalled = 0;
        const clearMedia = () => { hls?.destroy(); hls = undefined; video.pause(); video.removeAttribute('src'); video.load(); };
        const connect = async () => {
            try {
                clearMedia();
                note.textContent = 'Connessione…';
                const stream = await request('/' + camera.id + '/start', 'POST', {});
                if (disposed)
                    return;
                if (!stream.ready) {
                    note.textContent = stream.message || 'In attesa del flusso · nuovo tentativo automatico';
                    retry = setTimeout(() => void connect(), 4000);
                    return;
                }
                if (video.canPlayType('application/vnd.apple.mpegurl'))
                    video.src = stream.url;
                else {
                    const { default: Hls } = await import('hls.js');
                    if (disposed)
                        return;
                    if (!Hls.isSupported())
                        throw Error('Video HLS non supportato dal browser');
                    hls = new Hls();
                    hls.loadSource(stream.url);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) {
                        note.textContent = 'Flusso interrotto · riconnessione…';
                        clearTimeout(retry);
                        retry = setTimeout(() => void connect(), 5000);
                    } });
                }
                void video.play().catch(() => { if (!disposed)
                    note.textContent = 'Premi ▶ per avviare il video'; });
            }
            catch (error) {
                if (!disposed) {
                    note.textContent = error instanceof Error ? error.message : 'Connessione non disponibile';
                    retry = setTimeout(() => void connect(), 10000);
                }
            }
        };
        video.onplaying = () => { note.textContent = 'Video in diretta · ritardo di alcuni secondi'; };
        video.onerror = () => { if (!disposed) {
            note.textContent = 'Flusso interrotto · riconnessione…';
            clearTimeout(retry);
            retry = setTimeout(() => void connect(), 5000);
        } };
        const health = setInterval(() => { if (video.paused || disposed)
            return; if (video.currentTime === lastTime)
            stalled++;
        else
            stalled = 0; lastTime = video.currentTime; if (stalled >= 3) {
            stalled = 0;
            clearTimeout(retry);
            void connect();
        } }, 5000);
        players.set(camera.id, () => { disposed = true; clearTimeout(retry); clearInterval(health); video.onerror = null; clearMedia(); tile.remove(); });
        void connect();
    }
    function sync() {
        if (position) {
            const found = nearbyCameras(cameras, position, near);
            near = new Set(found.map(c => c.id));
            for (const id of dismissed)
                if (!near.has(id))
                    dismissed.delete(id);
        }
        const ordered = [...pinned, ...near].filter((id, index, all) => all.indexOf(id) === index && !dismissed.has(id));
        const desired = enabled && !document.hidden ? ordered.map(id => cameras.find(c => c.id === id && c.enabled)).filter((c): c is Camera => !!c).slice(0, 3) : [];
        for (const [id, dispose] of players)
            if (!desired.some(c => c.id === id)) {
                dispose();
                players.delete(id);
            }
        for (const camera of desired)
            if (!players.has(camera.id))
                addPlayer(camera);
        dock.hidden = players.size === 0;
    }
    async function refresh() { const data = await request(''); enabled = data.enabled; cameras = data.cameras; toggle.checked = enabled; drawList(); sync(); }
    el('open-cameras').addEventListener('click', () => { dialog.showModal(); void refresh().catch(failure); }, { signal });
    el('close-cameras').addEventListener('click', () => dialog.close(), { signal });
    toggle.addEventListener('change', () => { toggle.disabled = true; void request('/enabled', 'POST', { enabled: toggle.checked }).then(refresh).catch(failure).finally(() => { toggle.disabled = false; }); }, { signal });
    search.addEventListener('input', drawList, { signal });
    el('camera-use-center').addEventListener('click', () => { const p = map.getCamera().center; el<HTMLInputElement>('camera-lat').value = p.latitude.toFixed(6); el<HTMLInputElement>('camera-lng').value = p.longitude.toFixed(6); }, { signal });
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity())
            return;
        const submit = el<HTMLButtonElement>('save-camera');
        submit.disabled = true;
        void request('', 'POST', { name: el<HTMLInputElement>('camera-name').value, rtspUrl: el<HTMLInputElement>('camera-url').value, latitude: Number(el<HTMLInputElement>('camera-lat').value), longitude: Number(el<HTMLInputElement>('camera-lng').value), radiusMeters: Number(el<HTMLInputElement>('camera-radius').value), enabled: true }).then(async () => { form.reset(); state.textContent = 'Telecamera salvata sul server locale.'; await refresh(); }).catch(failure).finally(() => { submit.disabled = false; });
    }, { signal });
    // Buttons mounted by the shared shadcn bridge have type=button.
    el('save-camera').addEventListener('click', () => form.requestSubmit(), { signal });
    const unsubscribe = map.on('markerClick', ({ id }) => { const c = cameras.find(c => 'camera:' + c.id === id); if (c)
        open(c); });
    document.addEventListener('visibilitychange', sync, { signal });
    signal.addEventListener('abort', () => { unsubscribe(); for (const dispose of players.values())
        dispose(); players.clear(); }, { once: true });
    void refresh().catch(failure);
    return { updatePosition(p: Position) { position = p; if (performance.now() - lastCheck > 500) {
            lastCheck = performance.now();
            sync();
        } }, reset() { position = undefined; near.clear(); sync(); } };
}
