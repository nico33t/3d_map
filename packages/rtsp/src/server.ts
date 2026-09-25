import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, createReadStream, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Camera } from './index.js';
interface SavedCamera extends Camera {
    rtspUrl: string;
}
export function publicCamera(c: SavedCamera): Camera { return { id: c.id, name: c.name, longitude: c.longitude, latitude: c.latitude, radiusMeters: c.radiusMeters, enabled: c.enabled }; }
export function validateCamera(value: unknown): Omit<SavedCamera, 'id'> {
    const c = value as Record<string, unknown>;
    if (!c || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 100 || typeof c.rtspUrl !== 'string' || c.rtspUrl.length > 2048)
        throw Error('Dati telecamera non validi');
    let url: URL;
    try {
        url = new URL(c.rtspUrl);
    }
    catch {
        throw Error('URL RTSP non valido');
    }
    if (!['rtsp:', 'rtsps:'].includes(url.protocol) || !url.hostname)
        throw Error('Usa un URL rtsp:// o rtsps://');
    if (typeof c.longitude !== 'number' || !Number.isFinite(c.longitude) || Math.abs(c.longitude) > 180 || typeof c.latitude !== 'number' || !Number.isFinite(c.latitude) || Math.abs(c.latitude) > 85.051129 || typeof c.radiusMeters !== 'number' || !Number.isFinite(c.radiusMeters) || c.radiusMeters < 10 || c.radiusMeters > 10000)
        throw Error('Coordinate o raggio non validi (10–10000 m)');
    return { name: c.name.trim(), rtspUrl: c.rtspUrl, longitude: c.longitude, latitude: c.latitude, radiusMeters: c.radiusMeters, enabled: c.enabled !== false };
}
export function createRtspService(options: {
    storageDir: string;
    ffmpegPath?: string;
}) {
    const dir = resolve(options.storageDir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = resolve(dir, 'cameras.json');
    let enabled = false, cameras: SavedCamera[] = [];
    try {
        const stored = JSON.parse(readFileSync(file, 'utf8'));
        enabled = stored.enabled === true;
        cameras = stored.cameras.map((c: SavedCamera) => ({ ...validateCamera(c), id: /^[a-f0-9-]{36}$/.test(c.id) ? c.id : randomUUID() }));
    }
    catch {
        if (existsSync(file))
            throw Error('Configurazione telecamere non leggibile');
    }
    const save = () => { writeFileSync(file + '.tmp', JSON.stringify({ enabled, cameras }), { mode: 0o600 }); renameSync(file + '.tmp', file); chmodSync(file, 0o600); };
    const streams = new Map<string, {
        process: ChildProcess;
        dir: string;
        touched: number;
        failed: boolean;
        closed: boolean;
        message: string;
    }>();
    const stop = (id: string) => { const s = streams.get(id); if (!s)
        return; streams.delete(id); if (s.closed) {
        rmSync(s.dir, { recursive: true, force: true });
        return;
    } s.process.kill('SIGTERM'); const kill = setTimeout(() => s.process.kill('SIGKILL'), 2000); kill.unref(); s.process.once('close', () => { clearTimeout(kill); rmSync(s.dir, { recursive: true, force: true }); }); };
    // Dev and managed app may share the same local settings; reload before edits.
    const reload = () => {
        if (!existsSync(file)) return;
        const stored = JSON.parse(readFileSync(file, 'utf8'));
        const updated: SavedCamera[] = stored.cameras.map((c: SavedCamera) => ({ ...validateCamera(c), id: c.id }));
        for (const id of streams.keys()) {
            const old = cameras.find(c => c.id === id), next = updated.find(c => c.id === id);
            if (!stored.enabled || !next?.enabled || old?.rtspUrl !== next.rtspUrl) stop(id);
        }
        enabled = stored.enabled === true; cameras = updated;
    };
    const timer = setInterval(() => { for (const [id, s] of streams)
        if (Date.now() - s.touched > 30000)
            stop(id); }, 5000);
    timer.unref();
    const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(data)); };
    async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/cameras')) {
            next();
            return;
        }
        const host = req.headers.host ?? '';
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
            json(res, 403, { error: 'Accesso locale richiesto' });
            return;
        }
        try {
            let body: any;
            if (req.method !== 'GET') {
                if (req.headers.origin !== `http://${host}` || !req.headers['content-type']?.startsWith('application/json')) {
                    json(res, 403, { error: 'Origine non valida' });
                    return;
                }
                let raw = '';
                for await (const chunk of req) {
                    raw += chunk;
                    if (Buffer.byteLength(raw) > 8192) {
                        json(res, 413, { error: 'Richiesta troppo grande' });
                        return;
                    }
                }
                body = JSON.parse(raw);
            }
            reload();
            if (url.pathname === '/api/cameras') {
                if (req.method === 'GET') {
                    json(res, 200, { enabled, cameras: cameras.map(publicCamera) });
                    return;
                }
                if (req.method === 'POST') {
                    if (cameras.length >= 100)
                        throw Error('Massimo 100 telecamere');
                    const c = { ...validateCamera(body), id: randomUUID() };
                    cameras.push(c);
                    save();
                    json(res, 201, publicCamera(c));
                    return;
                }
            }
            if (url.pathname === '/api/cameras/enabled' && req.method === 'POST') {
                if (typeof body.enabled !== 'boolean')
                    throw Error('Stato non valido');
                enabled = body.enabled;
                if (!enabled)
                    for (const id of streams.keys())
                        stop(id);
                save();
                json(res, 200, { enabled });
                return;
            }
            const match = /^\/api\/cameras\/([a-f0-9-]{36})(?:\/(start|hls\/([^/]+)))?$/.exec(url.pathname);
            const c = match && cameras.find(c => c.id === match[1]);
            if (!c || !match) {
                json(res, 404, { error: 'Telecamera non trovata' });
                return;
            }
            if (!match[2] && req.method === 'DELETE') {
                stop(c.id);
                cameras = cameras.filter(x => x.id !== c.id);
                save();
                json(res, 200, { deleted: true });
                return;
            }
            if (!match[2] && req.method === 'PATCH') {
                if (typeof body.enabled !== 'boolean')
                    throw Error('Stato non valido');
                c.enabled = body.enabled;
                if (!c.enabled)
                    stop(c.id);
                save();
                json(res, 200, publicCamera(c));
                return;
            }
            if (!enabled || !c.enabled) {
                json(res, 409, { error: 'Integrazione o telecamera disattivata' });
                return;
            }
            if (match[2] === 'start' && req.method === 'POST') {
                let s = streams.get(c.id);
                const previousMessage = s?.failed ? s.message : '';
                if (s?.failed) {
                    stop(c.id);
                    s = undefined;
                }
                if (!s) {
                    if (streams.size >= 3) {
                        json(res, 429, { error: 'Massimo 3 video contemporanei' });
                        return;
                    }
                    const streamDir = resolve(dir, 'streams', randomUUID());
                    mkdirSync(streamDir, { recursive: true, mode: 0o700 });
                    const child = spawn(options.ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-rtsp_transport', 'tcp', '-timeout', '10000000', '-i', c.rtspUrl, '-an', '-vf', 'scale=960:540:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-r', '20', '-g', '40', '-sc_threshold', '0', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '4', '-hls_flags', 'delete_segments+temp_file+omit_endlist', '-hls_segment_filename', resolve(streamDir, 'segment%06d.ts'), resolve(streamDir, 'index.m3u8')], { stdio: ['ignore', 'ignore', 'pipe'] });
                    s = { process: child, dir: streamDir, touched: Date.now(), failed: false, closed: false, message: 'Telecamera non raggiungibile o flusso non supportato' };
                    streams.set(c.id, s);
                    const active = s;
                    child.once('error', () => { active.failed = true; active.message = 'FFmpeg non disponibile sul server'; });
                    child.stderr?.on('data', chunk => { const text = chunk.toString(); if (/401|unauthorized/i.test(text)) active.message = 'Credenziali della telecamera non valide'; else if (/404 Not Found/i.test(text)) active.message = 'Percorso RTSP non trovato'; });
                    child.once('exit', () => { active.failed = true; });
                    child.once('close', () => { active.closed = true; });
                }
                s.touched = Date.now();
                json(res, 200, { url: `/api/cameras/${c.id}/hls/index.m3u8`, ready: existsSync(resolve(s.dir, 'index.m3u8')), failed: s.failed, message: previousMessage });
                return;
            }
            if (match[3] && req.method === 'GET') {
                const s = streams.get(c.id), name = match[3];
                if (!s || s.failed || !/^(index\.m3u8|segment\d+\.ts)$/.test(name) || !existsSync(resolve(s.dir, name))) {
                    json(res, 404, { error: 'Flusso non disponibile' });
                    return;
                }
                s.touched = Date.now();
                res.writeHead(200, { 'Content-Type': name.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                createReadStream(resolve(s.dir, name)).on('error', () => res.destroy()).pipe(res);
                return;
            }
            json(res, 405, { error: 'Metodo non consentito' });
        }
        catch (error) {
            json(res, 400, { error: error instanceof Error && !error.message.includes('JSON') ? error.message.replace(/rtsp[s]?:\/\/\S+/g, '[URL]') : 'Richiesta non valida' });
        }
    }
    return { middleware, close() { clearInterval(timer); for (const id of streams.keys())
            stop(id); } };
}
