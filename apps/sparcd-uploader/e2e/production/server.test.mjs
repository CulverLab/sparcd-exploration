import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productionServer } from './server.mjs';

test('production server parses URLs, preserves MIME types, and refuses shell fallbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sparcd-static-'));
  const server = productionServer(new Map([['/sparcd-exploration/uploader/', root]]));
  try {
    await Promise.all([['index.html', '<title>uploader</title>'], ['worker.js', 'postMessage(1)'], ['hash.wasm', 'wasm'], ['main.css', 'body{}']].map(([path, text]) => writeFile(join(root, path), text)));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [path, type] of [['?flip=id', 'text/html'], ['worker.js?v=1', 'text/javascript'], ['hash.wasm', 'application/wasm'], ['main.css', 'text/css']]) {
      const response = await fetch(`${origin}/sparcd-exploration/uploader/${path}`);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').startsWith(type));
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const path of ['/sparcd-exploration/admin/', '/sparcd-exploration/uploader/missing.js', '/sparcd-exploration/uploader/%2e%2e%2findex.html', '/sparcd-exploration/uploader/%00']) {
      assert.equal((await fetch(origin + path)).status, 404);
    }
    assert.equal((await fetch(origin + '/sparcd-exploration/uploader/%ZZ')).status, 400);
    const probe = await fetch(origin + '/sparcd-exploration/__offline-harness/probe.html');
    assert.equal(probe.status, 200);
    assert.match(await probe.text(), /Network probe/);
    const head = await fetch(origin + '/sparcd-exploration/uploader/worker.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(origin + '/sparcd-exploration/uploader/', { method: 'POST' })).status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
