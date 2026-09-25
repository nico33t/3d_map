import { createRtspService } from '@3d-map/rtsp/server';
import { createServer } from 'node:http';
import { chmodSync, createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createAitrackGateway } from './index.js';
const root = process.cwd();
const appRoot = resolve(root, 'examples/playground/dist');
const apiPort = Number(process.env.APP_PORT ?? 8787);
const webhookPort = Number(process.env.WEBHOOK_PORT ?? 8788);
const gateway = createAitrackGateway({
  apiKey: process.env.VITE_AITRACK_API_KEY ?? '', webhookSecret: process.env.AITRACK_WEBHOOK_SECRET ?? '',
  runtimeState: () => { try { return JSON.parse(readFileSync(resolve(root, '.local/runtime.json'), 'utf8')); } catch { return {}; } },
  saveWebhookSecret: secret => {
    const envPath = resolve(root, '.env');
    const original = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    const line = `AITRACK_WEBHOOK_SECRET=${secret}`;
    writeFileSync(envPath, /^AITRACK_WEBHOOK_SECRET=.*$/m.test(original) ? original.replace(/^AITRACK_WEBHOOK_SECRET=.*$/m, line) : `${original.trimEnd()}\n${line}\n`, { mode: 0o600 });
    chmodSync(envPath, 0o600);
  },
});
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const rtsp = createRtspService({ storageDir: resolve(root, '.local') });
const app = createServer((req, res) => {
  void rtsp.middleware(req, res, () => { void gateway.local(req, res, () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let path: string;
    try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    const file = resolve(appRoot, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(appRoot + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }).catch(() => { if (!res.headersSent) res.writeHead(500).end(); }); });
});
// Only the signed webhook receiver is exposed through the public tunnel.
const ingress = createServer((req, res) => { void gateway.webhook(req, res); });
for (const server of [app, ingress]) { server.requestTimeout = 15000; server.headersTimeout = 10000; server.on('error', () => process.exit(1)); }
app.listen(apiPort, '127.0.0.1', () => console.log(`App pronta: http://127.0.0.1:${apiPort}`));
ingress.listen(webhookPort, '127.0.0.1');
const stop = () => { gateway.close(); rtsp.close(); app.closeAllConnections(); ingress.closeAllConnections(); app.close(); ingress.close(); setTimeout(() => process.exit(0), 100).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
