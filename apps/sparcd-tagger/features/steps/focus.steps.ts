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
  openWorkspace,
  selectCollection,
  sectionTab,
} from './support/world';
import { BUCKET, PREFIX_A, mediaCsv, MEDIA_A, mediaKey } from './support/data';
import { makePng } from './support/png';
import { autoAdvanceCheckbox } from './support/flows';

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

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * The on-screen rect of the picture itself (any object-contain letterbox
 * excluded) and of the pane framing it.
 */
async function imageInPane(root: Locator): Promise<{ image: Rect; pane: Rect }> {
  const pane = await transformWrapper(root).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  const image = await transformContent(root)
    .first()
    .locator('img')
    .evaluate((el: HTMLImageElement) => {
      const r = el.getBoundingClientRect();
      const f = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
      const w = el.naturalWidth * f;
      const h = el.naturalHeight * f;
      const left = r.left + (r.width - w) / 2;
      const top = r.top + (r.height - h) / 2;
      return { left, top, right: left + w, bottom: top + h };
    });
  return { image, pane };
}

const axes = ({ image, pane }: { image: Rect; pane: Rect }) =>
  [
    [image.left, image.right, pane.left, pane.right],
    [image.top, image.bottom, pane.top, pane.bottom],
  ] as const;

// 3px of fudge: the library rounds positions and the workspace header trims the
// pane's height by a fraction of a pixel.
const FUDGE = 3;

/** A picture larger than the pane keeps covering it; a smaller one stays wholly inside. */
function expectImageInBounds(view: { image: Rect; pane: Rect }): void {
  for (const [lo, hi, paneLo, paneHi] of axes(view)) {
    if (hi - lo >= paneHi - paneLo) {
      expect(lo).toBeLessThanOrEqual(paneLo + FUDGE);
      expect(hi).toBeGreaterThanOrEqual(paneHi - FUDGE);
    } else {
      expect(lo).toBeGreaterThanOrEqual(paneLo - FUDGE);
      expect(hi).toBeLessThanOrEqual(paneHi + FUDGE);
    }
  }
}

/** Whole, centred, and touching the pane on at least one axis. */
function expectFitted(view: { image: Rect; pane: Rect }): void {
  expectImageInBounds(view);
  const gaps = axes(view).map(([lo, hi, paneLo, paneHi]) => {
    expect(Math.abs(lo - paneLo - (paneHi - hi))).toBeLessThanOrEqual(FUDGE);
    expect(lo).toBeGreaterThanOrEqual(paneLo - FUDGE);
    expect(hi).toBeLessThanOrEqual(paneHi + FUDGE);
    return paneHi - paneLo - (hi - lo);
  });
  expect(Math.min(...gaps)).toBeLessThanOrEqual(FUDGE);
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

Then('the Focus image canvas fills the available area beside the species picker', async ({ page }) => {
  const [canvas, species, viewport] = await Promise.all([
    page.getByTestId('focus-drop-zone').boundingBox(),
    page.getByTestId('species-panel').boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  ]);
  expect(canvas).not.toBeNull();
  expect(species).not.toBeNull();
  if (!canvas || !species) return;
  expect(canvas.x).toBeGreaterThanOrEqual(0);
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(species.x + 1);
  expect(canvas.width).toBeGreaterThan(viewport.width * 0.5);
  expect(canvas.height).toBeGreaterThan(viewport.height * 0.45);
});

// --- Resizable Focus split (issue #536) -------------------------------------

async function dragDivider(page: Page, deltaX: number, deltaY: number): Promise<void> {
  const box = (await page.getByRole('separator').boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 5 });
  await page.mouse.up();
}

When("the species panel's divider is dragged narrower", async ({ page, scratch }) => {
  scratch.speciesSizeBefore = (await page.getByTestId('focus-species-pane').boundingBox())!.width;
  scratch.canvasSizeBefore = (await page.getByTestId('focus-drop-zone').boundingBox())!.width;
  await dragDivider(page, 80, 0);
});

Then('the species panel is narrower and the image canvas is wider', async ({ page, scratch }) => {
  const species = (await page.getByTestId('focus-species-pane').boundingBox())!;
  const canvas = (await page.getByTestId('focus-drop-zone').boundingBox())!;
  expect(species.width).toBeLessThan(scratch.speciesSizeBefore as number);
  expect(canvas.width).toBeGreaterThan(scratch.canvasSizeBefore as number);
});

When("the species panel's divider is dragged wider", async ({ page }) => {
  await dragDivider(page, -200, 0);
});

Then('the species panel is wider than its default width', async ({ page }) => {
  const species = (await page.getByTestId('focus-species-pane').boundingBox())!;
  expect(species.width).toBeGreaterThan(340);
});

When("the species panel's divider is dragged as far narrow as it will go", async ({ page }) => {
  await dragDivider(page, 2000, 0);
});

