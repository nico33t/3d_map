import { cpSync, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = new URL('.', import.meta.url).pathname;
const kenney = new URL('../../packages/vehicles-3d/assets/kenney/', import.meta.url).pathname;

/** Serves and copies only the small CC0 Kenney models (with their license) under /models/kenney/. */
function vehicleModels(): Plugin {
  const types: Record<string, string> = { '.glb': 'model/gltf-binary', '.png': 'image/png', '.txt': 'text/plain' };
  return {
    name: 'vehicle-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (!path.startsWith('/models/kenney/')) return next();
        const file = normalize(join(kenney, decodeURIComponent(path.slice('/models/kenney/'.length))));
        if (!file.startsWith(kenney) || !existsSync(file)) return next();
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    closeBundle() { cpSync(kenney, join(here, 'dist/models/kenney'), { recursive: true }); },
  };
}

export default defineConfig({
  root: join(here, 'web'),
  publicDir: join(here, 'public'),
  envPrefix: [],
  build: { outDir: join(here, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2500 },
  plugins: [vehicleModels()],
});
