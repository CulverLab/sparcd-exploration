import type { Page, Locator } from '@playwright/test';
import {
  Given,
  When,
  Then,
  expect,
  enterFocusView,
  focusFrame,
  gridCell,
  connect,
  selectCollection,
  sectionTab,
} from './support/world';
import { BUCKET, PREFIX_A, mediaCsv, MEDIA_A, mediaKey } from './support/data';

// --- react-zoom-pan-pinch introspection -------------------------------------

const transformContent = (root: Locator): Locator => root.locator('.react-transform-component');
const transformWrapper = (root: Locator): Locator => root.locator('.react-transform-wrapper');

type Transform = { x: number; y: number; scale: number };

async function readTransform(root: Locator): Promise<Transform> {
  const style = (await transformContent(root).first().getAttribute('style')) ?? '';
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(style);
  if (!m) return { x: 0, y: 0, scale: 1 };
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
}

/** Zoom is animated (300ms), so wait for the transform to settle between steps. */
async function settle(root: Locator): Promise<number> {
  let last = NaN;
  for (let i = 0; i < 40; i++) {
    const s = (await readTransform(root)).scale;
    if (s === last) return s;
    last = s;
    await new Promise((r) => setTimeout(r, 60));
  }
  return last;
}

async function zoomIn(root: Locator, times: number): Promise<number> {
  for (let i = 0; i < times; i++) {
    await root.getByRole('button', { name: 'Zoom in' }).click();
    await settle(root);
  }
  return settle(root);
}

/** Keep zooming until the transform stops growing — the component's own limit. */
async function zoomToLimit(root: Locator): Promise<number> {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const s = await zoomIn(root, 1);
    if (Math.abs(s - last) < 0.0005) return s;
    last = s;
  }
  return last;
}

const lightbox = (page: Page): Locator =>
  page.locator('div.fixed.inset-0').filter({ has: page.locator('button[title="Close (Esc)"]') });

// --- Background -------------------------------------------------------------

Given('an image is shown in the Focus view', async ({ page }) => {
  await enterFocusView(page);
  await expect(page.locator('.react-transform-component img')).toBeVisible();
});

// --- Zoom -------------------------------------------------------------------

// Used as both the action and the precondition ("Given the image is zoomed in").
When('the image is zoomed in', async ({ page }) => {
  await zoomIn(page.locator('body'), 4);
  expect((await readTransform(page.locator('body'))).scale).toBeGreaterThan(1);
});

Then('it can be enlarged up to six times its fitted size', async ({ page }) => {
  const scale = await zoomToLimit(page.locator('body'));
  expect(scale).toBeCloseTo(6, 1);
});

Then('detail beyond the fitted view becomes legible', async ({ page }) => {
  const pane = transformWrapper(page.locator('body')).first();
  const img = page.locator('.react-transform-component img').first();
  const paneBox = (await pane.boundingBox())!;
  const imgBox = (await img.boundingBox())!;
  // The rendered image is drawn larger than the pane that frames it, so the
  // pane is showing a magnified crop rather than the whole fitted frame.
  expect(imgBox.width).toBeGreaterThan(paneBox.width);
});

When('it is dragged', async ({ page, scratch }) => {
  await settle(page.locator('body'));
  const before = await readTransform(page.locator('body'));
  scratch.transformBefore = before;
  const pane = transformWrapper(page.locator('body')).first();
  const box = (await pane.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy - 40, { steps: 12 });
  await page.mouse.up();
  await settle(page.locator('body'));
});

Then('the visible part of the image moves with the drag', async ({ page, scratch }) => {
  const before = scratch.transformBefore as Transform;
  const after = await readTransform(page.locator('body'));
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(5);
  expect(after.scale).toBeCloseTo(before.scale, 2);
});

Then('it cannot be dragged beyond the edges of the image', async ({ page }) => {
  const pane = transformWrapper(page.locator('body')).first();
  const box = (await pane.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Shove it hard in both directions; the offsets must stay inside the bounds
  // the scaled content allows (0 …  -(scale-1) * size).
  for (const [dx, dy] of [
    [4000, 4000],
    [-8000, -8000],
  ] as const) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
    await page.mouse.up();
    await settle(page.locator('body'));
    const t = await readTransform(page.locator('body'));
    expect(t.x).toBeLessThanOrEqual(1);
    expect(t.y).toBeLessThanOrEqual(1);
    expect(t.x).toBeGreaterThanOrEqual(-(t.scale - 1) * box.width - 1);
    expect(t.y).toBeGreaterThanOrEqual(-(t.scale - 1) * box.height - 1);
  }
});

Then('on-screen zoom-in and zoom-out controls are available over the image', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
});

Then('double-clicking the image zooms in a step', async ({ page }) => {
  const before = await readTransform(page.locator('body'));
  await page.locator('.react-transform-component').first().dblclick();
  await settle(page.locator('body'));
  await expect
    .poll(async () => (await readTransform(page.locator('body'))).scale)
    .toBeGreaterThan(before.scale);
});

Then('a {string} control is offered', async ({ page }, label: string) => {
  await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible();
});

