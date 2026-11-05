import { defineConfig } from 'vite';

// `base: './'` makes the static build work from any sub-path
// (GitHub Pages project sites, Cloudflare Pages, a local file server).
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
