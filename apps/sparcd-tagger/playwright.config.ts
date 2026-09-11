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
const port = Number(process.env.SPARCD_E2E_PORT ?? '5312');
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  webServer: {
    command: `./node_modules/.bin/vite --port ${port} --strictPort`,
    url: `${origin}/sparcd-exploration/tagger/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // `.env` may carry a dev-only endpoint prefill. Blank it so the suite sees
    // the deployed behaviour (nothing pre-filled but the persisted connection).
    env: { VITE_SPARCD_S3_ENDPOINT: '' },
  },
  use: {
    baseURL: origin,
    headless: true,
    viewport: { width: 1440, height: 950 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
