// Assemble one immutable release from both production builds. Never cache S3.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const assets = [];
async function walk(app, path = '') {
  const dir = new URL(`apps/sparcd-${app}/dist/${path}`, root);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = path + entry.name;
    if (entry.isDirectory()) await walk(app, relative + '/');
    else if (!['offline-worker.js', 'offline-release.json'].includes(relative)) {
      const bytes = await readFile(new URL(entry.name, dir));
      assets.push({ url: `${process.env.PAGES_ROOT ?? '/sparcd-exploration/'}${app}/${relative}`, hash: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await walk('uploader');
await walk('tagger');
assets.sort((a, b) => a.url.localeCompare(b.url));
const template = await readFile(new URL('offline/worker.js', import.meta.url), 'utf8');
const version = createHash('sha256').update(JSON.stringify(assets)).update(template).digest('hex').slice(0, 20);
const manifest = { version, assets };
await writeFile(new URL('apps/sparcd-uploader/dist/offline-worker.js', root), `const RELEASE = ${JSON.stringify(manifest)};\n${template}`);
await writeFile(new URL('apps/sparcd-uploader/dist/offline-release.json', root), JSON.stringify(manifest));
console.log(`Offline release ${version}: ${assets.length} verified assets (${fileURLToPath(root)})`);
