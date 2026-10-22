import { defineConfig, mergeConfig } from 'vite';
import appConfig from './vite.config';

// The live cross-app scenario imports production Uploader Settings at runtime.
// Scan its dependencies up front so optimization cannot reload the mounted UI.
export default mergeConfig(appConfig, defineConfig({
  optimizeDeps: {
    entries: ['index.html', '../sparcd-uploader/src/sections/Settings.tsx'],
    force: true,
  },
}));
