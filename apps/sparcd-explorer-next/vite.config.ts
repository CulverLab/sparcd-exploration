import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Workspace packages are consumed as TypeScript source (no dist/). Aliasing
// them to their src entry lets Vite transpile them as app source.
const pkg = (name: string, entry: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/${entry}`, import.meta.url));

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.features-gen/**'],
  },
  // Served from a subpath on GitHub Pages: culverlab.github.io/sparcd-exploration/explorer-next/
  // Pages serves this under the repo's name; a fork with another name sets PAGES_BASE.
  base: process.env.PAGES_BASE ?? '/sparcd-exploration/explorer-next/',
  server: { port: 5314 },
  plugins: [react()],
  // Deps first imported after the initial page load (thumbnail workers, the
  // map) make a cold Vite cache re-optimize and reload the page mid-run.
  optimizeDeps: { include: ['exifr', 'exifr/dist/mini.esm.mjs', 'leaflet'] },
  resolve: {
    alias: {
      '@sparcd/types': pkg('types', 'index.ts'),
      '@sparcd/s3-safe': pkg('s3-safe', 'index.ts'),
      '@sparcd/auth-ui': pkg('auth-ui', 'index.ts'),
      '@sparcd/camtrap': pkg('camtrap', 'index.ts'),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
