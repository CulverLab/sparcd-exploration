import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: 'features/steps/**/*.ts',
  outputDir: 'features/.features-gen',
  tags: 'not @manual and not @cross-tool and not @offline',
  missingSteps: 'fail-on-gen',
});
const port = Number(process.env.UPLOADER_TEST_PORT ?? 5311);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir,
  fullyParallel: true,
  workers: 3,
  retries: process.env.CI ? 2 : 0,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    url: `${baseURL}/sparcd-exploration/uploader/`,
    reuseExistingServer: false,
    timeout: 120_000,
    // The dev-only endpoint prefill would otherwise override the "remembered
    // from the previous connection" prefill these scenarios assert on, and a
    // developer's local write-scope guard would refuse every PUT the mock
    // bucket takes — both live in a gitignored .env, so pin them here.
    env: { VITE_SPARCD_S3_ENDPOINT: '', VITE_SPARCD_S3_WRITE_SCOPE: '*' },
  },
});
