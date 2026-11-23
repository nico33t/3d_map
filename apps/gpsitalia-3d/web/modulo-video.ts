/**
 * Module «video»: exports the open timelapse as a video file, recorded in the browser.
 * Loaded lazily and served only to users the server switched the module on for.
 */
import { coverCrop, dayLabel, estimateMegabytes, minutesPerSecond, pickVideoType, recordingTime, VIDEO_BITRATE, VIDEO_DURATIONS_S, VIDEO_FORMATS, VIDEO_FPS, VIDEO_WARMUP_MS, videoFileName, type VideoFormatId } from '../src/video';

export interface VideoHost {
  /** The map's WebGL canvas. */
  mapCanvas: HTMLCanvasElement;
  name: string;
  plate: string;
  /** YYYY-MM-DD of the open timelapse. */
  day: string;
  from: number;
  to: number;
  /** Moves the timelapse to `t` (model, trail and, when following, the camera). Returns km/h at `t`. */
  seek(t: number, follow: boolean): number;
  /** Frames the whole route. */
  frameRoute(): void;
  /** Counts as user activity for the inactivity prompt. */
  keepAlive(): void;
  /** While busy the page must not navigate on its own (token renewal waits). */
  setBusy(busy: boolean): void;
  /** Aborted when the page is closing or the session ended. */
  signal: AbortSignal;
}

type Camera = 'segui' | 'percorso';
type Step = 'setup' | 'recording' | 'done' | 'error';

const ATTRIBUTION = '© Mapbox © OpenStreetMap';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function segmented<T extends string>(legend: string, options: readonly { value: T; label: string; sub?: string }[], initial: T, onChange: (value: T) => void) {
  let current = initial;
  const buttons = options.map(option => {
    const button = h('button', { type: 'button', className: 'vx-opt' }, h('span', { className: 'vx-opt-label' }, option.label));
    if (option.sub) button.append(h('span', { className: 'vx-opt-sub' }, option.sub));
    button.addEventListener('click', () => { current = option.value; sync(); onChange(current); });
    return { button, option };
  });
  const sync = () => { for (const { button, option } of buttons) button.setAttribute('aria-pressed', String(option.value === current)); };
  sync();
  const fieldset = h('fieldset', { className: 'vx-field' }, h('legend', {}, legend), h('div', { className: 'vx-seg' }, ...buttons.map(b => b.button)));
  return { fieldset, setSub: (value: T, sub: string) => { const found = buttons.find(b => b.option.value === value); const el = found?.button.querySelector('.vx-opt-sub'); if (el) el.textContent = sub; } };
}

function toggle(label: string, sub: string, initial: boolean, onChange: (on: boolean) => void) {
  let on = initial;
  const button = h('button', { type: 'button', className: 'vx-toggle' },
    h('span', { className: 'vx-toggle-text' }, h('span', {}, label), h('span', { className: 'vx-opt-sub' }, sub)),
    h('span', { className: 'vx-switch' }));
  button.setAttribute('role', 'switch');
  const sync = () => button.setAttribute('aria-checked', String(on));
  button.addEventListener('click', () => { on = !on; sync(); onChange(on); });
  sync();
  return button;
}

