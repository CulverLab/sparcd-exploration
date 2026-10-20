// Test-only server: serve unmodified production builds at their deployed paths.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const roots = new Map([
  ['/sparcd-exploration/uploader/', resolve(appRoot, 'dist')],
  ['/sparcd-exploration/tagger/', resolve(appRoot, '../sparcd-tagger/dist')],
]);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json',
};

export function productionServer(builds = roots) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      // A deliberately uncached network probe, not an app shell or mock asset.
      if (path === '/__offline-harness/probe.html' || path === '/sparcd-exploration/__offline-harness/probe.html') {
        res.setHeader('Content-Type', mime['.html']);
        res.end(req.method === 'HEAD' ? undefined : '<!doctype html><title>Network probe</title>');
        return;
      }
      if (path === '/sparcd-exploration/offline-worker.js') {
        const bytes = await readFile(resolve(builds.get('/sparcd-exploration/uploader/'), 'offline-worker.js'));
        res.setHeader('Content-Type', mime['.js']);
        res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      const entry = [...builds].find(([prefix]) => path.startsWith(prefix));
      if (!entry || path.includes('\0')) { res.writeHead(404).end(); return; }
      const [prefix, root] = entry;
      const relative = path.slice(prefix.length) || 'index.html';
      const file = resolve(root, relative);
      if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
      if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      const bytes = await readFile(file);
      res.setHeader('Content-Length', bytes.length);
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      res.writeHead(error instanceof URIError ? 400 : error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const root of roots.values()) await stat(resolve(root, 'index.html'));
  const port = Number(process.env.PRODUCTION_TEST_PORT ?? 5335);
  const server = productionServer();
  server.listen(port, '127.0.0.1', () => console.log(`Production test server: ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
