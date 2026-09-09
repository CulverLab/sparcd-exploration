import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import config from './playwright.config';

// The built app must start Inspect without fetching a worker script. Vite dev
// serves worker modules over HTTP, so exercise real offline mode against dist.
export default defineConfig({
  ...config,
  testDir: defineBddConfig({
    features: 'features/**/*.feature',
    steps: 'features/steps/**/*.ts',
    outputDir: 'features/.features-gen-offline',
    tags: '@offline',
    missingSteps: 'fail-on-gen',
  }),
  outputDir: 'test-results/offline',
  use: { ...config.use, baseURL: 'http://localhost:5313' },
  webServer: {
    command: 'pnpm exec vite preview --port 5313 --strictPort',
    url: 'http://localhost:5313/sparcd-exploration/uploader/',
    reuseExistingServer: false,
  },
});
