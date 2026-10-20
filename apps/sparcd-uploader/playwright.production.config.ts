import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const flows = defineBddConfig({
  features: ['features/connect-and-session.feature', 'features/tag-before-upload.feature', 'features/prepared-species.feature', 'features/settings-and-local-data.feature'],
  steps: 'features/steps/**/*.ts',
  outputDir: 'features/.features-gen-production',
  tags: '@offline or @cross-tool or @preparation-cleanup',
  missingSteps: 'fail-on-gen',
});
const port = Number(process.env.PRODUCTION_TEST_PORT ?? 5335);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  workers: 1,
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results/production',
  use: {
    baseURL, channel: 'chrome', headless: true,
    locale: 'en-US', timezoneId: 'America/New_York',
    viewport: { width: 1440, height: 950 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'production-infrastructure', testDir: 'e2e/production', testMatch: '**/*.spec.ts' },
    { name: 'production-existing-flows', testDir: flows },
  ],
  webServer: {
    command: 'node e2e/production/server.mjs',
    url: `${baseURL}/sparcd-exploration/uploader/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
