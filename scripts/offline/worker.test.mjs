import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto, createHash } from 'node:crypto';
const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const path = '/sparcd-exploration/uploader/index.html';
const release = { version: 'new', assets: [{ url: path, hash: createHash('sha256').update('shell').digest('hex') }] };
function harness({ fail = false, bad = false, base = '/sparcd-exploration/' } = {}) {
  const rows = new Map([['sparcd-apps-old', new Map([['old.html', 'old shell']])]]);
  const listeners = {};
  const cache = name => ({ match: async key => rows.get(name)?.has(key) ? new Response(rows.get(name).get(key)) : undefined, put: async (key, response) => rows.get(name).set(key, await response.text()) });
  const caches = { open: async name => { if (!rows.has(name)) rows.set(name, new Map()); return cache(name); }, keys: async () => [...rows.keys()], delete: async name => rows.delete(name) };
  const calls = [];
  const self = { location: new URL(`https://app.test${base}offline-worker.js`), addEventListener: (key, callback) => { listeners[key] = callback; }, clients: { claim: async () => calls.push('claim') } };
  const scopedRelease = { ...release, assets: ['uploader', 'tagger'].map(app => ({ url: `${base}${app}/index.html`, hash: release.assets[0].hash })) };
  vm.runInNewContext(`const RELEASE = ${JSON.stringify(scopedRelease)};\n${source}`, { self, caches, crypto: webcrypto, Request: class { constructor(url, options) { this.url = url; this.options = options; } }, fetch: async request => { calls.push(request); if (fail) throw new Error('network'); return new Response(bad ? 'wrong release' : 'shell'); }, URL, Uint8Array, Map, Promise, Error });
  return { rows, calls, async event(type, data = {}) { let work; listeners[type]({ ...data, waitUntil: task => { work = task; } }); if (work) await work; }, fetch(request) { let response; listeners.fetch({ request, respondWith: task => { response = task; } }); return response; } };
}
test('failed or corrupt installation leaves old cache intact and never activates', async () => {
  for (const options of [{ fail: true }, { bad: true }]) {
    const h = harness(options);
    await assert.rejects(h.event('install'));
    assert.equal(h.rows.has('sparcd-apps-new'), false);
    assert.equal(h.rows.get('sparcd-apps-old').get('old.html'), 'old shell');
    assert.equal(h.calls.includes('claim'), false);
  }
});
test('offline navigation follows the worker location for renamed repos and root deployments', async () => {
  for (const base of ['/sparcd-exploration/', '/sparcd-access-preview/', '/preview.v2+test/', '/']) {
    const h = harness({ base }); await h.event('install');
    const request = (path, mode = 'navigate') => ({ method: 'GET', url: `https://app.test${path}`, mode, headers: new Headers() });
    for (const app of ['uploader', 'tagger']) {
      for (const suffix of ['', '?flip=local-id', 'index.html', 'index.html?flip=local-id']) {
        assert.equal(await (await h.fetch(request(`${base}${app}/${suffix}`))).text(), 'shell');
      }
      assert.equal(h.fetch(request(`${base}${app}/?flip=local-id`, 'cors')), undefined);
      assert.equal(h.fetch(request(`/another-repo/${app}/`)), undefined);
    }
  }
});
test('complete release is verified, readiness detects eviction and explicit repair restores it', async () => {
  const h = harness(); await h.event('install');
  let reply;
  const status = async type => { await h.event('message', { data: { type }, ports: [{ postMessage: message => { reply = message; } }] }); return reply.ready; };
  assert.equal(await status('STATUS'), true);
  h.rows.get('sparcd-apps-new').delete(path);
  assert.equal(await status('STATUS'), false);
  assert.equal(await status('REPAIR'), true);
  await h.event('activate'); assert.equal(h.rows.has('sparcd-apps-old'), true);
});
test('only app entry routes and exact public assets are handled; S3 and private requests bypass caches', async () => {
  const h = harness(); await h.event('install');
  const request = (url, mode = 'navigate', headers = new Headers()) => ({ method: 'GET', url: `https://app.test${url}`, mode, headers });
  assert.equal(await (await h.fetch(request('/sparcd-exploration/uploader/?flip=local-id'))).text(), 'shell');
  for (const url of ['/sparcd-exploration/admin/', '/sparcd-exploration/explorer/', '/bucket/media.csv', '/sparcd-exploration/uploader/assets/missing.js']) assert.equal(h.fetch(request(url)), undefined);
  assert.equal(h.fetch(request(`${path}?X-Amz-Signature=secret`, 'cors')), undefined);
  assert.equal(h.fetch(request(path, 'cors', new Headers({ Authorization: 'secret' }))), undefined);
  assert.equal(h.fetch({ ...request(path), method: 'PUT' }), undefined);
  assert.equal(h.fetch({ ...request(path), url: 'https://storage.test/media.csv' }), undefined);
});
