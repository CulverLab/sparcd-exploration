import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

// As-built verification harness: the .feature files under `features/` describe
// what this app does today. `bddgen` turns them into Playwright specs against
// the step definitions in `features/steps/`, which drive the real app with all
// S3 traffic mocked (see `features/steps/support/s3mock.ts`).
const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: 'features/steps/**/*.ts',
  tags: 'not @manual',
});

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  webServer: {
    // pnpm 10 forwards trailing args as-is, so a literal `--` would reach Vite's
    // CLI and turn `--port` into a positional. Same effect, without the sentinel.
    command: 'pnpm dev --port 5312 --strictPort',
    url: 'http://localhost:5312/sparcd-exploration/tagger/',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // `.env` may carry a dev-only endpoint prefill. Blank it so the suite sees
    // the deployed behaviour (nothing pre-filled but the persisted connection).
    env: { VITE_SPARCD_S3_ENDPOINT: '' },
  },
  use: {
    baseURL: 'http://localhost:5312',
    headless: true,
    viewport: { width: 1440, height: 950 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
