// The Uploader hand-off. The record lives in a database both apps share when
// they are served from the same origin, so these steps seed and read it
// directly — that IS the interface between the two tools.

import type { Page } from '@playwright/test';
import {
  Given,
  When,
  Then,
  expect,
  APP_URL,
  gridCell,
  speciesApply,
  speciesFilter,
} from './support/world';

const BATCH_ID = 'handed-over-batch';
const RETURN_URL = '/sparcd-exploration/uploader/?flip=' + BATCH_ID;
const FILES = ['IMG001.JPG', 'IMG002.JPG', 'IMG003.JPG'];

type FlipRow = {
  id: string;
  tags: Record<string, { scientificName: string; commonName: string; count: number }[]>;
  taggerUser?: string;
};

/** Open the tagger on a batch id. The first visit also creates the shared
 *  database, which is what lets the seeding below open it by name. */
async function openBatch(page: Page, id: string): Promise<void> {
  await page.goto(`${APP_URL}?batch=${id}`);
}

/** Write the record the Uploader would have written. Thumbnails are real bytes
 *  so the grid has something to paint; no folder handle rides along, which is
 *  the "thumbnails only" case a reselect-required batch lands in. */
async function seedBatch(page: Page): Promise<void> {
  await page.evaluate(
    async ({ id, returnUrl, files }: { id: string; returnUrl: string; files: string[] }) => {
      // A 1×1 GIF — the smallest thing a browser will decode.
      const gif = Uint8Array.from(
        atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
        (c) => c.charCodeAt(0),
      );
      const open = indexedDB.open('sparcd-flip');
      const db: IDBDatabase = await new Promise((resolve) => {
        open.onsuccess = () => resolve(open.result);
      });
      await new Promise<void>((resolve) => {
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').put({
          id,
          v: 1,
          createdAt: new Date().toISOString(),
          returnUrl,
          // Everything the Uploader's Inspect pass would have established, so
          // the seed stays a faithful stand-in for a real hand-off.
          files: files.map((fileName, i) => ({
            relPath: `SDCARD/${fileName}`,
            fileName,
            size: 100 + i,
            sha256: `sha-${i}`,
            mediaKind: 'image',
            exifTimestamp: `2026-07-01T12:0${i}:00`,
            mimeType: 'image/jpeg',
            exifCamera: 'RECONYX HP2X',
            gps: { lat: 31.5, lon: -110.2 },
            width: 2048,
            height: 1536,
            thumb: new Blob([gif], { type: 'image/gif' }),
          })),
          tags: {},
        });
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { id: BATCH_ID, returnUrl: RETURN_URL, files: FILES },
  );
}

async function readBatch(page: Page): Promise<FlipRow | undefined> {
  return page.evaluate(async (id: string) => {
    const open = indexedDB.open('sparcd-flip');
    const db: IDBDatabase = await new Promise((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    const row = await new Promise<FlipRow | undefined>((resolve) => {
      const req = db.transaction('records', 'readonly').objectStore('records').get(id);
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return row;
  }, BATCH_ID);
}

/** Rewrite part of the seeded record — stands in for whatever else on this
 *  origin could have written it. */
async function patchBatch(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const open = indexedDB.open('sparcd-flip');
      const db: IDBDatabase = await new Promise((resolve) => {
        open.onsuccess = () => resolve(open.result);
      });
      const store = db.transaction('records', 'readwrite').objectStore('records');
      const existing: Record<string, unknown> = await new Promise((resolve) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
      });
      await new Promise<void>((resolve) => {
        const req = store.put({ ...existing, ...patch });
        req.onsuccess = () => resolve();
      });
      db.close();
    },
    { id: BATCH_ID, patch },
  );
}

// The Uploader is a different app on the same origin; stand in for it so the
// Done button's navigation resolves.
async function stubUploader(page: Page): Promise<void> {
  await page.route(/\/sparcd-exploration\/uploader\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>uploader</title><body>uploader stub</body>',
    }),
  );
}

