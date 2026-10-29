/* RELEASE is injected by build-offline.mjs. Keep this worker data-free. */
const cacheName = `sparcd-apps-${RELEASE.version}`;
const allowed = new Map(RELEASE.assets.map(asset => [asset.url, asset.hash]));
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
async function complete(cache) {
  for (const asset of RELEASE.assets) {
    const response = await cache.match(asset.url);
    if (!response || await digest(await response.arrayBuffer()) !== asset.hash) return false;
  }
  return true;
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(cacheName);
  try {
    for (const asset of RELEASE.assets) {
      const response = await fetch(new Request(asset.url, { cache: 'reload', credentials: 'omit' }));
      if (!response.ok || await digest(await response.clone().arrayBuffer()) !== asset.hash) throw new Error(`Incomplete offline release: ${asset.url}`);
      await cache.put(asset.url, response);
    }
    if (!await complete(cache)) throw new Error('Offline verification failed');
  } catch (error) { await caches.delete(cacheName); throw error; }
  // No skipWaiting: an update cannot replace a running client's release.
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Default activation waits until every client of the preceding worker closes.
  // Retain its cache too; only older, unused releases are collected here.
  const releases = (await caches.keys()).filter(name => name.startsWith('sparcd-apps-') && name !== cacheName);
  await Promise.all(releases.slice(0, -1).map(name => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data?.type === 'STATUS' || event.data?.type === 'REPAIR') event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    if (event.data.type === 'REPAIR') {
      try { for (const asset of RELEASE.assets) {
        const stored = await cache.match(asset.url);
        if (stored && await digest(await stored.arrayBuffer()) === asset.hash) continue;
        const fresh = await fetch(new Request(asset.url, { cache: 'reload', credentials: 'omit' }));
        if (!fresh.ok || await digest(await fresh.clone().arrayBuffer()) !== asset.hash) throw new Error('Repair failed');
        await cache.put(asset.url, fresh);
      } } catch { /* Reply with verified readiness, never partial success. */ }
    }
    event.ports[0]?.postMessage({ version: RELEASE.version, ready: await complete(cache) });
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Authorization')) return;
  // Navigation queries carry only local batch/return IDs; never store the URL.
  const entry = /^\/sparcd-exploration\/(uploader|tagger)\/(?:index\.html)?$/.exec(url.pathname);
  const path = request.mode === 'navigate' && entry ? `/sparcd-exploration/${entry[1]}/index.html` : url.pathname;
  if (!allowed.has(path) || (url.search && request.mode !== 'navigate')) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const response = await cache.match(path);
    if (response) return response;
    // Repair an evicted asset only with this release's exact bytes.
    const fresh = await fetch(new Request(path, { credentials: 'omit', cache: 'reload' }));
    if (!fresh.ok || await digest(await fresh.clone().arrayBuffer()) !== allowed.get(path)) throw new Error('Required offline asset unavailable');
    await cache.put(path, fresh.clone());
    return fresh;
  })());
});
// Older release caches deliberately remain: a suspended tab can still need its
// hashed chunks. Cache management never touches IndexedDB or prepared batches.
