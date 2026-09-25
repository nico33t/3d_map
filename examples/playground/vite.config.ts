import { readFileSync } from 'node:fs';
import { createRtspService } from '@3d-map/rtsp/server';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createAitrackGateway } from '@3d-map/aitrack-server';

const root = new URL('../../', import.meta.url).pathname;

function aitrackProxy(apiKey: string, webhookSecret: string): Plugin {
  const rtsp = createRtspService({ storageDir: root + '.local' });
  const gateway = createAitrackGateway({ apiKey, webhookSecret });
  return {
    name: 'aitrack-local-gateway',
    configureServer(server) { server.middlewares.use((req, res, next) => { void rtsp.middleware(req, res, () => { void gateway.local(req, res, next); }); }); server.httpServer?.once('close', () => { gateway.close(); rtsp.close(); }); },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void rtsp.middleware(req, res, () => { void gateway.local(req, res, next); }); }); server.httpServer?.once('close', () => { gateway.close(); rtsp.close(); }); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  return {
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    envDir: root,
    // Deliberately exclude VITE_AITRACK_API_KEY from all client-side env values.
    envPrefix: ['VITE_MAPBOX_', 'VITE_AITRACK_DEVICE_'],
    publicDir: new URL('../../packages/vehicles-3d/assets', import.meta.url).pathname,
    plugins: [{
      name: 'app-manifest',
      generateBundle() { for (const name of ['app.webmanifest', 'app-icon.svg', 'sw.js']) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(new URL('./public/' + name, import.meta.url)) }); },
      configureServer(server) { server.middlewares.use((req, res, next) => { const name = req.url?.slice(1); if (!name || !['app.webmanifest','app-icon.svg','sw.js'].includes(name)) return next(); res.setHeader('Content-Type', name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.js') ? 'text/javascript' : 'application/manifest+json'); res.end(readFileSync(new URL('./public/' + name, import.meta.url))); }); },
    }, tailwindcss(), aitrackProxy(env.VITE_AITRACK_API_KEY ?? '', env.AITRACK_WEBHOOK_SECRET ?? '')],
  };
});
