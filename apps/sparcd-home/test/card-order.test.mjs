import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const homePage = fileURLToPath(new URL('../index.html', import.meta.url));

test('lists focusable app cards in the Uploader, Tagger, Explorer order', async () => {
  const html = await readFile(homePage, 'utf8');
  const tools = html.match(/<nav class="deck" aria-label="Tools">([\s\S]*?)<\/nav>/)?.[1];

  assert.ok(tools, 'expected the Tools navigation');
  assert.deepEqual(
    [...tools.matchAll(/<a class="card reveal" href="([^"]+)">([\s\S]*?)<\/a>/g)].map(([, href, card]) => ({
      href,
      heading: card.match(/<h2>([^<]+)<\/h2>/)?.[1],
    })),
    [
      { href: 'uploader/', heading: 'Uploader' },
      { href: 'tagger/', heading: 'Tagger' },
      { href: 'explorer/', heading: 'Explorer' },
    ],
  );
});
