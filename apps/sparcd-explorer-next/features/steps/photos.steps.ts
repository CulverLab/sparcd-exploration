// The Photos grid, the photo panel and the Charts view.

import type { Locator, Page } from '@playwright/test';
import { ALPHA, ALPHA_UPLOADS, BRAVO, CHARLIE, addUpload, bucketOf, putCollection, uploadPrefix, type Upload } from './support/data';
import { Given, Then, When, expect, tableRows, viewButton, type Scratch } from './support/world';

// --- Grid ------------------------------------------------------------------------

const tiles = (page: Page) => page.locator('#table .gallery .tile');
/** The tile whose caption shows this date and time. */
const tileAt = (page: Page, time: string) => tiles(page).filter({ has: page.locator('.cap span', { hasText: time }) });

When('I show the Photos grid', async ({ page }) => {
  await viewButton(page, 'Photos').click();
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Grid' }).click();
});

Given('the server refuses ranged reads', async ({ s3 }) => {
  s3.refuseRanges = true;
});

Given(/^a collection "(.*)" with (\d+) photos( and a video at the end)?$/, async ({ s3 }, name: string, count: string, video?: string) => {
  const n = Number(count);
  const uploads: Upload[] = Array.from({ length: 4 }, (_, u) => ({
    stamp: `2024.0${u + 1}.01.10.00.00_fielduser`,
    deployment: { id: `EW0${u + 1}`, name: `Wash ${u + 1}`, lat: 0.8 + u * 0.05, lon: -150.6, elevation: 700 },
    photos: Array.from({ length: n / 4 }, (_, i) => ({
      file: `IMG${String(3000 + u * 1000 + i).padStart(4, '0')}.JPG`,
      time: `2024-0${u + 1}-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00`,
      species: i % 3 ? [{ sci: 'Lynx rufus', common: 'Bobcat' }] : undefined,
    })),
  }));
  // The oldest, so last in the grid's newest-first order.
  if (video) uploads[0].photos.push({ file: 'CLIP9999.WEBM', time: '2023-12-31T23:00:00', mime: 'video/webm' });
  putCollection(s3, { name, uuid: 'eeeeeeee-0000-4000-8000-000000000005' }, uploads);
});

/** Every tile's thumbnail colour at its centre, with the time its caption shows. */
const tileColors = (page: Page) =>
  tiles(page).evaluateAll((all) =>
    all.map((tile) => {
      const img = tile.querySelector('img')!;
      const canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 120 });
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 160, 120);
      const [r, g, b] = ctx.getImageData(80, 60, 1, 1).data;
      return { time: tile.querySelector('.cap span')!.textContent!, rgb: [r, g, b] };
    }),
  );

async function expectOwnThumbnails(page: Page, s3: { thumbColors: Map<string, number[]> }) {
  await expect.poll(async () => tiles(page).evaluateAll((all) => all.every((t) => t.getAttribute('data-thumb') === 'embedded'))).toBe(true);
  const shown = await tileColors(page);
  expect(shown.length).toBeGreaterThan(0);
  for (const { time, rgb } of shown) {
    const want = s3.thumbColors.get(time);
    expect(want, `thumbnail for ${time}`).toBeDefined();
    const off = Math.max(...rgb.map((v, i) => Math.abs(v - want![i])));
    expect(off, `tile ${time} shows ${rgb}, its own thumbnail is ${want}`).toBeLessThan(10);
  }
}

Then(/^the (first|last) tile shows its embedded thumbnail$/, async ({ page }, which: string) => {
  const tile = which === 'first' ? tiles(page).first() : tiles(page).last();
  await expect(tile).toHaveAttribute('data-thumb', 'embedded');
});

Then('fewer than {int} of the {int} photos have been read', async ({ s3 }, most: number, all: number) => {
  const read = new Set(s3.gets.filter((g) => g.key.endsWith('.JPG')).map((g) => g.key));
  expect(read.size).toBeGreaterThan(0);
  expect(read.size).toBeLessThan(most);
  expect(most).toBeLessThan(all);
});

