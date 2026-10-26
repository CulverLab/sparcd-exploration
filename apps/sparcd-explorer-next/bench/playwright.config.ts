import { defineConfig } from '@playwright/test';

// The Photos bench: a production build against the feature suite's in-page
// S3 mock, seeded with 50 synthetic collections of 10,000 photos each. Run
// with `npx playwright test -c bench`. Not part of CI.
const port = 5399;
process.env.SPARCD_E2E_PORT = String(port);
const out = process.env.BENCH_OUT_DIR ?? 'node_modules/.bench-dist';

export default defineConfig({
  testDir: '.',
  testMatch: /\.pw\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  reporter: [['list']],
  webServer: {
    command: `./node_modules/.bin/vite build --logLevel warn --outDir ${out} --emptyOutDir && ./node_modules/.bin/vite preview --outDir ${out} --port ${port} --strictPort`,
    cwd: '..',
    url: `http://localhost:${port}/sparcd-exploration/explorer-next/`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { VITE_SPARCD_S3_ENDPOINT: '' },
  },
  use: { baseURL: `http://localhost:${port}`, headless: true, viewport: { width: 1440, height: 950 } },
});
