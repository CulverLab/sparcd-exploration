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
const liveURL = process.env.EXPLORER_TEST_URL;
if (!liveURL) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = liveURL || `http://127.0.0.1:${server.address().port}`;
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
  async function waitForEndpointOrPolarsFailure() {
    let signalPolarsFailure;
    const polarsFailure = new Promise((resolve) => { signalPolarsFailure = resolve; });
    const onResponse = (response) => {
      if (response.status() >= 500 && /corsproxy\.marimo\.app\/.*polars.*\.whl/i.test(response.url())) {
        signalPolarsFailure();
      }
    };
    page.on('response', onResponse);
    try {
      return await Promise.race([
        endpoint.waitFor({ state: 'visible', timeout: wasmStartupTimeout })
          .then(() => ({ ready: true }), (error) => ({ error })),
        polarsFailure.then(() => ({ transientPolarsFailure: true })),
      ]);
    } finally {
      page.off('response', onResponse);
    }
  }
  let startupError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startup = await waitForEndpointOrPolarsFailure();
    if (startup.ready) {
      startupError = undefined;
      break;
    }
    startupError = startup.error ?? new Error('Polars WASM package request failed during startup.');
    // Pyodide fetches the Polars WASM wheel through marimo's CORS proxy.
    // That external endpoint occasionally returns a transient 5xx; retry
    // only that startup failure, not application or assertion failures.
    const transientPolarsFetch = startup.transientPolarsFailure || diagnostics.some((entry) =>
      /response 5\d\d: https:\/\/corsproxy\.marimo\.app\/.*polars.*\.whl/i.test(entry));
    if (!transientPolarsFetch || attempt === 3) break;
    diagnostics.length = 0;
    await page.waitForTimeout(1_000 * attempt);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  if (startupError) {
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
    throw new Error(`${startupError.message}\nWASM diagnostics:\n${diagnostics.join('\n') || '<none>'}\nSidebar controls:\n${JSON.stringify(sidebarControls)}\nPage body:\n${body}`);
  }
  await expect(endpoint).toHaveValue('shared.example', { timeout: wasmStartupTimeout });
  await expect(textFields).toHaveCount(2);
  await expect(checkboxes).toHaveCount(2);
  const remember = connectionForm.getByRole('checkbox', { name: 'Remember endpoint & access key on this device', exact: true });
  const warning = connectionForm.locator('#sparcd-remember-public-computer-warning em').filter({ visible: true });
  async function assertRememberHelp() {
    await expect(warning).toBeVisible();
    await expect(warning).toHaveCSS('font-style', 'italic');
    await remember.focus();
    await expect(remember).toBeFocused();
    await expect(remember).toHaveAccessibleDescription("(Don't set remember endpoint & access key if on a public computer)");
  }
  await assertRememberHelp();
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
  await assertRememberHelp();
  await remember.uncheck();
  await page.getByRole('button', { name: 'Connect' }).click();
  try {
    await page.waitForFunction(() => localStorage.getItem('sparcd-connection') === null, undefined, { timeout: 10_000 });
  } catch (error) {
    const stored = await page.evaluate(() => localStorage.getItem('sparcd-connection'));
    throw new Error(`${error.message}\nRemembered record after unchecked submit: ${stored}\nWASM diagnostics:\n${diagnostics.join('\n') || '<none>'}`);
  }
  await assertRememberHelp();
  console.log('Remembered Explorer connection and accessible warning WASM check passed.');
  await endpoint.fill('https:///shared.example');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText("The Endpoint doesn't look right.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Use exactly two slashes after “https:”.')).toBeVisible();
  console.log('Invalid endpoint WASM check passed.');
} finally {
  await browser.close();
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