When('I scroll to the end of the grid', async ({ page }) => {
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
});

Then('the grid shows {int} photos', async ({ page }, n: number) => {
  await expect(tiles(page)).toHaveCount(n);
  await expect(page.locator('#table .tbl-foot')).toHaveText(`All ${n} shown`);
});

Then('every tile shows its own embedded thumbnail', async ({ page, s3 }) => {
  await expectOwnThumbnails(page, s3);
  const drawn = await tiles(page)
    .locator('img')
    .evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src.startsWith('blob:') && (img as HTMLImageElement).naturalWidth));
  expect(drawn.every((w) => w === 160)).toBe(true);
});

Given('some thumbnails are slow to arrive', async ({ s3 }) => {
  // Every third photo answers late and every fifth later still, so answers come back out of order.
  s3.bucketKeys()
    .filter((key) => key.endsWith('.JPG'))
    .forEach((key, i) => {
      if (i % 5 === 0) s3.delays.set(key, 900);
      else if (i % 3 === 0) s3.delays.set(key, 400);
    });
});

When('I scroll quickly down the grid and partway back', async ({ page }) => {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (const at of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.45, 0.35, 0.25]) {
    await page.evaluate((y) => scrollTo(0, y), Math.round(height * at));
    await page.waitForTimeout(70);
  }
});

Then('every tile on screen shows its own thumbnail', async ({ page, s3 }) => {
  await expectOwnThumbnails(page, s3);
});

Then('each thumbnail came from a ranged read of the first 66,000 bytes', async ({ s3 }) => {
  const images = s3.gets.filter((g) => /\.JPG$/.test(g.key));
  expect(images.length).toBeGreaterThan(0);
  expect(images.every((g) => g.range === 'bytes=0-65999')).toBe(true);
});

Then(
  'the tile taken at {string} reads {string} at {string}',
  async ({ page }, time: string, names: string, id: string) => {
    await expect(tileAt(page, time).locator('.cap')).toHaveText([`${names}${time}${id}`]);
    await expect(tileAt(page, time)).toHaveAccessibleName(`${names}, ${time}`);
  },
);

Then('every tile reads {string}', async ({ page }, names: string) => {
  for (const text of await tiles(page).locator('.cap b').allInnerTexts()) expect(text).toBe(names);
});

Then('the tile taken at {string} shows its embedded thumbnail', async ({ page }, time: string) => {
  await expect(tileAt(page, time)).toHaveAttribute('data-thumb', 'embedded');
  await expect(tileAt(page, time).locator('img')).toHaveAttribute('src', /^blob:/);
});

