import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const uploader = '/sparcd-exploration/uploader/';

// This test owns tracing across two browser processes; avoid runner auto-tracing.
test.use({ trace: 'off' });

test('independent Chrome restart retains profile data and really blocks network', async ({ baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), 'sparcd-offline-profile-'));
  let context: BrowserContext | undefined;
  let activeTrace: string | undefined;
  const traces: string[] = [];
  let passed = false;
  async function startTrace(name: string) {
    await context!.tracing.start({ screenshots: true, snapshots: true, sources: true });
    activeTrace = testInfo.outputPath(`${name}.zip`);
  }
  async function closeContext() {
    if (!context) return;
    const closing = context;
    context = undefined;
    try {
      if (activeTrace) {
        await closing.tracing.stop({ path: activeTrace });
        traces.push(activeTrace);
        activeTrace = undefined;
      }
    } finally {
      await closing.close();
    }
  }
  const options = { channel: 'chrome', headless: true, baseURL };
  try {
    context = await chromium.launchPersistentContext(profile, options);
    await startTrace('before-restart');
    let page = await context.newPage();
    await page.goto(uploader);
    await expect(page.getByRole('button', { name: 'Login later', exact: true })).toBeVisible();
    // Harness-owned DB only: this does not pretend the app persists a batch.
    await page.evaluate(async () => {
      (window as any).__offlineHarnessMemory = 'must-not-survive';
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('offline-harness-probe', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('checks');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('checks', 'readwrite');
          tx.objectStore('checks').put({ id: 'restart-probe', thumb: new Blob(['probe']) }, 'record');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onabort = () => { db.close(); reject(tx.error); };
        };
      });
    });
    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await page.evaluate(async () => {
      try { await fetch('/__offline-harness/probe.html?warm-block=1'); return false; }
      catch { return true; }
    })).toBe(true);
    // Finalize the first trace before closing the entire Chrome process.
    // Keep it until the whole test succeeds: a later failure needs both traces.
    await closeContext();

    // Offline from launch: no opportunity to warm app assets after restart.
    context = await chromium.launchPersistentContext(profile, { ...options, offline: true });
    await startTrace('after-restart');
    page = await context.newPage();
    await expect(page.goto(`${baseURL}/__offline-harness/probe.html?cold-block=1`)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
    await context.setOffline(false);
    await page.goto(uploader);
    expect(await page.evaluate(() => (window as any).__offlineHarnessMemory)).toBeUndefined();
    expect(await page.evaluate(async () => new Promise<string>((resolve, reject) => {
      const open = indexedDB.open('offline-harness-probe', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('checks').objectStore('checks').get('record');
        read.onerror = () => { db.close(); reject(read.error); };
        read.onsuccess = async () => {
          const record = read.result;
          db.close();
          resolve(`${record.id}:${await record.thumb.text()}`);
        };
      };
    }))).toBe('restart-probe:probe');
    await testInfo.attach('verification-boundary', {
      body: 'Verified: Chrome process restart, preserved profile/IndexedDB Blob, destroyed page memory, real offline blocking, online recovery. Not verified: app offline cold reopening, durable app batch recovery, installed PWA, or OS restart.',
      contentType: 'text/plain',
    });
    await closeContext();
    passed = testInfo.errors.length === 0;
  } finally {
    try {
      await closeContext();
    } finally {
      try {
        for (const path of traces) {
          if (passed) await rm(path, { force: true });
          else await testInfo.attach(path.endsWith('before-restart.zip') ? 'before-restart-trace' : 'after-restart-trace', { path, contentType: 'application/zip' });
        }
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  }
});