Then('the species panel stays at least 100px wide', async ({ page }) => {
  const species = (await page.getByTestId('focus-species-pane').boundingBox())!;
  expect(species.width).toBeGreaterThanOrEqual(100);
  expect(species.width).toBeLessThan(150);
  const pane = page.getByTestId('focus-species-pane');
  expect(await pane.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await pane.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await pane.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await pane.evaluate(el => { el.scrollLeft = 0; });
});

When("the species panel's divider is dragged as far wide as it will go", async ({ page }) => {
  await dragDivider(page, -2000, 0);
});

Then('the image canvas does not shrink away to nothing', async ({ page }) => {
  const canvas = (await page.getByTestId('focus-drop-zone').boundingBox())!;
  expect(canvas.width).toBeGreaterThanOrEqual(200);
});

Given("the species panel's divider has been dragged to a new width", async ({ page, scratch }) => {
  await dragDivider(page, 80, 0);
  scratch.speciesWidthChosen = (await page.getByTestId('focus-species-pane').boundingBox())!.width;
});

When('Focus is closed and reopened', async ({ page }) => {
  await page.getByRole('button', { name: 'Close Focus' }).click();
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await focusFrame(page, 'IMG001.JPG');
  await enterFocusView(page);
});

Then('the species panel keeps the width that was chosen', async ({ page, scratch }) => {
  const species = (await page.getByTestId('focus-species-pane').boundingBox())!;
  expect(species.width).toBeCloseTo(scratch.speciesWidthChosen as number, 0);
});

When("the species panel's divider is dragged shorter", async ({ page, scratch }) => {
  await expect(page.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
  scratch.speciesSizeBefore = (await page.getByTestId('focus-species-pane').boundingBox())!.height;
  scratch.canvasSizeBefore = (await page.getByTestId('focus-drop-zone').boundingBox())!.height;
  await dragDivider(page, 0, 80);
});

Then('the species panel is shorter and the image canvas is taller', async ({ page, scratch }) => {
  const species = (await page.getByTestId('focus-species-pane').boundingBox())!;
  const canvas = (await page.getByTestId('focus-drop-zone').boundingBox())!;
  expect(species.height).toBeLessThan(scratch.speciesSizeBefore as number);
  expect(canvas.height).toBeGreaterThan(scratch.canvasSizeBefore as number);
});

When("the species panel's divider is focused", async ({ page, scratch }) => {
  scratch.speciesSizeBefore = (await page.getByTestId('focus-species-pane').boundingBox())!.width;
  await page.getByRole('separator').focus();
});

When('the narrowing arrow key is pressed', async ({ page }) => {
  const before = await page.locator('.react-transform-component img').getAttribute('alt');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowRight']) await page.keyboard.press(key);
  await expect(page.locator('.react-transform-component img')).toHaveAttribute('alt', before!);
});

Then('the species panel becomes narrower', async ({ page, scratch }) => {
  const species = (await page.getByTestId('focus-species-pane').boundingBox())!;
  expect(species.width).toBeLessThan(scratch.speciesSizeBefore as number);
});

Given('Overview thumbnail downloads are delayed', async ({ page, s3 }) => {
  for (const image of MEDIA_A.slice(1)) s3.delay(mediaKey(PREFIX_A, image.file), 2_000);
  await page.reload();
  await openWorkspace(page);
  await enterFocusView(page);
});

Then('the Focus image is requested at high priority', async ({ page }) => {
  const image = page.locator('.react-transform-component img');
  await expect(image).toHaveAttribute('fetchpriority', 'high');
  await expect.poll(() => image.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
});

Then('no Overview thumbnails are requested while Focus is open', async ({ page }) => {
  const thumbs = page.locator('img[fetchpriority="low"]');
  await expect(thumbs).toHaveCount(0);
});

Given("the current Focus image's next download is delayed", async ({ page, s3 }) => {
  await expect(page.locator('.react-transform-component img')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  s3.delay(mediaKey(PREFIX_A, MEDIA_A[0].file), 2_000);
});

When('another image is opened and the first image is opened again', async ({ page }) => {
  await page.getByRole('button', { name: 'Next image' }).click();
  await page.getByRole('button', { name: 'Previous image' }).click();
});

Then('the Focus loading status stays visible until that image loads', async ({ page }) => {
  const status = page.getByRole('status').filter({ hasText: 'loading' });
  await expect(status).toBeVisible();
  await expect(page.locator('.react-transform-component img')).toBeVisible();
  await expect(status).toHaveCount(0);
});

Given('the focused video is waiting for its first frame', async ({ page, s3 }) => {
  const focus = page.getByRole('dialog', { name: 'Focus image viewer' });
  if (await focus.count()) await page.getByRole('button', { name: 'Close Focus' }).click();
  await sectionTab(page, 'Tag').click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  s3.delay(mediaKey(PREFIX_A, 'VID001.MP4'), 10_000);
  await focusFrame(page, 'VID001.MP4');
  await enterFocusViewForVideo(page);
  await expect(page.getByRole('status').filter({ hasText: 'loading' })).toBeVisible();
});

When('video metadata becomes available before its first frame', async ({ page }) => {
  await page.locator('video[controls]').evaluate((video) => {
    video.dispatchEvent(new Event('loadedmetadata'));
  });
});

When('the first video frame becomes available', async ({ page }) => {
  await page.locator('video[controls]').evaluate((video) => {
    video.dispatchEvent(new Event('loadeddata'));
  });
});

Then('the Focus loading status is still visible', async ({ page }) => {
  await expect(page.getByRole('status').filter({ hasText: 'loading' })).toBeVisible();
});

Then('the Focus loading status disappears', async ({ page }) => {
  await expect(page.getByRole('status').filter({ hasText: 'loading' })).toHaveCount(0);
});

Given('a thumbnail download fails after signing', async ({ page, s3 }) => {
  s3.failRead(mediaKey(PREFIX_A, 'IMG002.JPG'));
  await page.reload();
  await openWorkspace(page);
  await expect(page.locator('button[title="IMG002.JPG"]')).toBeVisible();
});

Then('the failed thumbnail is marked as failed rather than loaded', async ({ page }) => {
  const tile = page.locator('button[title="IMG002.JPG"]');
  await expect(tile.getByTestId('thumbnail-failure')).toBeVisible();
  await expect(tile.getByTestId('thumbnail-play')).toHaveCount(0);
});

Given('a video thumbnail is waiting for its first frame', async ({ page, s3 }) => {
  s3.delay(mediaKey(PREFIX_A, 'VID001.MP4'), 10_000);
  await page.reload();
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('button[title="VID001.MP4"] video')).toBeVisible();
});

When('thumbnail video metadata becomes available before its first frame', async ({ page }) => {
  await page.locator('button[title="VID001.MP4"] video').evaluate((video) => {
    video.dispatchEvent(new Event('loadedmetadata'));
  });
});

Then('the thumbnail play marker is still hidden', async ({ page }) => {
  await expect(page.locator('button[title="VID001.MP4"] [data-testid="thumbnail-play"]')).toHaveCount(0);
});

When('the thumbnail video frame becomes available', async ({ page }) => {
  await page.locator('button[title="VID001.MP4"] video').evaluate((video) => {
    video.dispatchEvent(new Event('loadeddata'));
  });
});

Then('the thumbnail play marker is visible', async ({ page }) => {
  await expect(page.locator('button[title="VID001.MP4"] [data-testid="thumbnail-play"]')).toBeVisible();
});

// The selected filmstrip row must not ask for 'high' too: it would take the
// scheduler slot kept free for Focus.
Then('the Focus image is the only media requested at high priority', async ({ page }) => {
  await expect(page.locator('[fetchpriority="high"]')).toHaveCount(1);
});

// --- Zoom -------------------------------------------------------------------

// Used as both the action and the precondition ("Given the image is zoomed in").
When('the image is zoomed in', async ({ page }) => {
  await zoomIn(page.locator('body'), 1);
  expect((await readTransform(page.locator('body'))).scale).toBeGreaterThan(1);
});

Then('it can be enlarged up to six times its fitted size', async ({ page }) => {
  const scale = await zoomToLimit(page.locator('body'));
  expect(scale).toBeCloseTo(6, 1);
});

// --- Fitting on resize (issue #533) ------------------------------------------

const resizeViewer = (page: Page) => page.getByRole('dialog', { name: 'Fullscreen image', exact: true });
async function activeResizeRoot(page: Page): Promise<Locator> {
  return await resizeViewer(page).count() ? resizeViewer(page) : page.getByRole('dialog', { name: 'Focus image viewer', exact: true });
}

When('the workspace window is resized smaller', async ({ page, scratch }) => {
  scratch.resizeOriginalViewport = page.viewportSize()!;
  const before = page.viewportSize()!;
  await page.setViewportSize({ width: Math.round(before.width * 0.6), height: Math.round(before.height * 0.6) });
});

When('the workspace window is restored to its original size', async ({ page, scratch }) => {
  await page.setViewportSize(scratch.resizeOriginalViewport as { width: number; height: number });
});

Then('the image still fits the pane', async ({ page }) => {
  const root = await activeResizeRoot(page);
  // The zoom wrapper can itself overflow: compare with the independently sized canvas.
  const canvas = await resizeViewer(page).count()
    ? transformWrapper(root).locator('..')
    : page.getByTestId('focus-drop-zone');
  await expect(async () => {
    const view = await imageInPane(root);
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const pane = { left: bounds!.x, top: bounds!.y, right: bounds!.x + bounds!.width, bottom: bounds!.y + bounds!.height };
    for (const [lo, hi, paneLo, paneHi] of axes({ image: view.pane, pane })) {
      expect(lo).toBeGreaterThanOrEqual(paneLo - FUDGE);
      expect(hi).toBeLessThanOrEqual(paneHi + FUDGE);
    }
    // Focus has intentional canvas padding; fitting touches the inner pane,
    // while containment against the outer canvas detects an oversized pane.
    expectFitted(view);
    expect((await readTransform(root)).scale).toBeCloseTo(1, 3);
    await expect(root.locator('button[title="Reset to fit"]')).toHaveCount(0);
  }).toPass({ timeout: 10_000 });
});

Given('a height-constrained portrait is shown in Focus', async ({ page, s3 }) => {
  s3.put(BUCKET, mediaKey(PREFIX_A, MEDIA_A[0].file), makePng(400, 1600, 123), 'image/png');
  await page.reload();
  await openWorkspace(page);
  await enterFocusView(page);
  await expect.poll(() => page.locator('.react-transform-component img').evaluate((el: HTMLImageElement) => el.naturalHeight)).toBe(1600);
});

When('the window narrows without changing the portrait fitted size', async ({ page, scratch }) => {
  const root = await activeResizeRoot(page);
  const dimensions = await transformContent(root).evaluate(el => ({ width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight }));
  const before = page.viewportSize()!;
  scratch.resizeOriginalViewport = before;
  await page.setViewportSize({ width: before.width - 120, height: before.height });
  await expect.poll(() => transformContent(root).evaluate(el => ({ width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight }))).toEqual(dimensions);
});

When('the fullscreen image is zoomed in', async ({ page }) => {
  expect(await zoomIn(resizeViewer(page), 1)).toBeGreaterThan(1);
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
  // Shove it hard in both directions; the picture must not leave the pane.
  for (const [dx, dy] of [
    [4000, 4000],
    [-8000, -8000],
  ] as const) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
    await page.mouse.up();
    await settle(page.locator('body'));
    expect((await readTransform(page.locator('body'))).scale).toBeGreaterThan(1);
    expectImageInBounds(await imageInPane(page.locator('body')));
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

When('the fullscreen top bar is clicked', async ({ page }) => {
  await lightbox(page).locator(':scope > div').first().click({ position: { x: 4, y: 4 } });
});

When('Escape is pressed in the fullscreen viewer', async ({ page }) => {
  await page.keyboard.press('Escape');
});

Then('the fullscreen viewer is closed', async ({ page }) => {
  await expect(lightbox(page)).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Next image' }).click();
  await expect(page.locator('.react-transform-component img')).toBeVisible();
});

Then('the new image is shown fitted to the pane', async ({ page }) => {
  await expect.poll(async () => (await readTransform(page.locator('body'))).scale).toBe(1);
});

Then('no zoom or pan state carries over from the previous image', async ({ page }) => {
  expect((await readTransform(page.locator('body'))).scale).toBe(1);
  // The fit settles once the new image has loaded.
  await expect(async () => expectFitted(await imageInPane(page.locator('body')))).toPass();
});

// --- Differing image shapes -------------------------------------------------

const SHAPES = [
  { file: 'IMG001.JPG', w: 240, h: 420 },
  { file: 'IMG002.JPG', w: 640, h: 360 },
  { file: 'IMG003.JPG', w: 1200, h: 200 },
];

type Examination = {
  natural: { w: number; h: number };
  objectFit: string;
  fitted: { t: Transform; view: { image: Rect; pane: Rect } };
  enlarged: Transform;
  dragged: Transform;
  shoved: { image: Rect; pane: Rect }[];
  // Enlarged to the limit in the fullscreen view, then shoved the same way.
  fullscreen?: { image: Rect; pane: Rect }[];
};

/** Drag hard towards one corner, then the opposite one, recording where the picture ends up. */
async function shoveBothWays(page: Page, root: Locator): Promise<{ image: Rect; pane: Rect }[]> {
  const box = (await transformWrapper(root).first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const views: { image: Rect; pane: Rect }[] = [];
  for (const [dx, dy] of [
    [4000, 4000],
    [-8000, -8000],
  ] as const) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
    await page.mouse.up();
    await settle(root);
    views.push(await imageInPane(root));
  }
  return views;
}

Given(
  'the upload holds a portrait, a landscape and a panorama image of differing sizes',
  async ({ page, s3 }) => {
    SHAPES.forEach((s, i) =>
      s3.put(BUCKET, mediaKey(PREFIX_A, s.file), makePng(s.w, s.h, i + 100), 'image/png'),
    );
    await page.reload();
    await openWorkspace(page);
    await enterFocusView(page);
  },
);

When('each of them is examined closely in the Focus view', async ({ page, scratch }) => {
  const body = page.locator('body');
  const exams: Examination[] = [];
  for (const [index, shape] of SHAPES.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Next image' }).click();
    const img = page.locator('.react-transform-component img').first();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(shape.w);
    const [natural, objectFit] = await img.evaluate((el: HTMLImageElement) => [
      { w: el.naturalWidth, h: el.naturalHeight },
      getComputedStyle(el).objectFit,
    ] as const);
    await settle(body);
    const fitted = { t: await readTransform(body), view: await imageInPane(body) };
    await zoomToLimit(body);
    const enlarged = await readTransform(body);

    const visible = await imageInPane(body);
    const cx = (visible.pane.left + visible.pane.right) / 2;
    const cy = visible.pane.top + (visible.pane.bottom - visible.pane.top) * 0.3;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 60, cy - 40, { steps: 12 });
    await page.mouse.up();
    await settle(body);
    const dragged = await readTransform(body);

    const shoved = await shoveBothWays(page, body);

    // The portrait and the panorama are the letterboxed ones; check the
    // fullscreen view holds them too.
    let fullscreen: Examination['fullscreen'];
    if (shape.h > shape.w || shape.w > 3 * shape.h) {
      await page.getByRole('button', { name: 'Open fullscreen' }).click();
      await expect(lightbox(page)).toBeVisible();
      await expect.poll(() => lightbox(page).locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(shape.w);
      await zoomToLimit(lightbox(page));
      fullscreen = await shoveBothWays(page, lightbox(page));
      await page.keyboard.press('Escape');
      await expect(lightbox(page)).toHaveCount(0);
    }
    exams.push({ natural, objectFit, fitted, enlarged, dragged, shoved, fullscreen });
  }
  scratch.exams = exams;
});

Then('each opens whole and undistorted at the fitted size', async ({ scratch }) => {
  const exams = scratch.exams as Examination[];
  exams.forEach((e, i) => {
    expect(e.natural).toEqual({ w: SHAPES[i].w, h: SHAPES[i].h });
    expect(e.objectFit).toBe('contain');
    expect(e.fitted.t.scale).toBe(1);
    expectFitted(e.fitted.view);
  });
});

Then('each can be enlarged up to six times its fitted size', async ({ scratch }) => {
  for (const e of scratch.exams as Examination[]) expect(e.enlarged.scale).toBeCloseTo(6, 1);
});

Then(
  'each can be dragged around once enlarged without moving beyond its edges',
  async ({ scratch }) => {
    for (const e of scratch.exams as Examination[]) {
      expect(e.dragged.scale).toBeCloseTo(e.enlarged.scale, 2);
      expect(Math.abs(e.dragged.x - e.enlarged.x) + Math.abs(e.dragged.y - e.enlarged.y)).toBeGreaterThan(5);
      for (const view of e.shoved) expectImageInBounds(view);
    }
  },
);

Then('the portrait and the panorama stay in view when enlarged fullscreen too', async ({ scratch }) => {
  const checked = (scratch.exams as Examination[]).filter((e) => e.fullscreen);
  expect(checked.map((e) => e.natural.w)).toEqual([SHAPES[0].w, SHAPES[2].w]);
  for (const e of checked) for (const view of e.fullscreen!) expectImageInBounds(view);
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
  const focus = page.getByRole('dialog', { name: 'Focus image viewer' });
  if (await focus.count()) await page.getByRole('button', { name: 'Close Focus' }).click();
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
    await page.getByRole('button', { name: 'Previous image' }).click();
    await expect(page.locator('video[controls]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Next image' }).click();
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
  if (await page.getByRole('button', { name: 'Close Focus' }).count()) {
    await page.getByRole('button', { name: 'Close Focus' }).click();
    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await focusFrame(page, 'IMG001.JPG');
  await enterFocusView(page);
  await expect(page.locator('.react-transform-component img')).toBeVisible();
});

When('the adjustment panel is opened', async ({ page }) => {
  await adjustToggle(page).click();
  await expect(page.getByLabel('Brightness')).toBeVisible();
});

const adjustmentPanel = (page: Page): Locator => page.getByRole('dialog', { name: 'Image adjustments' });

type Box = { x: number; y: number; width: number; height: number };

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

Then('the adjustment panel leaves the Focus navigation usable', async ({ page }) => {
  const [panel, navigation] = await Promise.all([
    adjustmentPanel(page).boundingBox(),
    page.getByRole('button', { name: 'Next image' }).boundingBox(),
  ]);
  expect(panel).not.toBeNull();
  expect(navigation).not.toBeNull();
  expect(intersects(panel!, navigation!)).toBe(false);
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), {
    x: navigation!.x + navigation!.width / 2,
    y: navigation!.y + navigation!.height / 2,
  });
  expect(hit).toBe('Next image');
});

Then('it stays in the viewport when neither side fits', async ({ page }) => {
  try {
    await page.setViewportSize({ width: 320, height: 150 });
    await expect(adjustmentPanel(page)).toBeVisible();
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    await expect.poll(async () => {
      const panel = await adjustmentPanel(page).boundingBox();
      return panel ? panel.y + panel.height : Infinity;
    }).toBeLessThanOrEqual(viewport.height - 8);
    const panel = await adjustmentPanel(page).boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(8);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(panel!.y).toBeGreaterThanOrEqual(8);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(viewport.height - 8);
  } finally {
    await page.keyboard.press('Escape');
    await expect(adjustmentPanel(page)).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 950 });
  }
});

Then('clicking outside the adjustment panel dismisses it', async ({ page }) => {
  await page.mouse.click(2, 2);
  await expect(adjustmentPanel(page)).toHaveCount(0);
  await adjustToggle(page).click();
  await expect(adjustmentPanel(page)).toBeVisible();
});

Then('focusing another control dismisses it', async ({ page }) => {
  await page.getByRole('button', { name: 'Close Focus' }).focus();
  await expect(adjustmentPanel(page)).toHaveCount(0);
});

When('the focused image moves while the adjustment panel is open', async ({ page, scratch }) => {
  const [panel, view] = await Promise.all([
    adjustmentPanel(page).boundingBox(),
    imageInPane(page.locator('body')),
  ]);
  const media = view
    ? { x: view.image.left, y: view.image.top, width: view.image.right - view.image.left, height: view.image.bottom - view.image.top }
    : null;
  scratch.adjustmentBeforeMove = { panel, media };
  // Move the Focus transform without clicking outside the portal popup. This
  // exercises the same style mutation produced by the real pan controls while
  // leaving the adjustment dialog open for its remeasurement observer.
  await transformContent(page.locator('body')).first().evaluate((element) => {
    (element as HTMLElement).style.transform = 'translate(240px, 0px) scale(1)';
  });
  await settle(page.locator('body'));
});

/**
 * Where the panel may not go, read off the rendered page rather than off the
 * placement function the app itself uses — asking that for the expected answer
 * would make any placement pass.
 */
async function expectPanelClearOfEverything(page: Page) {
  await expect
    .poll(async () => {
      const [panel, view, species, viewport] = await Promise.all([
        adjustmentPanel(page).boundingBox(),
        imageInPane(page.locator('body')),
        page.locator('[data-testid="species-panel"]').boundingBox(),
        page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
      ]);
      if (!panel || !view) return ['no panel or media'];
      const media = {
        x: view.image.left,
        y: view.image.top,
        width: view.image.right - view.image.left,
        height: view.image.bottom - view.image.top,
      };
      const problems: string[] = [];
      if (intersects(panel, media)) problems.push('covers the image');
      // Only beside the image is the species list a rail the panel must dodge;
      // narrow layouts stack it below the fold.
      if (species && species.x >= media.x + media.width && intersects(panel, species))
        problems.push('covers the species list');
      if (
        panel.x < 0 ||
        panel.y < 0 ||
        panel.x + panel.width > viewport.width ||
        panel.y + panel.height > viewport.height
      )
        problems.push('leaves the window');
      return problems;
    })
    .toEqual([]);
}

Then('the adjustment panel follows the focused image', async ({ page, scratch }) => {
  const before = scratch.adjustmentBeforeMove as { panel: Box; media: Box };
  const [panel, view] = await Promise.all([
    adjustmentPanel(page).boundingBox(),
    imageInPane(page.locator('body')),
  ]);
  const media = view
    ? { x: view.image.left, y: view.image.top, width: view.image.right - view.image.left, height: view.image.bottom - view.image.top }
    : null;
  expect(panel).not.toBeNull();
  expect(media).not.toBeNull();
  const shift = media!.x - before.media.x;
  expect(shift).toBeGreaterThan(5);
  await expectPanelClearOfEverything(page);
});

When('the adjustment panel is opened on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await adjustToggle(page).click();
  await expect(page.getByLabel('Brightness')).toBeVisible();
});

Then('the adjustment panel stays inside the window on a phone', async ({ page }) => {
  // On a phone-sized viewport the Focus canvas can consume the full height,
  // so the measured popup uses its documented least-overlap fallback. Verify
  // the safety invariant that still applies: it remains wholly in the viewport.
  await expect.poll(async () => {
    const panel = await adjustmentPanel(page).boundingBox();
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (!panel) return ['no panel'];
    const problems: string[] = [];
    if (panel.x < 0 || panel.y < 0 || panel.x + panel.width > viewport.width || panel.y + panel.height > viewport.height) {
      problems.push('leaves the window');
    }
    return problems;
  }).toEqual([]);
});

Then('the Adjust control sits under the zoom button column, with a gap', async ({ page }) => {
  const [adjust, fullscreen] = await Promise.all([
    adjustToggle(page).boundingBox(),
    page.getByRole('button', { name: 'Open fullscreen' }).boundingBox(),
  ]);
  expect(adjust).not.toBeNull();
  expect(fullscreen).not.toBeNull();
  // Right-anchored in the same column as the zoom buttons, below them, with
  // more room than the gap used between the zoom buttons and Reset.
  expect(Math.abs(adjust!.x + adjust!.width - (fullscreen!.x + fullscreen!.width))).toBeLessThanOrEqual(2);
  expect(adjust!.y).toBeGreaterThan(fullscreen!.y + fullscreen!.height + 8);
  const canvas = (await page.getByTestId('focus-drop-zone').boundingBox())!;
  expect(adjust!.x).toBeGreaterThanOrEqual(canvas.x);
  expect(adjust!.x + adjust!.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(adjust!.y + adjust!.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  await expect(adjustToggle(page)).toHaveCount(1);
});

When('the viewport is narrowed to a phone size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

Then('the Adjust control sits at the top-left, clear of the zoom column', async ({ page }) => {
  const [adjust, fullscreen] = await Promise.all([
    adjustToggle(page).boundingBox(),
    page.getByRole('button', { name: 'Open fullscreen' }).boundingBox(),
  ]);
  expect(adjust).not.toBeNull();
  expect(fullscreen).not.toBeNull();
  expect(adjust!.x).toBeLessThan(fullscreen!.x);
  expect(adjust!.y).toBeLessThan(fullscreen!.y);
  const canvas = (await page.getByTestId('focus-drop-zone').boundingBox())!;
  expect(Math.abs(adjust!.x - canvas.x - 16)).toBeLessThanOrEqual(2);
  expect(Math.abs(adjust!.y - canvas.y - 16)).toBeLessThanOrEqual(2);
  expect(adjust!.x + adjust!.width).toBeLessThanOrEqual(Math.min(canvas.x + canvas.width, 390));
  expect(adjust!.y + adjust!.height).toBeLessThanOrEqual(844);
  await expect(adjustToggle(page)).toHaveCount(1);
});

Then('keyboard focus enters the adjustment panel', async ({ page }) => {
  await expect(page.getByLabel('Brightness')).toBeFocused();
});

Then('Tab wraps between the Focus viewer and the adjustment panel', async ({ page }) => {
  const focusDialog = page.getByRole('dialog', { name: 'Focus image viewer' });
  const brightness = page.getByLabel('Brightness');
  // Reset stays disabled (and so out of the tab order) while the values are
  // still neutral, so "Keep values" is the last enabled control at this point.
  const keepValues = page.getByLabel('Keep values');
  await brightness.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(keepValues).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close Focus' })).toBeFocused();
  await adjustToggle(page).click();
  await expect(brightness).toBeFocused();
  await expect(focusDialog).toBeVisible();
});

Then('Escape closes the adjustment panel and returns focus to Adjust', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(adjustmentPanel(page)).toHaveCount(0);
  await expect(adjustToggle(page)).toBeFocused();
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

Given('"Keep values" is checked', async ({ page }) => {
  await adjustToggle(page).click();
  await page.getByLabel('Keep values').check();
  await expect(page.getByLabel('Keep values')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(adjustmentPanel(page)).toHaveCount(0);
});

Then('the Keep values checkbox is unchecked', async ({ page }) => {
  await expect(page.getByLabel('Keep values')).not.toBeChecked();
  await expect(page.getByLabel('Keep values')).toHaveAccessibleDescription('Keep adjustments when moving to the next or previous image. Turning this off leaves the current image unchanged.');
});

async function navigateAdjustmentImage(page: Page, direction: 'Next' | 'Previous') {
  const image = page.locator('.react-transform-component img');
  const beforeSrc = await image.getAttribute('src');
  const beforeName = await image.getAttribute('alt');
  expect(beforeSrc).toBeTruthy();
  expect(beforeName).toBeTruthy();
  await page.getByRole('button', { name: `${direction} image`, exact: true }).click();
  await expect(image).toBeVisible();
  await expect(image).not.toHaveAttribute('src', beforeSrc!);
  await expect(image).not.toHaveAttribute('alt', beforeName!);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}

When('another image is opened in the Focus view', async ({ page, scratch }) => {
  scratch.filterBefore = await page
    .locator('.react-transform-component img')
    .first()
    .getAttribute('style');
  await page.keyboard.press('Escape');
  await expect(adjustmentPanel(page)).toHaveCount(0);
  await navigateAdjustmentImage(page, 'Next');
});

Then('the same adjustments still apply', async ({ page, scratch }) => {
  const now = await page.locator('.react-transform-component img').first().getAttribute('style');
  expect(now).toBe(scratch.filterBefore);
  await expect(adjustToggle(page).locator('span.bg-accent')).toBeVisible();
  await adjustToggle(page).click();
  for (const [label, value] of [['Brightness', '50'], ['Contrast', '90'], ['Hue', '50'], ['Saturation', '50']]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  }
});

Then('the adjustments have reset to neutral', async ({ page }) => {
  await adjustToggle(page).click();
  for (const label of ['Brightness', 'Contrast', 'Hue', 'Saturation']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('50');
  }
  await expect(adjustToggle(page).locator('span.bg-accent')).toHaveCount(0);
  const style = await page.locator('.react-transform-component img').first().getAttribute('style');
  expect(style ?? '').toContain('brightness(100%) contrast(100%) hue-rotate(0deg) saturate(100%)');
});

Then('leaving the Focus view returns the adjustments to neutral', async ({ page }) => {
  await page.getByRole('button', { name: 'Close Focus' }).click();
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await focusFrame(page, 'IMG002.JPG');
  await enterFocusView(page);
  await expect(page.locator('.react-transform-component img')).toBeVisible();
  await expect(adjustToggle(page).locator('span.bg-accent')).toHaveCount(0);
  const style = await page.locator('.react-transform-component img').first().getAttribute('style');
  expect(style ?? '').toContain('brightness(100%) contrast(100%) hue-rotate(0deg) saturate(100%)');
  await adjustToggle(page).click();
  await expect(page.getByLabel('Keep values')).not.toBeChecked();
  for (const label of ['Brightness', 'Contrast', 'Hue', 'Saturation']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('50');
  }
});

When('the open Adjust panel crosses the desktop breakpoint in both directions', async ({ page }) => {
  await adjustToggle(page).click();
  const brightness = page.getByLabel('Brightness');
  await expect(brightness).toBeFocused();
  await brightness.fill('73');
  for (const width of [1023, 1024, 390, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await expect(adjustToggle(page)).toHaveCount(1);
    await expect(adjustmentPanel(page)).toHaveCount(1);
    await expect(brightness).toHaveValue('73');
    await expect(brightness).toBeFocused();
    await expect(async () => {
      const bounds = (await adjustmentPanel(page).boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(950);
    }).toPass({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(adjustmentPanel(page)).toHaveCount(0);
    await expect(adjustToggle(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(brightness).toBeFocused();
    await expect(brightness).toHaveValue('73');
  }
});

Given('a later image is open for testing previous-image adjustments', async ({ page }) => {
  await navigateAdjustmentImage(page, 'Next');
});

When('the previous image is opened in the Focus view', async ({ page, scratch }) => {
  scratch.filterBefore = await page.locator('.react-transform-component img').first().getAttribute('style');
  await page.keyboard.press('Escape');
  await expect(adjustmentPanel(page)).toHaveCount(0);
  await navigateAdjustmentImage(page, 'Previous');
});

When('Keep values is turned off without navigating', async ({ page, scratch }) => {
  scratch.filterBeforeUncheck = await page.locator('.react-transform-component img').first().getAttribute('style');
  await page.getByLabel('Keep values').uncheck();
});

Then('the current adjustment values are preserved with Keep values off', async ({ page, scratch }) => {
  await expect(page.getByLabel('Keep values')).not.toBeChecked();
  await expect(page.getByLabel('Contrast', { exact: true })).toHaveValue('90');
  await expect(page.locator('.react-transform-component img').first()).toHaveAttribute('style', scratch.filterBeforeUncheck as string);
});

Given('auto-advance is disabled for adjustment shortcut checks', async ({ page }) => {
  await page.getByRole('button', { name: 'Close Focus', exact: true }).click();
  await sectionTab(page, 'Settings').click();
  await autoAdvanceCheckbox(page).uncheck();
  await sectionTab(page, 'Tag').click();
});

Then('Keep values supports {word} toggling without blocking workspace shortcuts', async ({ page }, activation: string) => {
  const image = page.locator('.react-transform-component img');
  const originalSrc = await image.getAttribute('src');
  const originalName = await image.getAttribute('alt');
  expect(originalSrc).toBeTruthy();
  expect(originalName).toBeTruthy();
  const count = page.getByRole('spinbutton', { name: 'Count for Mule Deer', exact: true });
  let expectedCount = Number(await count.inputValue());

  for (const checked of [true, false]) {
    await adjustToggle(page).click();
    await expect(page.getByLabel('Brightness', { exact: true })).toBeFocused();
    await page.getByLabel('Contrast', { exact: true }).fill('90');
    const checkbox = page.getByRole('checkbox', { name: 'Keep values', exact: true });
    if (activation === 'pointer') {
      await page.getByText('Keep values', { exact: true }).click();
    } else {
      await page.getByLabel('Brightness', { exact: true }).focus();
      for (let tab = 0; tab < 4; tab++) await page.keyboard.press('Tab');
      await expect(checkbox).toBeFocused();
      await page.keyboard.press('Space');
    }
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toBeChecked({ checked });
    await expect(image).toHaveAttribute('src', originalSrc!);
    await expect(count).toHaveValue(String(expectedCount));
    await page.keyboard.press('Enter');
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toBeChecked({ checked });

    await page.keyboard.press('d');
    await expect(count).toHaveValue(String(++expectedCount));
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toBeChecked({ checked });
    await page.keyboard.press('ArrowRight');
    await expect(image).not.toHaveAttribute('src', originalSrc!);
    await expect(image).not.toHaveAttribute('alt', originalName!);
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(adjustmentPanel(page)).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await expect(image).toHaveAttribute('src', originalSrc!);
    await expect(image).toHaveAttribute('alt', originalName!);
    await expect(count).toHaveValue(String(expectedCount));
    const style = await image.getAttribute('style');
    expect(style).toContain(checked ? 'contrast(180%)' : 'contrast(100%)');
  }
});

Then('split preferences survive resizing and reload without hiding controls', async ({ page }) => {
  const divider = page.getByRole('separator'), pane = page.getByTestId('focus-species-pane');
  await page.setViewportSize({ width: 1920, height: 950 });
  await divider.focus(); await page.keyboard.press('End');
  const width = await page.evaluate(() => localStorage.getItem('sparcd-tagger:focus-split:w'));
  expect(Number(width)).toBeGreaterThan(1000);
  await page.setViewportSize({ width: 1024, height: 950 });
  await expect.poll(() => pane.evaluate(el => el.clientWidth)).toBeLessThanOrEqual(776);
  expect((await page.getByTestId('focus-drop-zone').boundingBox())!.width).toBeGreaterThanOrEqual(239);
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
  await divider.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowUp');
  const height = await page.evaluate(() => localStorage.getItem('sparcd-tagger:focus-split:h'));
  expect(height).toBe('116');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.reload(); await openWorkspace(page); await enterFocusView(page);
  await expect.poll(() => pane.evaluate(el => el.clientWidth)).toBe(Math.min(Number(width), 1192));
  expect(await page.evaluate(() => localStorage.getItem('sparcd-tagger:focus-split:w'))).toBe(width);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => pane.evaluate(el => el.clientHeight)).toBe(Number(height));
  const id = await divider.getAttribute('aria-controls');
  expect(id).toBeTruthy(); await expect(pane).toHaveAttribute('id', id!);
  await expect(divider).toHaveAttribute('aria-valuenow', height!);
  await page.setViewportSize({ width: 390, height: 300 });
  await expect.poll(() => page.getByTestId('focus-drop-zone').evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(240);
  await page.getByTestId('species-panel').getByRole('textbox').scrollIntoViewIfNeeded();
  expect(await pane.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
});

Then('a touch drag resizes the phone split', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const divider = page.getByRole('separator'), pane = page.getByTestId('focus-species-pane');
  await expect(divider).toHaveCSS('touch-action', 'none');
  const before = (await pane.boundingBox())!.height, box = (await divider.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let delta = 10; delta <= 60; delta += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + delta }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => pane.evaluate(el => el.clientHeight)).toBeLessThan(before - 30);
  } finally { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach(); }
});

Then('canceled and unmounted drags stop resizing', async ({ page }) => {
  const divider = page.getByRole('separator'), pane = page.getByTestId('focus-species-pane');
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + 20);
  const activeSize = (await pane.boundingBox())!.width;
  await divider.evaluate(el => el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 999, clientX: 0, bubbles: true })));
  expect((await pane.boundingBox())!.width).toBe(activeSize);
  await divider.evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
  const canceled = (await pane.boundingBox())!.width;
  await page.mouse.move(box.x + 150, box.y + 20); await page.mouse.up();
  expect((await pane.boundingBox())!.width).toBe(canceled);
  const capture = (await divider.boundingBox())!;
  await page.mouse.move(capture.x + 4, capture.y + 20); await page.mouse.down();
  await divider.evaluate(el => el.releasePointerCapture(1));
  const released = (await pane.boundingBox())!.width;
  await page.mouse.move(capture.x + 80, capture.y + 20); await page.mouse.up();
  expect((await pane.boundingBox())!.width).toBe(released);
  const next = (await divider.boundingBox())!;
  await page.mouse.move(next.x + 4, next.y + 20); await page.mouse.down();
  await page.keyboard.press('Escape'); await expect(divider).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('sparcd-tagger:focus-split:w'));
  await page.mouse.move(10, 10); await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem('sparcd-tagger:focus-split:w'))).toBe(saved);
  await enterFocusView(page); await expect(divider).toBeVisible();
});