Then('the tile taken at {string} shows the original photo', async ({ page }, time: string) => {
  await expect(tileAt(page, time)).toHaveAttribute('data-thumb', 'original');
  const img = tileAt(page, time).locator('img');
  await expect(img).toHaveAttribute('src', /X-Amz-Signature=/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(640);
});

const showsFrame = async (tile: Locator) => {
  await expect(tile).toHaveAttribute('data-thumb', 'frame');
  const video = tile.locator('.frame video');
  await expect(video).toHaveAttribute('src', /X-Amz-Signature=.*#t=0\.1$/);
  expect(await video.evaluate((v) => [(v as HTMLVideoElement).muted, (v as HTMLVideoElement).readyState >= 2])).toEqual([true, true]);
  await expect(tile.locator('.play')).toHaveText('Video');
  await expect(tile).toHaveAccessibleName(/, video$/);
};

Then("the tile taken at {string} shows the video's first frame with a play badge", async ({ page }, time: string) => {
  await showsFrame(tileAt(page, time));
});

Then("the last tile shows the video's first frame", async ({ page }) => {
  await showsFrame(tiles(page).last());
});

Then('the tile taken at {string} is a plain video tile with a play badge', async ({ page }, time: string) => {
  const tile = tileAt(page, time);
  await expect(tile).toHaveAttribute('data-thumb', 'video');
  await expect(tile.locator('video')).toHaveCount(0);
  await expect(tile.locator('.play')).toHaveText('Video');
});

Then('the video file was never read', async ({ s3 }) => {
  expect(s3.gets.filter((g) => g.key.endsWith('.WEBM'))).toEqual([]);
});

Then('the video file has been read', async ({ s3 }) => {
  expect(s3.gets.filter((g) => g.key.endsWith('.WEBM')).length).toBeGreaterThan(0);
});

// --- The photo panel ------------------------------------------------------------------

const panel = (page: Page) => page.getByRole('dialog');
const field = (page: Page, name: string) => panel(page).locator(`[data-field="${name}"] dd`);

When('the originals are slow to arrive', async ({ page, s3 }) => {
  // Every thumbnail is in by now; from here on a full photo takes a while.
  await expect.poll(async () => tiles(page).evaluateAll((all) => all.every((t) => t.getAttribute('data-thumb') === 'embedded'))).toBe(true);
  for (const bucket of s3.buckets) for (const key of s3.keys(bucket)) if (key.endsWith('.JPG')) s3.delays.set(key, 1500);
});

When('I note where the page is', async ({ page, scratch }) => {
  await page.evaluate(() => scrollTo(0, 420));
  scratch.scroll = await page.evaluate(() => scrollY);
});

Then('the page has not moved', async ({ page, scratch }) => {
  expect(await page.evaluate(() => scrollY)).toBe((scratch as Scratch).scroll);
});

When('I open the photo taken at {string}', async ({ page }, time: string) => {
  await tileAt(page, time).click();
  await expect(panel(page)).toBeVisible();
});

When('I open the row taken at {string} from the keyboard', async ({ page }, time: string) => {
  const row = tableRows(page).filter({ has: page.locator('td', { hasText: time }) });
  await row.getByRole('button', { name: 'View' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
});

Then('the panel is titled {string} with {string}', async ({ page }, title: string, sci: string) => {
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(title);
  await expect(panel(page).locator('.sci')).toHaveText(sci);
});

Then('the panel reads {string} {string}', async ({ page }, name: string, value: string) => {
  await expect(field(page, name)).toHaveText(value);
});

Then('the panel says {string}', async ({ page }, text: string) => {
  await expect(panel(page).locator('.detail-nav .rowcount')).toHaveText(text);
});

Then('the panel shows the thumbnail while the original loads', async ({ page }) => {
  await expect(panel(page).locator('img.under')).toHaveAttribute('src', /^blob:/);
  await expect(panel(page).locator('img.full.on')).toHaveCount(0);
});

Then('the original replaces the thumbnail', async ({ page }) => {
  const full = panel(page).locator('img.full');
  await expect(full).toHaveAttribute('src', /X-Amz-Signature=/);
  await expect(full).toHaveClass(/\bon\b/);
  expect(await full.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(640);
});

Then('"Open full size" opens the original in a new tab', async ({ page }) => {
  const link = panel(page).getByRole('link', { name: 'Open full size' });
  await expect(link).toHaveAttribute('href', /X-Amz-Signature=/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  const path = (url: string | null) => new URL(url!, page.url()).pathname;
  expect(path(await link.getAttribute('href'))).toBe(path(await panel(page).locator('img.full').getAttribute('src')));
});

Then('the panel shows the original, read once in full', async ({ page, s3 }) => {
  const full = panel(page).locator('img.full');
  await expect(full).toHaveClass(/\bon\b/);
  expect(await full.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(640);
  await expect(panel(page).locator('img.under')).toHaveCount(0);
  const key = decodeURIComponent(new URL((await full.getAttribute('src'))!).pathname).split('/').slice(2).join('/');
  expect(s3.gets.filter((g) => g.key === key && g.range === null)).toHaveLength(1);
});

Then('the panel plays the video {string}', async ({ page }, file: string) => {
  const video = panel(page).locator('video');
  await expect(video).toHaveAttribute('src', new RegExp(`${file}\\?.*X-Amz-Signature=`));
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('preload', 'metadata');
  await expect(panel(page).locator('.play')).toHaveText('Video');
  // A real clip: its metadata loads and, once started, time moves on.
  await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((v) => Math.round((v as HTMLVideoElement).duration))).toBe(2);
  await video.evaluate((v) => {
    const el = v as HTMLVideoElement;
    el.muted = true;
    return el.play();
  });
  await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime), { timeout: 5000 }).toBeGreaterThan(0.3);
});

When('I press the {string} key', async ({ page }, key: string) => {
  await page.keyboard.press(key);
});

Then('the photo panel is closed', async ({ page }) => {
  await expect(panel(page)).toHaveCount(0);
});

Then('focus is back on the tile taken at {string}', async ({ page }, time: string) => {
  await expect(tileAt(page, time)).toBeFocused();
});

Then('focus is back on the {string} button of the row taken at {string}', async ({ page }, label: string, time: string) => {
  const row = tableRows(page).filter({ has: page.locator('td', { hasText: time }) });
  await expect(row.getByRole('button', { name: label })).toBeFocused();
});

// --- Charts --------------------------------------------------------------------------

const chart = (page: Page, which: string): Locator =>
  page.getByRole('group', { name: { species: 'Detections by species', hour: 'Detections by hour of day', month: 'Detections per month' }[which]! });
const bar = (page: Page, label: string, which: string): Locator =>
  chart(page, which).getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}[:,] `) });

When('I show the Charts', async ({ page }) => {
  await viewButton(page, 'Charts').click();
});

Then(
  'the species chart reads {string}, {string}, {string} and {string}',
  async ({ page }, a: string, b: string, c: string, d: string) => {
    await expect
      .poll(() =>
        chart(page, 'species')
          .getByRole('button')
          .evaluateAll((bars) => bars.map((g) => g.getAttribute('aria-label')!.replace(/: (\d+) detections?$/, ' $1'))),
      )
      .toEqual([a, b, c, d]);
  },
);

Then('the hour chart has 24 bars with the night shaded from 19:00 to 06:00', async ({ page }) => {
  const hours = chart(page, 'hour');
  await expect(hours.getByRole('button')).toHaveCount(24);
  const boxes = (rects: Element[]) =>
    rects.map((r) => {
      const box = (r as SVGRectElement).getBBox();
      return { x: box.x, width: box.width };
    });
  const night = await hours.locator('rect.night').evaluateAll(boxes);
  const bars = await hours.locator('g.row rect.hit').evaluateAll(boxes);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  expect(night).toHaveLength(2);
  expect(near(night[0].x, bars[0].x) && near(night[0].x + night[0].width, bars[6].x)).toBe(true);
  expect(near(night[1].x, bars[19].x) && near(night[1].x + night[1].width, bars[23].x + bars[23].width)).toBe(true);
});

Then('the hour chart counts {int} detections at {string}', async ({ page }, n: number, hour: string) => {
  await expect(bar(page, hour, 'hour')).toHaveAccessibleName(`${hour}, ${n} detections`);
});

Then(
  'the month chart is labelled with the years {string}, {string} and {string}',
  async ({ page }, a: string, b: string, c: string) => {
    await expect(chart(page, 'month').locator('text.yearlab')).toHaveText([a, b, c]);
  },
);

Then('the month chart counts {int} detections in {string}', async ({ page }, n: number, month: string) => {
  await expect(bar(page, month, 'month')).toHaveAccessibleName(`${month}, ${n} detections`);
});

When(/^I click the "(.*)" bar in the (species|hour|month) chart$/, async ({ page }, label: string, which: string) => {
  await bar(page, label, which).locator('rect.bar').click({ force: true });
});

When(/^I press (Enter|Space) on the "(.*)" bar in the (species|hour|month) chart$/, async ({ page }, key: string, label: string, which: string) => {
  await bar(page, label, which).focus();
  await page.keyboard.press(key === 'Space' ? ' ' : key);
});

Then(/^the "(.*)" bar in the (species|hour|month) chart is (highlighted|dimmed)$/, async ({ page }, label: string, which: string, state: string) => {
  const g = bar(page, label, which);
  await expect(g).toHaveAttribute('data-state', state === 'highlighted' ? 'on' : 'dim');
  if (state === 'highlighted') await expect(g).toHaveAttribute('aria-pressed', 'true');
});

Then(/^no bar in the (species|hour|month) chart is highlighted$/, async ({ page }, which: string) => {
  await expect(chart(page, which).locator('[data-state]')).toHaveCount(0);
});

// --- Files that aren't on the server ---------------------------------------------

const COLLECTIONS: Record<string, { uuid: string }> = { 'Alpha Basin': ALPHA, 'Bravo Flats': BRAVO, 'Charlie Pond': CHARLIE };

Given(/^"(.*)" has an upload listing (\d+) photos whose files aren't on the server$/, async ({ s3, scratch }, name: string, n: string) => {
  const c = COLLECTIONS[name];
  // Rows an older uploader wrote before the files arrived: no time, no species.
  const upload: Upload = {
    stamp: '2025.06.01.08.00.00_fielduser',
    deployment: { id: 'AB02', name: 'Cedar Draw', lat: 0.53, lon: -150.15, elevation: 1500 },
    photos: Array.from({ length: Number(n) }, (_, i) => ({ file: `STALE${i}.JPG`, time: '' })),
  };
  addUpload(s3, c, upload);
  const keys = upload.photos.map((p) => `${uploadPrefix(c, upload.stamp)}${p.file}`);
  for (const key of keys) s3.delete(bucketOf(c), key);
  scratch.missing = keys;
});

Then('{int} tiles say {string}', async ({ page }, n: number, text: string) => {
  await expect(tiles(page).filter({ hasText: text })).toHaveCount(n);
  await expect(page.locator('#table .gallery .tile[data-thumb="missing"]')).toHaveCount(n);
});

Then('the server was never asked for those files', async ({ s3, scratch }) => {
  const keys = scratch.missing as string[];
  expect(s3.gets.filter((g) => keys.includes(g.key))).toEqual([]);
});

Given('the photo files have been checked', async ({ page }) => {
  await expect(page.locator('.updated')).toHaveText(/^Updated/);
  await expect(page.locator('.updated')).not.toContainText('Checking photo files');
});

When('the file {string} of {string} is removed from the server', async ({ s3 }, file: string, name: string) => {
  const c = COLLECTIONS[name] as typeof ALPHA;
  const upload = ALPHA_UPLOADS.find((u) => u.photos.some((p) => p.file === file))!;
  s3.delete(bucketOf(c), `${uploadPrefix(c, upload.stamp)}${file}`);
});

Then('the tile taken at {string} says {string}', async ({ page }, time: string, text: string) => {
  await expect(tileAt(page, time)).toHaveAttribute('data-thumb', 'missing');
  await expect(tileAt(page, time).locator('.noprev')).toHaveText(text);
});

Then("the panel says the file isn't on the server, naming {string}", async ({ page }, file: string) => {
  const gone = panel(page).locator('.detail-img .gone');
  await expect(gone).toContainText("This photo's file isn't on the server");
  await expect(gone.locator('code')).toHaveText(new RegExp(`/${file.replace('.', '\\.')}$`));
  await expect(panel(page).locator('.detail-img img')).toHaveCount(0);
});

Then('the server was asked for {string} once', async ({ s3 }, file: string) => {
  expect(s3.gets.filter((g) => g.key.endsWith(`/${file}`))).toHaveLength(1);
});
