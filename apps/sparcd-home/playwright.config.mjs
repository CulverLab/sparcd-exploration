import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  use: { browserName: 'chromium', reducedMotion: 'reduce' },
});
