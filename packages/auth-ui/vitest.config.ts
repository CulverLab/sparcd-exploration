import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // No Playwright/BDD suite anywhere in this monorepo can load a page over
    // HTTPS (every app's dev server is plain http://localhost), so the
    // mixed-content warning's "page is loaded over HTTPS" branch can only be
    // covered here, by starting jsdom's document at an https:// URL.
    environmentOptions: {
      jsdom: { url: 'https://example.com' },
    },
  },
});
