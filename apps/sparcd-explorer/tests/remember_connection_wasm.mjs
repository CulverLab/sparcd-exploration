import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const root = process.argv[2];
if (!root) throw new Error('Usage: node remember_connection_wasm.mjs <exported-wasm-directory>');
// A fresh GitHub Actions runner must download and install Pyodide packages before
// Marimo can render the form. Keep the interaction assertions strict, while
// allowing that one-time WASM startup to complete.
const wasmStartupTimeout = 120_000;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const path = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
  if (!path.startsWith(normalize(root))) return res.writeHead(403).end();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' };
  try { const body = await readFile(path); res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(body); } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const diagnostics = [];
  page.on('console', (message) => diagnostics.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.stack ?? error.message}`));
  page.on('requestfailed', (request) => diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => {
    if (response.status() >= 400) diagnostics.push(`response ${response.status()}: ${response.url()}`);
  });
  await page.addInitScript(() => localStorage.setItem('sparcd-connection', JSON.stringify({ endpoint: 'shared.example', accessKey: 'shared-access', secure: true, region: 'us-west-2', forcePathStyle: true })));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const endpoint = page.getByRole('textbox', { name: 'Endpoint', exact: true });
  try {
    await endpoint.waitFor({ state: 'visible', timeout: wasmStartupTimeout });
  } catch (error) {
    const artifactDirectory = join(root, 'test-results');
    await mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({ path: join(artifactDirectory, 'remember-connection-startup-failure.png'), fullPage: true });
    const body = await page.locator('body').innerText().catch(() => '<body unavailable>');
    const sidebarControls = await page.locator('aside.app-sidebar input, aside.app-sidebar [role="checkbox"]').evaluateAll((controls) => controls.map((control) => ({
      tag: control.tagName,
      type: control.getAttribute('type'),
      role: control.getAttribute('role'),
      ariaLabel: control.getAttribute('aria-label'),
      value: control.getAttribute('value'),
      visible: Boolean(control.offsetWidth || control.offsetHeight || control.getClientRects().length),
    }))).catch(() => '<sidebar controls unavailable>');
    await writeFile(
      join(artifactDirectory, 'remember-connection-startup-failure.txt'),
      `WASM diagnostics:\n${diagnostics.join('\n') || '<none>'}\nSidebar controls:\n${JSON.stringify(sidebarControls)}\nPage body:\n${body}`,
    );
    throw new Error(`${error.message}\nWASM diagnostics:\n${diagnostics.join('\n') || '<none>'}\nSidebar controls:\n${JSON.stringify(sidebarControls)}\nPage body:\n${body}`);
  }
  await assert.doesNotReject(() => expectValue(endpoint, 'shared.example'));
  await assert.doesNotReject(() => expectValue(page.getByRole('textbox', { name: 'Access key', exact: true }), 'shared-access'));
  await assert.equal(await page.getByRole('checkbox', { name: 'Use HTTPS (when no scheme in endpoint)', exact: true }).isChecked(), true);
  await page.getByRole('textbox', { name: 'Secret key', exact: true }).fill('never-stored');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForFunction(() => {
    const value = JSON.parse(localStorage.getItem('sparcd-connection') || '{}');
    return value.endpoint === 'shared.example' && value.accessKey === 'shared-access';
  });
  const rememberedAfterSubmit = await page.evaluate(() => JSON.parse(localStorage.getItem('sparcd-connection')));
  await assert.deepEqual(rememberedAfterSubmit, {
    endpoint: 'shared.example',
    accessKey: 'shared-access',
    secure: true,
    region: 'us-west-2',
    forcePathStyle: true,
  });
  await page.getByRole('checkbox', { name: 'Remember endpoint & access key on this device', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Connect' }).click();
  try {
    await page.waitForFunction(() => localStorage.getItem('sparcd-connection') === null, undefined, { timeout: 10_000 });
  } catch (error) {
    const stored = await page.evaluate(() => localStorage.getItem('sparcd-connection'));
    throw new Error(`${error.message}\nRemembered record after unchecked submit: ${stored}\nWASM diagnostics:\n${diagnostics.join('\n') || '<none>'}`);
  }
  console.log('Remembered Explorer connection WASM check passed.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
async function expectValue(locator, value) { assert.equal(await locator.inputValue(), value); }