Given('the Uploader has handed over a batch of images', async ({ page }) => {
  await stubUploader(page);
  // The first visit has nothing to open, which is exactly what creates the
  // shared database the seed then writes into.
  await openBatch(page, BATCH_ID);
  await seedBatch(page);
  await openBatch(page, BATCH_ID);
  await expect(gridCell(page, 'IMG001.JPG')).toBeVisible();
});

Given('the link points at a batch that is not in this browser', async ({ page }) => {
  await openBatch(page, 'no-such-batch');
});

Given('the batch points somewhere other than the Uploader to return to', async ({ page }) => {
  await patchBatch(page, { returnUrl: 'https://elsewhere.example/landing' });
  await openBatch(page, BATCH_ID);
  await expect(gridCell(page, 'IMG001.JPG')).toBeVisible();
});

// --- opening ----------------------------------------------------------------

Then('no connection screen is shown', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Connect' })).toHaveCount(0);
  await expect(page.locator('#endpoint')).toHaveCount(0);
});

Then('the images are listed ready to tag', async ({ page }) => {
  for (const name of FILES) await expect(gridCell(page, name)).toBeVisible();
});

Then(
  'the header says it is a local batch from the Uploader, with the file count',
  async ({ page }) => {
    await expect(page.getByText(/Local batch · 3 files · from Uploader/)).toBeVisible();
  },
);

Then('it offers "Done · back to Uploader"', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Done · back to Uploader' })).toBeVisible();
});

Then('there is no Browse, History, Sync or Snapshots', async ({ page }) => {
  await expect(page.locator('nav[aria-label="Sections"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sync…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Snapshots…' })).toHaveCount(0);
});

Then('the species panel lists species to apply', async ({ page }) => {
  await expect(speciesFilter(page)).toBeVisible();
  await expect(speciesApply(page, 'Canis latrans')).toBeVisible();
  await expect(speciesApply(page, 'Puma concolor')).toBeVisible();
});

// --- tagging ----------------------------------------------------------------

async function applyCoyote(page: Page): Promise<void> {
  await gridCell(page, 'IMG002.JPG').click();
  await speciesApply(page, 'Canis latrans').click();
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
}

/** The write-back is debounced on top of the drafts' own debounce; waiting for
 *  it also guarantees the local draft behind it has been written. */
async function waitForRecordedTag(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readBatch(page))?.tags['SDCARD/IMG002.JPG']?.[0]?.scientificName, {
      timeout: 5000,
    })
    .toBe('Canis latrans');
}

When('Coyote is applied to an image', async ({ page }) => {
  await applyCoyote(page);
});

Given('a species has been applied to an image', async ({ page }) => {
  await applyCoyote(page);
  await waitForRecordedTag(page);
});

Then('the batch records Coyote against that image', async ({ page }) => {
  await waitForRecordedTag(page);
});

When('"Done · back to Uploader" is chosen', async ({ page }) => {
  await page.getByRole('button', { name: 'Done · back to Uploader' }).click();
  // Not `?flip=` — a batch whose return trip was rejected lands on the bare
  // uploader instead.
  await page.waitForURL(/\/uploader\//);
});

Then('the batch carries the tag for the Uploader to read', async ({ page }) => {
  const row = await readBatch(page);
  expect(row?.tags['SDCARD/IMG002.JPG'][0].commonName).toBe('Coyote');
});

Then("the browser goes back to the Uploader carrying the batch's id", async ({ page }) => {
  expect(page.url()).toContain(RETURN_URL);
});

Then("the browser goes to this site's Uploader anyway", async ({ page }) => {
  const url = new URL(page.url());
  expect(url.host).toBe('localhost:5312');
  expect(url.pathname).toBe('/sparcd-exploration/uploader/');
});

When('the batch is opened again', async ({ page }) => {
  await openBatch(page, BATCH_ID);
  await expect(gridCell(page, 'IMG001.JPG')).toBeVisible();
});

Then('that image still carries its species', async ({ page }) => {
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});

// --- a batch that is not here ----------------------------------------------

Then('the workspace says there is no such batch', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'No such batch' })).toBeVisible();
});

Then('it explains that the two tools only share batches on the same origin', async ({ page }) => {
  await expect(page.getByText(/served from the same origin/)).toBeVisible();
});
