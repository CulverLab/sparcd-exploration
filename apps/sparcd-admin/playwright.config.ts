import { defineConfig, devices } from '@playwright/test'

const PREVIEW_PORT = Number(process.env.E2E_APP_PORT ?? 5411)
// The two apps the same people sign in to with the same login. They are built
// and served the way a deploy ships them, so the run exercises the Uploader's
// and the Tagger's real requests against the real access proxy.
const UPLOADER_PORT = Number(process.env.E2E_UPLOADER_PORT ?? 5413)
const TAGGER_PORT = Number(process.env.E2E_TAGGER_PORT ?? 5414)

// Nothing here reads a `.env`: variables already set when Vite runs win over
// any file, so a developer's pinned write scope cannot narrow the built app.
const siblingEnv = { VITE_SPARCD_S3_ENDPOINT: '', VITE_SPARCD_S3_WRITE_SCOPE: '*' }

const sibling = (name: string, port: number) => ({
  command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
  cwd: `../sparcd-${name}`,
  url: `http://127.0.0.1:${port}/sparcd-exploration/${name}/`,
  env: siblingEnv,
  reuseExistingServer: false,
  timeout: 240_000,
})

export default defineConfig({
  testDir: './e2e/specs',
  // Every scenario builds on the one before it — people invited in S2 are the
  // people S5 rearranges — so the suite is one ordered story, not a fan-out.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  outputDir: './e2e/.results',
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}/sparcd-exploration/admin/`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Phoenix',
    locale: 'en-US',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      // The built bundle, not the dev server: the join page's relative links and
      // the app base path are only right once Vite has emitted them.
      // `--host 127.0.0.1`, not vite's default: left to itself it binds `::1`
      // only, and the browser and the wait below both dial the v4 loopback.
      command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
      url: `http://127.0.0.1:${PREVIEW_PORT}/sparcd-exploration/admin/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    sibling('uploader', UPLOADER_PORT),
    sibling('tagger', TAGGER_PORT),
  ],
})
