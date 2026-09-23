import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium, expect } from '@playwright/test';

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
  // Marimo's WASM renderer renders the supplied labels visually, but omits them
  // from the exported DOM's accessible tree. Scope to the native form around
  // Connect and assert its control shape before selecting its controls.
  const sidebar = page.locator('aside.app-sidebar');
  const connectionForm = sidebar.getByRole('button', { name: 'Connect', exact: true }).locator('xpath=ancestor::form');
  const textFields = connectionForm.locator('input[type="text"]');
  const checkboxes = connectionForm.getByRole('checkbox');
  const endpoint = textFields.nth(0);
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
  await assert.equal(await textFields.count(), 2, 'the connection form has endpoint and access-key fields');
  await assert.equal(await checkboxes.count(), 2, 'the connection form has HTTPS and remember controls');
  await expect(textFields.nth(0)).toHaveValue('shared.example', { timeout: wasmStartupTimeout });
  await expect(textFields.nth(1)).toHaveValue('shared-access', { timeout: wasmStartupTimeout });
  await assert.equal(await checkboxes.nth(0).isChecked(), true);
  await connectionForm.locator('input[type="password"]').fill('never-stored');
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
  await checkboxes.nth(1).uncheck();
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
