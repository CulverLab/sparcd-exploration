import { defineConfig, type UserConfig } from 'vite';
import type { InlineConfig } from 'vitest/node';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Workspace packages are consumed as TypeScript source (no dist/). Aliasing
// them to their src entry lets Vite transpile them as app source.
const pkg = (name: string, entry: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/${entry}`, import.meta.url));

export default defineConfig({
  // Served from a subpath on GitHub Pages: culverlab.github.io/sparcd-exploration/uploader/
  // Vite dev still serves from '/', so this only affects the production build.
  base: '/sparcd-exploration/uploader/',
  plugins: [react()],
  // The dep scanner doesn't follow Web Workers, so exifr and hash-wasm (only
  // imported by fileProcessor.worker.ts) were discovered on first use and made
  // Vite re-bundle and reload every open page mid-run.
  optimizeDeps: { include: ['exifr', 'hash-wasm'] },
  resolve: {
    alias: {
      '@sparcd/types': pkg('types', 'index.ts'),
      '@sparcd/s3-safe': pkg('s3-safe', 'index.ts'),
      '@sparcd/auth-ui': pkg('auth-ui', 'index.ts'),
      '@sparcd/camtrap': pkg('camtrap', 'index.ts'),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Vitest reads this file too. `bddgen` emits Playwright specs under
  // features/.features-gen/, which match Vitest's default `*.spec.js` glob —
  // keep the unit suite out of them.
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'features/.features-gen/**'],
  },
} as UserConfig & { test: InlineConfig });
