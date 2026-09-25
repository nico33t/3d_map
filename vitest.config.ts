import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@3d-map/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname } },
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