Then('using it returns the image to the fitted view', async ({ page }) => {
  await page.locator('button[title="Reset to fit"]').click();
  await expect.poll(async () => (await readTransform(page.locator('body'))).scale).toBe(1);
});

Then('the control is not shown while the image is already fitted', async ({ page }) => {
  await expect(page.locator('button[title="Reset to fit"]')).toHaveCount(0);
});

// --- Fullscreen -------------------------------------------------------------

When('the image is opened fullscreen', async ({ page }) => {
  await page.getByRole('button', { name: 'Open fullscreen' }).click();
  await expect(lightbox(page)).toBeVisible();
});

Then('it fills the window over a dimmed background', async ({ page }) => {
  const box = (await lightbox(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
  expect(box.height).toBeGreaterThanOrEqual(viewport.height - 2);
  await expect(lightbox(page)).toHaveClass(/bg-ink\/90/);
});

Then('it can be enlarged up to ten times its fitted size there', async ({ page }) => {
  const scale = await zoomToLimit(lightbox(page));
  expect(scale).toBeCloseTo(10, 1);
});

Then(
  'pressing Escape or using the close control returns to the workspace',
  async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(lightbox(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Open fullscreen' }).click();
    await expect(lightbox(page)).toBeVisible();
    await lightbox(page).getByRole('button', { name: 'Close' }).click();
    await expect(lightbox(page)).toHaveCount(0);

    // Deviation, verified: a backdrop click does NOT dismiss the fullscreen
    // view — the zoom surface fills the pane and absorbs the click.
    await page.getByRole('button', { name: 'Open fullscreen' }).click();
    await expect(lightbox(page)).toBeVisible();
    await lightbox(page).click({ position: { x: 4, y: 200 } });
    await expect(lightbox(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(lightbox(page)).toHaveCount(0);
  },
);

// --- Per-image reset --------------------------------------------------------

Given('the current image is zoomed in and panned', async ({ page }) => {
  await zoomIn(page.locator('body'), 4);
  const pane = transformWrapper(page.locator('body')).first();
  const box = (await pane.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50, { steps: 10 });
  await page.mouse.up();
  await settle(page.locator('body'));
  const t = await readTransform(page.locator('body'));
  expect(t.scale).toBeGreaterThan(1);
  expect(Math.abs(t.x) + Math.abs(t.y)).toBeGreaterThan(0);
});

When('another image is opened', async ({ page }) => {
  await page.locator('button').filter({ hasText: 'IMG002.JPG' }).first().click();
  await expect(page.locator('.react-transform-component img')).toBeVisible();
});

Then('the new image is shown fitted to the pane', async ({ page }) => {
  await expect.poll(async () => (await readTransform(page.locator('body'))).scale).toBe(1);
});

Then('no zoom or pan state carries over from the previous image', async ({ page }) => {
  const t = await readTransform(page.locator('body'));
  expect(t).toEqual({ x: 0, y: 0, scale: 1 });
});

// --- Virtualization ---------------------------------------------------------

Given('an upload with thousands of images is open', async ({ page, s3 }) => {
  const many = Array.from({ length: 3000 }, (_, i) => ({
    file: `BIG${String(i).padStart(4, '0')}.JPG`,
    timestamp: '2024-02-01T00:00:00',
    mime: 'image/jpeg',
  }));
  s3.put(BUCKET, `${PREFIX_A}media.csv`, mediaCsv(PREFIX_A, many), 'text/csv');
  s3.put(BUCKET, `${PREFIX_A}observations.csv`, '', 'text/csv');
  // The tiles presign fine; the bytes need not exist for the strip to render.
  s3.put(BUCKET, mediaKey(PREFIX_A, many[0].file), Buffer.alloc(0), 'image/png');
  await page.reload();
  await connect(page);
  await selectCollection(page);
  await page.locator('button').filter({ hasText: 'priortagger' }).filter({ hasText: 'Open →' }).click();
  await expect(page.getByText('1 / 3000')).toBeVisible();
});

When('the Overview is scrolled', async ({ page, scratch }) => {
  const strip = page.locator('div.h-full.overflow-y-auto.min-h-0.bg-panel').first();
  await strip.evaluate((el) => el.scrollBy(0, 4000));
  scratch.tileCount = await page.locator('button[title^="BIG"]').count();
});

Then('only the rows currently in view are rendered', async ({ page, scratch }) => {
  const count = scratch.tileCount as number;
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(300); // a fraction of 3,000
  await expect(page.locator('button[title^="BIG"]')).not.toHaveCount(3000);
});

Then('the keyboard-focused image is scrolled into view as focus moves', async ({ page }) => {
  await page.getByPlaceholder('Find image…').fill('BIG2500');
  await expect(page.getByText('2501 / 3000')).toBeVisible();
  const focused = page.locator('button[aria-current="true"][title^="BIG"]').first();
  await expect(focused).toBeInViewport();
});

// --- Video ------------------------------------------------------------------

Given('the focused item is a video clip', async ({ page }) => {
  await sectionTab(page, 'Tag').click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await focusFrame(page, 'VID001.MP4');
  await enterFocusViewForVideo(page);
});

async function enterFocusViewForVideo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.locator('video[controls]')).toBeVisible();
}

Then("it plays with the browser's own playback controls", async ({ page }) => {
  const video = page.locator('video[controls]');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
});

Then('the zoom, pan and fullscreen controls are not offered for it', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open fullscreen' })).toHaveCount(0);
  await expect(page.locator('.react-transform-wrapper')).toHaveCount(0);
});

Then(
  "moving to another item does not carry over the previous clip's playback position",
  async ({ page }) => {
    await page.locator('video[controls]').evaluate((v: HTMLVideoElement) => {
      v.currentTime = 1.5;
    });
    await page.locator('button').filter({ hasText: 'IMG005.JPG' }).first().click();
    await expect(page.locator('video[controls]')).toHaveCount(0);
    await page.locator('button').filter({ hasText: 'VID001.MP4' }).first().click();
    await expect(page.locator('video[controls]')).toBeVisible();
    expect(
      await page.locator('video[controls]').evaluate((v: HTMLVideoElement) => v.currentTime),
    ).toBe(0);
  },
);

// --- Display adjustments ----------------------------------------------------

const adjustToggle = (page: Page): Locator =>
  page.locator('button[title="View-only image adjustments (does not change the file)"]');

Given('the focused item is a still image', async ({ page }) => {
  await expect(page.locator('.react-transform-component img')).toBeVisible();
});

When('the adjustment panel is opened', async ({ page }) => {
  await adjustToggle(page).click();
  await expect(page.getByLabel('Brightness')).toBeVisible();
});

Then(
  'brightness, contrast, hue and saturation can each be moved across their range',
  async ({ page }) => {
    for (const label of ['Brightness', 'Contrast', 'Hue', 'Saturation']) {
      const slider = page.getByLabel(label);
      await expect(slider).toHaveAttribute('min', '0');
      await expect(slider).toHaveAttribute('max', '100');
      await slider.fill('0');
      await expect(slider).toHaveValue('0');
      await slider.fill('100');
      await expect(slider).toHaveValue('100');
      await slider.fill('70');
    }
  },
);

Then('the displayed image changes to match', async ({ page }) => {
  const style = await page.locator('.react-transform-component img').first().getAttribute('style');
  expect(style).toContain('filter');
  expect(style).toContain('brightness');
  expect(style).not.toContain('brightness(100%) contrast(100%) hue-rotate(0deg) saturate(100%)');
});

Then('a marker shows that the adjustments are no longer neutral', async ({ page }) => {
  await expect(adjustToggle(page).locator('span.bg-accent')).toBeVisible();
});

Given('the display adjustments have been changed', async ({ page }) => {
  await adjustToggle(page).click();
  await page.getByLabel('Brightness').fill('80');
  await expect(adjustToggle(page).locator('span.bg-accent')).toBeVisible();
});

Then(
  'the stored image, its identifications and its capture time are unaffected',
  async ({ page, s3 }) => {
    expect(s3.puts).toHaveLength(0);
    expect(s3.text(BUCKET, `${PREFIX_A}media.csv`)).toBe(mediaCsv(PREFIX_A, MEDIA_A));
    await expect(page.getByText(/unsaved · discard/)).toHaveCount(0);
  },
);

Then('the adjustments can be reset to neutral in one action', async ({ page }) => {
  await page.locator('div.w-56').getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('div.w-56')).toBeVisible();
  await expect(adjustToggle(page).locator('span.bg-accent')).toHaveCount(0);
  const style = await page.locator('.react-transform-component img').first().getAttribute('style');
  expect(style ?? '').toContain('brightness(100%) contrast(100%) hue-rotate(0deg) saturate(100%)');
});

Given('the display adjustments have been changed in the Focus view', async ({ page }) => {
  await adjustToggle(page).click();
  await page.getByLabel('Contrast').fill('90');
  await expect(adjustToggle(page).locator('span.bg-accent')).toBeVisible();
});

When('another image is opened in the Focus view', async ({ page, scratch }) => {
  scratch.filterBefore = await page
    .locator('.react-transform-component img')
    .first()
    .getAttribute('style');
  await page.locator('button').filter({ hasText: 'IMG002.JPG' }).first().click();
  await expect(page.locator('.react-transform-component img')).toBeVisible();
});

Then('the same adjustments still apply', async ({ page, scratch }) => {
  const now = await page.locator('.react-transform-component img').first().getAttribute('style');
  expect(now).toBe(scratch.filterBefore);
  await expect(adjustToggle(page).locator('span.bg-accent')).toBeVisible();
});

Then('leaving the Focus view returns the adjustments to neutral', async ({ page }) => {
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(gridCell(page, 'IMG002.JPG')).toBeVisible();
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.locator('.react-transform-component img')).toBeVisible();
  await expect(adjustToggle(page).locator('span.bg-accent')).toHaveCount(0);
  const style = await page.locator('.react-transform-component img').first().getAttribute('style');
  expect(style ?? '').toContain('brightness(100%) contrast(100%) hue-rotate(0deg) saturate(100%)');
});

