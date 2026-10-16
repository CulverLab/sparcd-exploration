import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './bench',
  testMatch: 'bench.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['line']],
  use: {
    baseURL: `http://localhost:${process.env.BENCH_APP_PORT ?? '5316'}/sparcd-exploration/uploader/`,
    headless: true,
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
