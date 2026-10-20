import { test, expect } from '@playwright/test';

const uploader = '/sparcd-exploration/uploader/';
const tagger = '/sparcd-exploration/tagger/';

test('both production entry points and their assets use deployed paths', async ({ request }) => {
  for (const path of [uploader, `${uploader}?flip=probe`, tagger, `${tagger}?batch=probe&return=probe`]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const html = await response.text();
    expect(html).not.toContain('/@vite/client');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script.startsWith(path.split('?')[0] + 'assets/')).toBe(true);
      const asset = await request.get(`${script}?asset-query=1`);
      expect(asset.status()).toBe(200);
      expect(asset.headers()['content-type']).toContain('javascript');
    }
  }
  for (const path of ['/sparcd-exploration/admin/', '/sparcd-exploration/explorer/', `${uploader}assets/missing.js`]) {
    expect((await request.get(path)).status()).toBe(404);
  }
});