/** Opens the export dialog. Resolves when the dialog is closed. */
export function openVideoExport(host: VideoHost): Promise<void> {
  const type = pickVideoType(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  const settings = { format: 'orizzontale' as VideoFormatId, duration: 60 as number, camera: 'segui' as Camera, clock: true, speed: true, name: true, plate: false };
  let step: Step = 'setup';
  let cancelRecording: (() => void) | undefined;
  let downloadUrl: string | undefined;

  const dialog = h('dialog', { className: 'vx-dialog' });
  dialog.setAttribute('aria-labelledby', 'vx-title');
  const title = h('h2', { id: 'vx-title' }, 'Esporta come video');
  const subtitle = h('p', { className: 'vx-muted' }, [host.name, dayLabel(host.day)].filter(Boolean).join(', '));
  const close = h('button', { type: 'button', className: 'vx-close', ariaLabel: 'Chiudi' }, '✕');
  const body = h('div', { className: 'vx-body' });
  dialog.append(h('header', { className: 'vx-head' }, h('div', {}, title, subtitle), close), body);

  const estimate = h('p', { className: 'vx-muted' });
  const updateEstimate = () => { estimate.textContent = type ? `${type.label}, circa ${estimateMegabytes(settings.duration)} MB, ${VIDEO_FORMATS[settings.format].width} × ${VIDEO_FORMATS[settings.format].height}` : ''; };

  const renderSetup = () => {
    if (!type) {
      body.replaceChildren(h('p', {}, 'Questo browser non può creare video. Usa Chrome, Edge o Safari aggiornati.'));
      return;
    }
    const formats = segmented('Formato', (Object.keys(VIDEO_FORMATS) as VideoFormatId[]).map(id => ({ value: id, label: VIDEO_FORMATS[id].label, sub: VIDEO_FORMATS[id].ratio })), settings.format, v => { settings.format = v; updateEstimate(); });
    const durations = segmented('Durata del video', VIDEO_DURATIONS_S.map(s => ({ value: String(s), label: s >= 60 ? `${s / 60} min` : `${s} s`, sub: `${minutesPerSecond(host.from, host.to, s)} min al secondo` })), String(settings.duration), v => { settings.duration = Number(v); updateEstimate(); });
    const cameras = segmented<Camera>('Inquadratura', [{ value: 'segui', label: 'Segue il mezzo' }, { value: 'percorso', label: 'Percorso intero' }], settings.camera, v => { settings.camera = v; });
    const overlays = h('fieldset', { className: 'vx-field' }, h('legend', {}, 'Nel video'),
      toggle('Orario e data', 'In basso a sinistra', settings.clock, on => { settings.clock = on; }),
      toggle('Velocità', 'Aggiornata a ogni punto', settings.speed, on => { settings.speed = on; }),
      toggle('Nome del mezzo', 'In alto a sinistra', settings.name, on => { settings.name = on; }),
      toggle('Targa', 'Spenta di base: attenzione se condividi il video', settings.plate, on => { settings.plate = on; }));
    const start = h('button', { type: 'button', className: 'vx-primary' }, 'Crea il video');
    start.addEventListener('click', () => void record());
    updateEstimate();
    body.replaceChildren(formats.fieldset, durations.fieldset, cameras.fieldset, overlays,
      h('p', { className: 'vx-note' }, 'Il video si crea qui, in tempo reale. Tieni questa scheda in primo piano fino alla fine: se la nascondi la registrazione si interrompe.'),
      h('div', { className: 'vx-actions' }, estimate, start));
  };

  const progressBar = h('div', { className: 'vx-bar' }, h('span'));
  const progressText = h('span', { className: 'vx-pct' }, '0%');
  const progressState = h('p', { className: 'vx-muted' }, 'Preparazione della mappa…');
  const renderRecording = () => {
    const cancel = h('button', { type: 'button', className: 'vx-secondary' }, 'Annulla');
    cancel.addEventListener('click', () => cancelRecording?.());
    progressBar.setAttribute('role', 'progressbar');
    progressBar.setAttribute('aria-label', 'Avanzamento');
    body.replaceChildren(h('div', { className: 'vx-row' }, h('strong', {}, 'Creazione del video'), progressText), progressBar, progressState, cancel);
  };
  const setProgress = (fraction: number) => {
    const pct = Math.round(fraction * 100);
    progressText.textContent = `${pct}%`;
    (progressBar.firstElementChild as HTMLElement).style.width = `${pct}%`;
    progressBar.setAttribute('aria-valuenow', String(pct));
  };

  const renderDone = (blob: Blob, extension: string, label: string) => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    const name = videoFileName(host.name, host.day, extension);
    const link = h('a', { href: downloadUrl, download: name, className: 'vx-primary' }, 'Scarica il video');
    const again = h('button', { type: 'button', className: 'vx-secondary' }, 'Crea un altro');
    again.addEventListener('click', () => { step = 'setup'; renderSetup(); });
    body.replaceChildren(h('p', { className: 'vx-ok' }, 'Video pronto'), h('p', { className: 'vx-muted' }, `${label}, ${Math.max(1, Math.round(blob.size / 1_000_000))} MB`), h('p', { className: 'vx-file' }, name), h('div', { className: 'vx-actions' }, link, again));
    link.focus();
  };

  const renderError = (message: string) => {
    const again = h('button', { type: 'button', className: 'vx-secondary' }, 'Riprova');
    again.addEventListener('click', () => { step = 'setup'; renderSetup(); });
    body.replaceChildren(h('p', { role: 'alert' } as Partial<HTMLParagraphElement>, message), again);
  };

  async function record() {
    if (!type || step === 'recording') return;
    step = 'recording';
    renderRecording();
    host.setBusy(true);
    const format = VIDEO_FORMATS[settings.format];
    const stopper = new AbortController();
    const signal = AbortSignal.any([stopper.signal, host.signal]);
    let reason = '';
    cancelRecording = () => { reason = 'Registrazione annullata.'; stopper.abort(); };
    const onHidden = () => { if (document.hidden) { reason = 'Registrazione interrotta: la scheda è stata nascosta. Riprova tenendola in primo piano.'; stopper.abort(); } };
    document.addEventListener('visibilitychange', onHidden);
    let source: MediaStream | undefined, output: MediaStream | undefined;
    const video = h('video', { muted: true, playsInline: true });
    try {
      // Start position and camera, then let tiles load.
      host.seek(host.from, settings.camera === 'segui');
      if (settings.camera === 'percorso') host.frameRoute();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, VIDEO_WARMUP_MS);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      // The WebGL canvas is read through its own stream: frames stay valid without preserveDrawingBuffer.
      source = host.mapCanvas.captureStream(VIDEO_FPS);
      video.srcObject = source;
      // The stream only yields frames when the map repaints: nudge it, never wait forever.
      void video.play().catch(() => undefined);
      for (let i = 0; i < 30 && video.readyState < 2; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        host.seek(host.from + (i % 2), settings.camera === 'segui');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const canvas = h('canvas', { width: format.width, height: format.height });
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      output = canvas.captureStream(VIDEO_FPS);
      const recorder = new MediaRecorder(output, { mimeType: type.mimeType, videoBitsPerSecond: VIDEO_BITRATE });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      const durationMs = settings.duration * 1000;
      progressState.textContent = 'Registrazione in corso. Non nascondere questa scheda.';
      recorder.start(1000);
      const started = performance.now();
      let lastAlive = started;
      await new Promise<void>((resolve, reject) => {
        const frame = (now: number) => {
          if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
          const elapsed = now - started;
          const t = recordingTime(host.from, host.to, elapsed, durationMs);
          const speed = host.seek(t, settings.camera === 'segui');
          drawFrame(ctx, video, format.width, format.height, t, speed, elapsed / durationMs);
          setProgress(Math.min(1, elapsed / durationMs));
          if (now - lastAlive > 5_000) { lastAlive = now; host.keepAlive(); }
          if (elapsed >= durationMs) { resolve(); return; }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }).catch(error => { recorder.stop(); throw error; });
      // One last frame at the end of the day, then close the file.
      drawFrame(ctx, video, format.width, format.height, host.to, host.seek(host.to, settings.camera === 'segui'), 1);
      await new Promise(resolve => setTimeout(resolve, 200));
      recorder.stop();
      await stopped;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const blob = new Blob(chunks, { type: type.mimeType.split(';')[0] ?? type.mimeType });
      if (!blob.size) throw new Error('empty');
      step = 'done';
      renderDone(blob, type.extension, type.label);
    } catch (error) {
      // Nothing partial is ever offered for download.
      if (host.signal.aborted) return;
      step = 'error';
      renderError(reason || (error instanceof DOMException && error.name === 'AbortError' ? 'Registrazione interrotta.' : 'Non è stato possibile creare il video. Riprova.'));
    } finally {
      document.removeEventListener('visibilitychange', onHidden);
      for (const track of [...(source?.getTracks() ?? []), ...(output?.getTracks() ?? [])]) track.stop();
      video.srcObject = null;
      cancelRecording = undefined;
      host.setBusy(false);
    }
  }

  function drawFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h2: number, t: number, speed: number, progress: number) {
    const u = Math.min(w, h2) / 1080;
    const crop = coverCrop(video.videoWidth, video.videoHeight, w, h2);
    if (video.readyState >= 2 && crop.sw > 0 && crop.sh > 0) ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h2);
    else if (video.readyState < 2) { ctx.fillStyle = '#e5e7eb'; ctx.fillRect(0, 0, w, h2); }
    const pad = 48 * u;
    const font = (size: number, weight = 600) => `${weight} ${Math.round(size * u)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    // Top band: name, plate, brand.
    let gradient = ctx.createLinearGradient(0, 0, 0, 220 * u);
    gradient.addColorStop(0, 'rgba(0,0,0,0.5)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, 220 * u);
    ctx.textBaseline = 'top'; ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6 * u;
    if (settings.name) {
      ctx.font = font(44); ctx.textAlign = 'left'; ctx.fillText(host.name, pad, pad, w * 0.6);
      if (settings.plate && host.plate) { ctx.font = font(28, 500); ctx.fillText(host.plate, pad, pad + 56 * u, w * 0.6); }
    }
    ctx.shadowBlur = 0;
    const brand = 'GPS Italia';
    ctx.font = font(26); const bw = ctx.measureText(brand).width + 36 * u, bh = 48 * u;
    ctx.fillStyle = 'rgba(255,255,255,0.94)'; roundRect(ctx, w - pad - bw, pad, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(brand, w - pad - bw / 2, pad + bh / 2);
    // Bottom band: clock, date, speed, progress, attribution.
    const bandH = 300 * u;
    gradient = ctx.createLinearGradient(0, h2 - bandH, 0, h2);
    gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = gradient; ctx.fillRect(0, h2 - bandH, w, bandH);
    const barY = h2 - pad - 34 * u;
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; roundRect(ctx, pad, barY, w - 2 * pad, 8 * u, 4 * u); ctx.fill();
    ctx.fillStyle = '#ffffff'; roundRect(ctx, pad, barY, Math.max(8 * u, (w - 2 * pad) * Math.min(1, progress)), 8 * u, 4 * u); ctx.fill();
    ctx.font = font(20, 500); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(ATTRIBUTION, w - pad, barY + 16 * u);
    ctx.textBaseline = 'alphabetic'; ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6 * u;
    if (settings.clock) {
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
      ctx.font = font(88, 700); ctx.fillText(new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), pad, barY - 60 * u);
      ctx.font = font(28, 500); ctx.fillText(dayLabel(host.day), pad, barY - 20 * u);
    }
    ctx.shadowBlur = 0;
    if (settings.speed) {
      const text = `${Math.round(speed)} km/h`;
      ctx.font = font(34); const sw = ctx.measureText(text).width + 40 * u, sh = 60 * u;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, w - pad - sw, barY - 30 * u - sh, sw, sh, sh / 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w - pad - sw / 2, barY - 30 * u - sh / 2);
    }
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, hh, r);
  }

  return new Promise<void>(resolve => {
    const finish = () => {
      cancelRecording?.();
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      dialog.remove();
      resolve();
    };
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (step === 'recording') event.preventDefault(); });
    dialog.addEventListener('close', finish, { once: true });
    host.signal.addEventListener('abort', () => { if (dialog.open) dialog.close(); }, { once: true });
    document.body.append(dialog);
    renderSetup();
    dialog.showModal();
  });
}
