import type { Page } from '@playwright/test';
import {
  Given,
  When,
  Then,
  expect,
  gridCell,
  listRow,
  tileOrder,
  focusedTile,
  selectedTiles,
  positionReadout,
  speciesFilter,
  imageSearch,
  speciesRow,
  focusFrame,
  enterFocusView,
} from './support/world';
import { COLLECTION_NAME, STAMP_A } from './support/data';
import { readStore } from './support/flows';

const TOUCH = { width: 900, height: 860 };
const DESKTOP = { width: 1440, height: 950 };

const focusedName = async (page: Page): Promise<string> =>
  (await focusedTile(page).first().getAttribute('title')) ?? '';

// --- Views ------------------------------------------------------------------

Then('the Overview can be switched between a grid of tiles and a list of rows', async ({ page }) => {
  await expect(gridCell(page, 'IMG001.JPG')).toBeVisible();
  await page.getByRole('button', { name: '☰ List' }).click();
  await expect(listRow(page, 'IMG001.JPG')).toBeVisible();
  await expect(gridCell(page, 'IMG001.JPG')).toHaveCount(0);
  await page.getByRole('button', { name: '▦ Grid' }).click();
  await expect(gridCell(page, 'IMG001.JPG')).toBeVisible();
});

Then('the collection name and upload name are shown', async ({ page }) => {
  await expect(page.getByText(`${COLLECTION_NAME} / ${STAMP_A}`)).toBeVisible();
});

Then('its grid tile shows Has species and Questionable badges', async ({ page }) => {
  const tile = gridCell(page, 'IMG001.JPG');
  await expect(tile).toHaveAccessibleName(/Has species.*Questionable/);
  await expect(tile.locator('[title^="Has species"]')).toBeVisible();
  await expect(tile.locator('[title="questionable"]')).toBeVisible();
});

When('the Overview is switched to the list view', async ({ page }) => {
  await page.getByRole('button', { name: '☰ List' }).click();
});

Then('its list row shows Has species and Questionable badges', async ({ page }) => {
  const row = listRow(page, 'IMG001.JPG');
  const thumbnail = row.getByTestId('image-thumbnail');
  await expect(thumbnail.locator('[title^="Has species"]')).toBeVisible();
  await expect(thumbnail.locator('[title="questionable"]')).toBeVisible();
  await expect(row).toHaveAccessibleName(/Has species.*Questionable/);
});

When('the Overview is resized to a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

Then('the list thumbnail badges still fit inside their image', async ({ page }) => {
  const thumbnail = listRow(page, 'IMG001.JPG').getByTestId('image-thumbnail');
  const imageBox = await thumbnail.boundingBox();
  const badges = await thumbnail.locator('span.inline-flex').first().boundingBox();
  expect(imageBox).not.toBeNull();
  expect(badges).not.toBeNull();
  expect(badges!.width).toBeGreaterThanOrEqual(36);
  expect(badges!.x).toBeGreaterThanOrEqual(imageBox!.x);
  expect(badges!.y).toBeGreaterThanOrEqual(imageBox!.y);
  expect(badges!.x + badges!.width).toBeLessThanOrEqual(imageBox!.x + imageBox!.width);
  expect(badges!.y + badges!.height).toBeLessThanOrEqual(imageBox!.y + imageBox!.height);
});

Given('image {string} is focused', async ({ page }, fileName: string) => {
  await focusFrame(page, fileName);
});

Then('the focused tile is named Questionable and not Has species', async ({ page }) => {
  const tile = gridCell(page, 'IMG002.JPG');
  await expect(tile).toHaveAccessibleName(/Questionable/);
  await expect(tile).not.toHaveAccessibleName(/Has species/);
  await expect(tile.locator('[title="questionable"]')).toBeVisible();
  await expect(tile.locator('[title^="Has species"]')).toHaveCount(0);
});

Then('the focused tile announces its species and review status', async ({ page }) => {
  await expect(gridCell(page, 'IMG004.JPG')).toHaveAccessibleName(
    /Species: Mountain Lion \+1; Review status: Mixed review/,
  );
});

When('the image filter limits Tag state to Questionable only', async ({ page }) => {
  if (!(await page.getByLabel('Tag state').isVisible())) await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByLabel('Tag state').selectOption('questionable');
});

When('the image filter limits Tag state to Not questionable only', async ({ page }) => {
  if (!(await page.getByLabel('Tag state').isVisible())) await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByLabel('Tag state').selectOption('not-questionable');
});

Then('IMG001.JPG is absent from the Overview', async ({ page }) => {
  await expect(gridCell(page, 'IMG001.JPG')).toHaveCount(0);
});

When('the image filter is opened and searches species for {string}', async ({ page }, query: string) => {
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByLabel('Match text').fill(query);
  await page.getByLabel('Search in').selectOption('species');
});

Then('only the matching image remains in the Overview', async ({ page }) => {
  await expect(gridCell(page, 'IMG004.JPG')).toBeVisible();
  await expect(gridCell(page, 'IMG001.JPG')).toHaveCount(0);
  await expect(gridCell(page, 'IMG002.JPG')).toHaveCount(0);
});

When(
  'the image filter limits capture time to 2024-01-11 06 and untagged images',
  async ({ page }) => {
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('Capture year').fill('2024');
    await page.getByLabel('Capture month').fill('01');
    await page.getByLabel('Capture day').fill('11');
    await page.getByLabel('Capture hour').fill('06');
    await page.getByLabel('Tag state').selectOption('untagged');
  },
);

Then('only IMG005.JPG remains in the Overview', async ({ page }) => {
  await expect(gridCell(page, 'IMG005.JPG')).toBeVisible();
  await expect(gridCell(page, 'IMG004.JPG')).toHaveCount(0);
  await expect(gridCell(page, 'IMG001.JPG')).toHaveCount(0);
});

Then('no hidden images remain selected for bulk actions', async ({ page }) => {
  await expect(selectedTiles(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Time shift selection', exact: true })).toBeDisabled();
});

When('the only visible image is tagged and drops out of the filter', async ({ page }) => {
  await expect.poll(() => tileOrder(page)).toEqual(['IMG005.JPG']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await expect(page.getByText('No images match these filters.', { exact: true })).toBeVisible();
});

When('another species key is pressed with nothing left visible', async ({ page }) => {
  await page.keyboard.press('p');
});

Then(
  'the image that dropped out carries only the species given while it was visible',
  async ({ page }) => {
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('Tag state').selectOption('all');
    await expect(gridCell(page, 'IMG005.JPG')).toContainText('Mule Deer');
    // A tile carrying a second species reads "Mule Deer +1".
    await expect(gridCell(page, 'IMG005.JPG')).not.toContainText('+1');
  },
);

When('the image filter searches all fields for {string}', async ({ page }, query: string) => {
  if (!(await page.getByLabel('Match text').isVisible()))
    await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByLabel('Match text').fill(query);
});

When('the image filter searches filenames only for {string}', async ({ page }, query: string) => {
  await page.getByLabel('Match text').fill(query);
  await page.getByLabel('Search in').selectOption('filename');
});

Then('only {string} remains in the Overview', async ({ page }, fileName: string) => {
  await expect.poll(() => tileOrder(page)).toEqual([fileName]);
});

Then('no images match the image filter', async ({ page }) => {
  await expect(page.getByText('No images match these filters.', { exact: true })).toBeVisible();
});

When('the image filter is opened and dismissed with Escape', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Match text').press('Escape');
});

Then('the Filter control is collapsed and focused', async ({ page }) => {
  const control = page.getByRole('button', { name: 'Filter', exact: true });
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(control).toBeFocused();
});

When('the image filter limits Focus to the 2024-01-11 06 images', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Capture year').fill('2024');
  await page.getByLabel('Capture month').fill('01');
  await page.getByLabel('Capture day').fill('11');
  await page.getByLabel('Capture hour').fill('06');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
});

When('the next filtered image key is pressed in Focus', async ({ page }) => {
  await page.keyboard.press('ArrowDown');
});

Then('IMG005.JPG is the focused filtered image', async ({ page }) => {
  await expect(page.locator('.react-transform-component img')).toHaveAttribute('alt', 'IMG005.JPG');
  await expect(listRow(page, 'IMG001.JPG')).toHaveCount(0);
});

// --- Filtered-Overview navigation skips hidden raw-list neighbors (#442) ----

When('the image filter limits the Overview to untagged images', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Tag state').selectOption('untagged');
  await page.keyboard.press('Escape');
});

When('the image filter limits the Overview to tagged images', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Tag state').selectOption('tagged');
  await page.keyboard.press('Escape');
});

// Untagged matches, in list order: IMG002, IMG005, VID001 — IMG003/IMG004
// (both tagged) sit between the first and second match, hiding the raw-list
// neighbor the old code would have stepped to.
When('the first untagged match is focused', async ({ page }) => {
  await gridCell(page, 'IMG002.JPG').click();
});

Then('the second untagged match is focused', async ({ page }) => {
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG005.JPG');
});

// Tagged matches, in list order: IMG001, IMG003, IMG004 — IMG002 (untagged,
// between IMG001 and IMG003) is the raw-list neighbor the filter hides.
When('the first matching image in the Overview is focused', async ({ page }) => {
  await gridCell(page, 'IMG001.JPG').click();
});

When("it is tagged with a species it doesn't already carry", async ({ page }) => {
  await page.keyboard.press('p'); // Mountain Lion — IMG001 only carries Mule Deer
});

Then('the next matching image is focused, skipping the one the filter hides', async ({ page }) => {
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG003.JPG');
});

When('the image filter is opened in a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 860 });
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
});

Then('the image filter panel stays within the viewport', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Image filters' });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

Then('the workspace shows the position of the focused image within the upload', async ({ page }) => {
  await expect(positionReadout(page)).toHaveText('1 / 6');
  await gridCell(page, 'IMG003.JPG').click();
  await expect(positionReadout(page)).toHaveText('3 / 6');
});

Then('the Focus view keeps the species picker beside the enlarged image', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.locator('.react-transform-component img')).toBeVisible();
  await expect(page.locator('[data-testid="species-panel"]')).toBeVisible();
  await expect(listRow(page, 'IMG001.JPG')).toHaveCount(0);
  await expect(listRow(page, 'IMG005.JPG')).toHaveCount(0);
});

Given('an image has meaningful review markers', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await enterFocusView(page);
  await page.keyboard.press('Shift+Space');
  await page.getByRole('button', { name: 'Close Focus', exact: true }).click();
});

When('the detailed Overview list is opened', async ({ page }) => {
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: '☰ List' }).click();
  await expect(listRow(page, 'IMG002.JPG')).toBeVisible();
});

Then('list columns follow the Name, Type, Date, Species sort-control order', async ({ page }) => {
  const tagged = listRow(page, 'IMG001.JPG');
  expect(await tagged.locator('[data-column]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-column'))))
    .toEqual(['filename', 'media-type', 'timestamp', 'species', 'review-status', 'markers']);
  await expect(tagged.locator('[data-column="filename"]')).toHaveAttribute(
    'aria-label',
    'Filename: IMG001.JPG',
  );
  await expect(tagged.locator('[data-column="species"]')).toHaveAttribute(
    'aria-label',
    'Species: Mule Deer ×2',
  );
  const untagged = listRow(page, 'IMG002.JPG').locator('[data-column="species"]');
  await expect(untagged).toHaveText('untagged');
  await expect(untagged).toHaveAttribute('aria-label', 'Species: untagged');
  await expect(listRow(page, 'IMG002.JPG')).toHaveAttribute(
    'aria-label',
    /Filename: IMG002.JPG; Media type: image; Capture time:.*; Species: untagged/,
  );
});

Then('image and video rows identify their media type', async ({ page }) => {
  await expect(listRow(page, 'IMG001.JPG').locator('[data-column="media-type"]'))
    .toHaveAttribute('aria-label', 'Media type: image');
  await expect(listRow(page, 'VID001.MP4').locator('[data-column="media-type"]'))
    .toHaveAttribute('aria-label', 'Media type: video');
});

Then('capture timestamps show corrected and unavailable values accurately', async ({ page }) => {
  const corrected = listRow(page, 'IMG002.JPG').locator('[data-column="timestamp"]');
  await expect(corrected).toContainText('2023-12-24');
  await expect(corrected).toContainText('18:45');
  await expect(corrected).toHaveAttribute('aria-label', /Capture time: 2023-12-24T18:45:10/);

  const unavailable = listRow(page, 'VID001.MP4').locator('[data-column="timestamp"]');
  await expect(unavailable).toHaveText('—');
  await expect(unavailable).toHaveAttribute('aria-label', 'Capture time unavailable');
});

Then('long column values preserve their full accessible text', async ({ page }) => {
  const row = listRow(page, 'IMG004.JPG');
  await expect(row.locator('[data-column="filename"]')).toHaveAttribute('title', 'IMG004.JPG');
  const species = row.locator('[data-column="species"]');
  await expect(species).toHaveClass(/truncate/);
  await expect(species).toHaveAttribute('title', 'Mountain Lion +1');
  await expect(species).toHaveAttribute('aria-label', 'Species: Mountain Lion +1');
});

Then('row numbers and the old species indicator are absent', async ({ page }) => {
  const row = listRow(page, 'IMG002.JPG');
  await expect(row.locator('[data-column="row-number"]')).toHaveCount(0);
  await expect(row.locator('[data-column="species-indicator"]')).toHaveCount(0);
});

Then('meaningful edit and questionable markers remain accessible', async ({ page }) => {
  const row = listRow(page, 'IMG002.JPG');
  await expect(row.locator('[data-column="markers"]').getByLabel('Unsaved edit')).toBeVisible();
  await expect(row.getByLabel('Questionable', { exact: true })).toBeVisible();
  await expect(row.locator('[data-column="markers"]').locator('[title]')).toHaveCount(1);
});

Then('a narrow Overview keeps filenames visible in its compact rows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const row = listRow(page, 'IMG002.JPG');
  const filename = row.locator('[data-column="filename"]');
  await expect(filename).toBeVisible();
  // ResizeObserver updates the compact-row layout after the viewport resize.
  await expect.poll(async () => (await filename.boundingBox())?.width ?? 0)
    .toBeGreaterThan(80);
  await expect(row.locator('[data-column="species"]')).toBeVisible();
  await expect(row.locator('[data-column="media-type"]')).toHaveCount(0);
  await expect(row.locator('[data-column="timestamp"]')).toHaveCount(0);
  await expect(row).toHaveAttribute(
    'aria-label',
    /Filename: IMG002.JPG; Species: untagged; Unsaved edit/,
  );
});

Then('the Focus strip keeps filename and species but omits the detail columns', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Focus image viewer' })).toContainText('IMG002.JPG');
  await expect(page.locator('[data-testid="species-panel"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close Focus', exact: true }).click();
});

// --- Keyboard navigation ----------------------------------------------------

When('the next-image or previous-image key is pressed', async ({ page }) => {
  await page.keyboard.press('ArrowDown');
});

Then('focus moves one image in that direction', async ({ page }) => {
  await expect(positionReadout(page)).toHaveText('2 / 6');
  await page.keyboard.press('ArrowUp');
  await expect(positionReadout(page)).toHaveText('1 / 6');
});

Then('Left and Right also move one image in that direction', async ({ page }) => {
  await page.keyboard.press('ArrowRight');
  await expect(positionReadout(page)).toHaveText('2 / 6');
  await page.keyboard.press('ArrowLeft');
  await expect(positionReadout(page)).toHaveText('1 / 6');
});

Then('it stops at the first and last image of the upload', async ({ page }) => {
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(positionReadout(page)).toHaveText('1 / 6');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
  await expect(positionReadout(page)).toHaveText('6 / 6');
});

Then('any selection is cleared by the move', async ({ page }) => {
  await gridCell(page, 'IMG001.JPG').click();
  await gridCell(page, 'IMG003.JPG').click({ modifiers: ['Shift'] });
  await expect(positionReadout(page)).toHaveText('3 selected');
  await page.keyboard.press('ArrowDown');
  await expect(positionReadout(page)).toHaveText('4 / 6');
  await expect(selectedTiles(page)).toHaveCount(0);
});

Given('the Overview is shown', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

Given('the workspace has a browser history entry', async ({ page }) => {
  await page.evaluate(() => window.history.pushState({ workspace: true }, '', window.location.href));
});

When('the focused image is opened', async ({ page }) => {
  await gridCell(page, 'IMG003.JPG').click();
  await page.keyboard.press('Enter');
});

When('the bound species key is pressed in Focus', async ({ page }) => {
  await page.keyboard.press('d');
});

Then('the Focus viewer remains open', async ({ page }) => {
  await expect(page.getByRole('dialog', { name: 'Focus image viewer' })).toBeVisible();
});

Then('the focused image carries that species at count one', async ({ page }) => {
  await expect
    .poll(async () => {
      const drafts = (await readStore(page, 'drafts')) as {
        mediaPath: string;
        observations: { scientificName: string; count: number }[];
      }[];
      return drafts
        .find((draft) => draft.mediaPath.endsWith('IMG003.JPG'))
        ?.observations.find((observation) => observation.scientificName === 'Odocoileus hemionus')
        ?.count;
    })
    .toBe(1);
});

When('the browser Back button is pressed', async ({ page }) => {
  await page.goBack();
});

Then('the Focus viewer is closed and the Overview is shown', async ({ page }) => {
  await expect(page.getByRole('dialog', { name: 'Focus image viewer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

Then('the image opener has focus again', async ({ page }) => {
  await expect(gridCell(page, 'IMG003.JPG')).toBeFocused();
});

Then('Tab wraps within the Focus viewer at both boundaries', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Focus image viewer' });
  await expect(dialog).toBeVisible();
  const focusable = dialog.locator(
    'button:not([disabled]):visible, [href]:visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible',
  );
  await expect(focusable).not.toHaveCount(0);
  const first = focusable.first();
  const last = focusable.last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close Focus' })).toBeFocused();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
});

When('Escape is pressed in Focus', async ({ page }) => {
  await page.keyboard.press('Escape');
});

When('the Close Focus control is clicked', async ({ page }) => {
  await page.getByRole('button', { name: 'Close Focus' }).click();
});

Then('the Focus view shows that image', async ({ page }) => {
  await expect(page.getByRole('dialog', { name: 'Focus image viewer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close Focus' })).toBeFocused();
  await expect(page.locator('.react-transform-component img')).toHaveAttribute(
    'alt',
    'IMG003.JPG',
  );
});

Then('on-screen previous and next controls move between images there at every viewport size', async ({ page }) => {
  const previous = page.getByRole('button', { name: 'Previous image' });
  const next = page.getByRole('button', { name: 'Next image' });
  await expect(previous).toHaveAttribute('title', 'Previous image (ArrowLeft or ArrowUp)');
  await expect(next).toHaveAttribute('title', 'Next image (ArrowRight or ArrowDown)');
  await expect(previous).toHaveAttribute('aria-describedby', 'focus-navigation-help');
  await expect(next).toHaveAttribute('aria-describedby', 'focus-navigation-help');
  await expect(page.locator('#focus-navigation-help')).toHaveText(
    'Use ArrowLeft or ArrowUp for the previous image. Use ArrowRight or ArrowDown for the next image.',
  );
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();
  await next.click();
  await expect(positionReadout(page)).toHaveText('4 / 6');
  await previous.click();
  await expect(positionReadout(page)).toHaveText('3 / 6');
  await page.keyboard.press('ArrowRight');
  await expect(positionReadout(page)).toHaveText('4 / 6');
  await page.keyboard.press('ArrowLeft');
  await expect(positionReadout(page)).toHaveText('3 / 6');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await expect(positionReadout(page)).toHaveText('1 / 6');
  await expect(previous).toHaveCount(0);
  await expect(next).toBeVisible();
  await next.click();
  await expect(positionReadout(page)).toHaveText('2 / 6');
  await previous.click();
  await expect(positionReadout(page)).toHaveText('1 / 6');
  await expect(next).toBeFocused();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(positionReadout(page)).toHaveText('6 / 6');
  await expect(next).toHaveCount(0);
  await expect(previous).toBeVisible();
  await previous.click();
  await expect(positionReadout(page)).toHaveText('5 / 6');
  await next.click();
  await expect(positionReadout(page)).toHaveText('6 / 6');
  await expect(previous).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.setViewportSize(TOUCH);
  const touchPrevious = page.getByRole('button', { name: 'Previous image' });
  const touchNext = page.getByRole('button', { name: 'Next image' });
  await expect(touchPrevious).toBeVisible();
  await expect(touchNext).toBeVisible();
  const [canvas, previousBox, nextBox] = await Promise.all([
    page.getByTestId('focus-drop-zone').boundingBox(),
    touchPrevious.boundingBox(),
    touchNext.boundingBox(),
  ]);
  expect(canvas).not.toBeNull();
  expect(previousBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  if (canvas && previousBox && nextBox) {
    expect(previousBox.x).toBeGreaterThanOrEqual(canvas.x);
    expect(previousBox.x + previousBox.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(nextBox.x).toBeGreaterThanOrEqual(canvas.x);
    expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(previousBox.x + previousBox.width).toBeLessThan(nextBox.x);
    expect(previousBox.width).toBeGreaterThanOrEqual(40);
    expect(nextBox.width).toBeGreaterThanOrEqual(40);
  }
  await page.setViewportSize(DESKTOP);
  await page.getByRole('button', { name: 'Close Focus' }).click();
  await expect(page.getByRole('dialog', { name: 'Focus image viewer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

// --- Sorting ----------------------------------------------------------------

When('a sort field is chosen', async ({ page }) => {
  await page.getByRole('button', { name: /^Date/ }).click();
});

Then('the images are ordered by that field', async ({ page }) => {
  // Ascending by capture time; the clip has none, so it sorts first.
  await expect.poll(async () => (await tileOrder(page))[0]).toBe('VID001.MP4');
  expect((await tileOrder(page)).slice(1)).toEqual([
    'IMG001.JPG',
    'IMG002.JPG',
    'IMG003.JPG',
    'IMG004.JPG',
    'IMG005.JPG',
  ]);
});

Then('choosing the same field again reverses the order', async ({ page }) => {
  await page.getByRole('button', { name: /^Date/ }).click();
  await expect.poll(async () => (await tileOrder(page))[0]).toBe('IMG005.JPG');
});

Then('images that tie keep their original file order', async ({ page }) => {
  await page.getByRole('button', { name: /^Type/ }).click();
  const order = await tileOrder(page);
  expect(order.slice(0, 5)).toEqual([
    'IMG001.JPG',
    'IMG002.JPG',
    'IMG003.JPG',
    'IMG004.JPG',
    'IMG005.JPG',
  ]);
  expect(order[5]).toBe('VID001.MP4');
});

Given('some images are selected and one is focused', async ({ page, scratch }) => {
  await gridCell(page, 'IMG002.JPG').click();
  await gridCell(page, 'IMG004.JPG').click({ modifiers: ['Shift'] });
  await expect(positionReadout(page)).toHaveText('3 selected');
  scratch.selectedBefore = await selectedTiles(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute('title') ?? ''),
  );
  scratch.focusedBefore = await focusedName(page);
});

When('the sort order is changed', async ({ page }) => {
  await page.getByRole('button', { name: /^Date/ }).click();
  await expect.poll(async () => (await tileOrder(page))[0]).toBe('VID001.MP4');
});

Then('the same images remain selected', async ({ page, scratch }) => {
  // The re-map runs in an effect after the re-ordered strip commits, so poll.
  await expect
    .poll(async () =>
      (
        await selectedTiles(page).evaluateAll((els) =>
          els.map((e) => e.getAttribute('title') ?? ''),
        )
      )
        .slice()
        .sort(),
    )
    .toEqual((scratch.selectedBefore as string[]).slice().sort());
  const after = await selectedTiles(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute('title') ?? ''),
  );
  expect(after.length).toBe((scratch.selectedBefore as string[]).length);
});

Then('the same image remains focused, at its new position', async ({ page, scratch }) => {
  await expect.poll(async () => focusedName(page)).toBe(scratch.focusedBefore as string);
  // IMG004 sits fifth once the untimed clip sorts to the front.
  await expect(positionReadout(page)).toHaveText('3 selected');
  await page.keyboard.press('Escape');
  await expect(positionReadout(page)).toHaveText('5 / 6');
});

// --- Find by file name ------------------------------------------------------

When('part of a file name is typed into the image search', async ({ page }) => {
  await imageSearch(page).fill('IMG00');
});

Then('focus jumps to the first matching image', async ({ page }) => {
  await expect.poll(async () => focusedName(page)).toBe('IMG001.JPG');
});

Then('the number of matches and the current match position are shown', async ({ page }) => {
  await expect(page.getByText('1/5')).toBeVisible();
});

Then('the matches can be cycled forwards and backwards', async ({ page }) => {
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.getByText('2/5')).toBeVisible();
  await expect.poll(async () => focusedName(page)).toBe('IMG002.JPG');
  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(page.getByText('1/5')).toBeVisible();
  await expect.poll(async () => focusedName(page)).toBe('IMG001.JPG');
});

Then("clearing the search leaves the upload's order untouched", async ({ page }) => {
  const before = await tileOrder(page);
  await page.getByRole('button', { name: 'Clear image search' }).click();
  await expect(imageSearch(page)).toHaveValue('');
  expect(await tileOrder(page)).toEqual(before);
});

Given('the image search is not focused', async ({ page }) => {
  await gridCell(page, 'IMG001.JPG').click();
  await expect(imageSearch(page)).not.toBeFocused();
});

When('{string} is pressed', async ({ page }, key: string) => {
  await page.keyboard.press(key);
});

Then('the image search has the keyboard focus', async ({ page }) => {
  await expect(imageSearch(page)).toBeFocused();
});

// --- Mouse selection --------------------------------------------------------

When('an image is clicked', async ({ page }) => {
  await gridCell(page, 'IMG002.JPG').click();
});

Then('only that image is selected as the focus', async ({ page }) => {
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG002.JPG');
  await expect(selectedTiles(page)).toHaveCount(0);
  await expect(positionReadout(page)).toHaveText('2 / 6');
});

Then('an additive click on another image selects both images', async ({ page }) => {
  await gridCell(page, 'IMG004.JPG').click({ modifiers: ['ControlOrMeta'] });
  await expect(positionReadout(page)).toHaveText('2 selected');
  await expect(selectedTiles(page)).toHaveCount(2);
  expect(await selectedTiles(page).evaluateAll((els) => els.map((el) => el.getAttribute('title'))))
    .toEqual(['IMG002.JPG', 'IMG004.JPG']);
});

Then('shift-clicking another image selects the whole range between them', async ({ page }) => {
  await gridCell(page, 'IMG004.JPG').click({ modifiers: ['Shift'] });
  await expect(positionReadout(page)).toHaveText('3 selected');
  const titles = await selectedTiles(page).evaluateAll((els) =>
    els.map((e) => e.getAttribute('title') ?? ''),
  );
  expect(titles.sort()).toEqual(['IMG002.JPG', 'IMG003.JPG', 'IMG004.JPG']);
});

Then(
  'command- or control-clicking adds or removes a single image from the selection',
  async ({ page }) => {
    await gridCell(page, 'IMG001.JPG').click({ modifiers: ['ControlOrMeta'] });
    await expect(positionReadout(page)).toHaveText('4 selected');
    await gridCell(page, 'IMG001.JPG').click({ modifiers: ['ControlOrMeta'] });
    await expect(positionReadout(page)).toHaveText('3 selected');
  },
);

Then(
  'a selected count is shown in place of the position when a selection exists',
  async ({ page }) => {
    await gridCell(page, 'IMG001.JPG').click();
    await expect(positionReadout(page)).toHaveText('1 / 6');
    await gridCell(page, 'IMG002.JPG').click({ modifiers: ['Shift'] });
    await expect(positionReadout(page)).toHaveText('2 selected');
  },
);

Then('pressing Escape clears the selection', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(positionReadout(page)).toHaveText('2 / 6');
  await expect(selectedTiles(page)).toHaveCount(0);
});

Then(
  'an on-screen control adds or removes the focused image from the selection on touch',
  async ({ page }) => {
    await page.setViewportSize(TOUCH);
    const toggle = page.locator(
      'button[title="Add or remove this image from the selection"]',
    );
    await toggle.click();
    await expect(positionReadout(page)).toHaveText('1 selected');
    await expect(toggle).toContainText('In selection');
    await toggle.click();
    await expect(positionReadout(page)).toHaveText('2 / 6');
    await page.setViewportSize(DESKTOP);
  },
);

// --- Bursts -----------------------------------------------------------------

Then(
  'images from the same camera taken within the configured window are banded together',
  async ({ page }) => {
    await expect(page.getByText(/^Burst 1 ·/)).toContainText('2 img');
    await expect(page.locator('div').filter({ hasText: /^Burst \d+ ·/ })).not.toHaveCount(0);
  },
);

Then('each band states how many images it holds and the time it spans', async ({ page }) => {
  await expect(page.getByText(/^Burst 1 ·/)).toHaveText('Burst 1 · 2 img · 08:00–08:00');
  await expect(page.getByText(/^Burst 2 ·/)).toHaveText('Burst 2 · 1 img · 22:15');
});

Then('the whole band can be selected in one action', async ({ page }) => {
  await page
    .locator('div')
    .filter({ hasText: /^Burst 1 · / })
    .last()
    .getByRole('button', { name: 'select' })
    .click();
  await expect(positionReadout(page)).toHaveText('2 selected');
});

Then('the burst-forward and burst-back keys jump between bands', async ({ page }) => {
  await page.keyboard.press('Escape');
  await gridCell(page, 'IMG001.JPG').click();
  await page.keyboard.press('PageDown');
  await expect(positionReadout(page)).toHaveText('3 / 6');
  await page.keyboard.press('PageDown');
  await expect(positionReadout(page)).toHaveText('4 / 6');
  await page.keyboard.press('PageUp');
  await expect(positionReadout(page)).toHaveText('3 / 6');
});

Given('an image has no capture time', async ({ page }) => {
  // Bands only exist with grouping on, which is off by default.
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page
    .locator('label')
    .filter({ hasText: 'Group rapid sequences into bursts' })
    .locator('input[type="checkbox"]')
    .check();
  await page.getByRole('button', { name: 'Tag', exact: true }).first().click();
  await expect(page.getByText(/^Burst 1 ·/)).toBeVisible();
  await expect(gridCell(page, 'VID001.MP4')).toBeVisible();
});

Then('it starts a new burst rather than joining the previous one', async ({ page }) => {
  await expect(page.getByText(/^Burst 4 ·/)).toHaveText('Burst 4 · 1 img · —');
  await expect(page.getByText(/^Burst 3 ·/)).toContainText('2 img');
  await expect(page.getByText(/^Burst 5 ·/)).toHaveCount(0);
});

// --- Cheatsheet -------------------------------------------------------------

const cheatsheet = (page: Page) =>
  page.locator('div[role="dialog"][aria-label="Keyboard shortcuts"]');

When('the help key is pressed or the on-screen help control is used', async ({ page }) => {
  await page.keyboard.press('?');
  await expect(cheatsheet(page)).toBeVisible();
});

Then('the shortcut reference is shown, grouped by navigating, tagging and selecting', async ({
  page,
}) => {
  await expect(cheatsheet(page).getByRole('heading', { name: 'Navigate' })).toBeVisible();
  await expect(cheatsheet(page).getByRole('heading', { name: 'Tag', exact: true })).toBeVisible();
  await expect(cheatsheet(page).getByRole('heading', { name: 'Select & save' })).toBeVisible();
  for (const key of ['↓', '→', '↑', '←', 'PgDn', 'PgUp', '⇧Space']) {
    await expect(cheatsheet(page).getByText(key, { exact: true })).toBeVisible();
  }
  for (const retired of ['J', 'K', '⇧J', '⇧K', 'X']) {
    await expect(cheatsheet(page).getByText(retired, { exact: true })).toHaveCount(0);
  }
});

Then(
  'it can be dismissed with the same key, with Escape, or with its close control',
  async ({ page }) => {
    await page.keyboard.press('?');
    await expect(cheatsheet(page)).toHaveCount(0);

    await page.keyboard.press('?');
    await expect(cheatsheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(cheatsheet(page)).toHaveCount(0);

    await page.keyboard.press('?');
    await cheatsheet(page).getByRole('button', { name: 'Close' }).click();
    await expect(cheatsheet(page)).toHaveCount(0);
  },
);

Then('no tagging or navigation keystroke takes effect while it is open', async ({ page }) => {
  await page.keyboard.press('?');
  await expect(cheatsheet(page)).toBeVisible();
  const position = await positionReadout(page).textContent();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('d');
  await expect(positionReadout(page)).toHaveText(position!);
  await expect(page.getByText(/unsaved · discard/)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

// --- Typing suppresses accelerators -----------------------------------------

Given('the cursor is in a text field', async ({ page }) => {
  await speciesFilter(page).click();
  await expect(speciesFilter(page)).toBeFocused();
});

Then('letter keys type into that field rather than applying species', async ({ page }) => {
  await page.keyboard.type('dg');
  await expect(speciesFilter(page)).toHaveValue('dg');
  await expect(page.getByText(/unsaved · discard/)).toHaveCount(0);
  await speciesFilter(page).fill('');
});

Then(
  'pressing Enter in the species filter applies the top match and leaves the field',
  async ({ page }) => {
    await speciesFilter(page).fill('coyote');
    await page.keyboard.press('Enter');
    await expect(speciesFilter(page)).not.toBeFocused();
    // IMG001 already carried Mule Deer, so Coyote lands as the extra species.
    await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×2 +1');
    await expect(
      speciesRow(page, 'Canis latrans').locator('[aria-label="Applied"]'),
    ).toBeVisible();
  },
);

Then(
  'pressing Enter in the image search moves to the next match instead of tagging',
  async ({ page }) => {
    await imageSearch(page).fill('IMG00');
    await expect(page.getByText('1/5')).toBeVisible();
    const dirtyBefore = await page.getByText(/unsaved · discard/).textContent();
    await imageSearch(page).press('Enter');
    await expect(page.getByText('2/5')).toBeVisible();
    await expect(page.getByText(/unsaved · discard/)).toHaveText(dirtyBefore!);
  },
);

// --- Media / dialogs own the keyboard ---------------------------------------

Given('a video is being played or scrubbed', async ({ page }) => {
  await focusFrame(page, 'VID001.MP4');
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.locator('video[controls]')).toBeVisible();
  const video = page.locator('video[controls]');
  await video.focus();
  // Focus must remain owned by the media after deferred rendering settles.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(video).toBeFocused();
});

Then('its own playback keys work and no tagging keystroke fires', async ({ page }) => {
  const video = page.locator('video[controls]');
  await expect(video).toBeFocused();
  await page.keyboard.press('d');
  await expect(video).toBeFocused();
  await page.keyboard.press(' ');
  await expect(video).toBeFocused();
  await expect(page.getByText(/unsaved · discard/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Focus', exact: true }).click();
  await expect(gridCell(page, 'VID001.MP4')).toHaveAttribute('title', 'VID001.MP4');
});

Then(
  'while the sync, snapshots or time-shift dialog is open no image behind it is tagged or navigated',
  async ({ page }) => {
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await focusFrame(page, 'IMG002.JPG');
    const position = await positionReadout(page).textContent();

    for (const [open, close] of [
      ['Sync…', 'Cancel'],
      ['Snapshots…', 'Close'],
      ['Time shift', 'Cancel'],
    ] as const) {
      await page.getByRole('button', { name: open, exact: true }).click();
      await page.keyboard.press('d');
      await page.keyboard.press('ArrowDown');
      await expect(page.getByText(/unsaved · discard/)).toHaveCount(0);
      await expect(positionReadout(page)).toHaveText(position!);
      await page.getByRole('button', { name: close, exact: true }).first().click();
      await expect(page.getByRole('button', { name: close, exact: true })).toHaveCount(0);
    }
    await expect(gridCell(page, 'IMG002.JPG')).not.toContainText('Mule Deer');
  },
);

Given('a slider in the Adjust popup is focused', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await enterFocusView(page);
  await page.getByRole('button', { name: 'Adjust ▾' }).click();
  await page.getByLabel('Brightness').focus();
  await expect(page.getByLabel('Brightness')).toBeFocused();
});

Then('a species key still applies that species to the focused image', async ({ page }) => {
  await page.keyboard.press('d');
  await expect(page.getByRole('dialog', { name: 'Focus image viewer' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mule Deer Odocoileus hemionus/ })).toBeVisible();
  await expect.poll(async () => {
    const drafts = (await readStore(page, 'drafts')) as {
      mediaPath: string;
      observations: { scientificName: string }[];
    }[];
    return drafts.find((draft) => draft.mediaPath.endsWith('IMG002.JPG'))?.observations
      .some((observation) => observation.scientificName === 'Odocoileus hemionus') ?? false;
  }).toBe(true);
});

Then('Home, End, Page Up, Page Down, and arrow keys adjust the slider rather than navigating images', async ({ page }) => {
  const position = await positionReadout(page).textContent();
  const slider = page.getByLabel('Brightness');
  const expectSameFocus = () => expect(positionReadout(page)).toHaveText(position!);
  const expectSliderFocused = async () => {
    await expect(slider).toBeVisible();
    await expect(slider).toBeFocused();
  };

  await page.keyboard.press('Home');
  await expectSliderFocused();
  await expect(slider).toHaveValue('0');
  await page.keyboard.press('End');
  await expectSliderFocused();
  await expect(slider).toHaveValue('100');

  await page.keyboard.press('PageDown');
  await expectSliderFocused();
  const afterPageDown = Number(await slider.inputValue());
  expect(afterPageDown).toBeLessThan(100);
  await page.keyboard.press('PageUp');
  await expectSliderFocused();
  expect(Number(await slider.inputValue())).toBeGreaterThan(afterPageDown);

  const beforeArrow = Number(await slider.inputValue());
  // ArrowDown is also the next-image hotkey — proves the slider claims it
  // instead of the tagger navigating away.
  await page.keyboard.press('ArrowDown');
  await expectSliderFocused();
  const afterArrowDown = Number(await slider.inputValue());
  expect(afterArrowDown).toBeLessThan(beforeArrow);
  await expectSameFocus();

  await page.keyboard.press('ArrowUp');
  await expectSliderFocused();
  const afterArrowUp = Number(await slider.inputValue());
  expect(afterArrowUp).toBeGreaterThan(afterArrowDown);
  await expectSameFocus();

  await page.keyboard.press('ArrowLeft');
  await expectSliderFocused();
  const afterArrowLeft = Number(await slider.inputValue());
  expect(afterArrowLeft).toBeLessThan(afterArrowUp);
  await expectSameFocus();

  await page.keyboard.press('ArrowRight');
  await expectSliderFocused();
  expect(Number(await slider.inputValue())).toBeGreaterThan(afterArrowLeft);
  await expectSameFocus();
});

Then('command- or control-S still saves while the slider is focused', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('saved ✓').first()).toBeVisible();
  await expect(page.getByLabel('Brightness')).toBeFocused();
});

Given('a burst is selected and a slider in the Adjust popup is focused', async ({ page, scratch }) => {
  await focusFrame(page, 'IMG002.JPG');
  await enterFocusView(page);
  await page.keyboard.press('ControlOrMeta+a');
  await expect(positionReadout(page)).toHaveText(/\d+ selected/);
  scratch.selectionReadout = await positionReadout(page).textContent();
  await page.getByRole('button', { name: 'Adjust ▾' }).click();
  await page.getByLabel('Brightness').focus();
  await expect(page.getByLabel('Brightness')).toBeFocused();
});

When('Escape is pressed with the slider focused', async ({ page }) => {
  await page.keyboard.press('Escape');
});

Then('the Adjust popup closes and the same images are still selected', async ({ page, scratch }) => {
  await expect(page.getByRole('dialog', { name: 'Image adjustments' })).toHaveCount(0);
  await expect(positionReadout(page)).toHaveText(scratch.selectionReadout as string);
});

Given('three untagged matches have hidden images between them', async ({ page }) => {
  await gridCell(page, 'IMG005.JPG').click();
  await page.keyboard.press('d');
  await gridCell(page, 'IMG004.JPG').click();
  await enterFocusView(page);
  await page.getByRole('button', { name: 'Clear Species', exact: true }).click();
  await page.getByRole('button', { name: 'Close Focus', exact: true }).click();
});

When('the second separated match is chosen', async ({ page }) => {
  await expect.poll(() => tileOrder(page)).toEqual(['IMG002.JPG', 'IMG004.JPG', 'VID001.MP4']);
  await gridCell(page, 'IMG004.JPG').click();
});
When('{string} is pressed in the filtered Overview', async ({ page }, key: string) => {
  await page.keyboard.press(key);
});
Then('the third separated match is focused', async ({ page }) => {
  await expect(focusedTile(page)).toHaveAttribute('title', 'VID001.MP4');
});
Then('the second separated match is focused', async ({ page }) => {
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG004.JPG');
});
When('the focused untagged image is identified', async ({ page }) => {
  await page.keyboard.press('d');
});
Then('the identified image has disappeared from the filtered Overview', async ({ page }) => {
  await expect(gridCell(page, 'IMG002.JPG')).toHaveCount(0);
});
When('the image filter excludes the video', async ({ page }) => {
  await page.locator('button[aria-controls="image-filter-panel"]').click();
  await page.getByLabel('Match text').fill('IMG');
  await page.getByLabel('Search in').selectOption('filename');
  await page.keyboard.press('Escape');
  await expect.poll(() => tileOrder(page)).toEqual(['IMG002.JPG', 'IMG005.JPG']);
});
When('the final image match is opened in {string}', async ({ page }, view: string) => {
  await gridCell(page, 'IMG005.JPG').click();
  if (view === 'Focus') await enterFocusView(page);
});
Then('exhausted focus stays on the image just identified in {string}', async ({ page }, view: string) => {
  if (view === 'Focus') {
    await expect(page.getByRole('dialog', { name: 'Focus image viewer' }).locator('.react-transform-component img')).toHaveAttribute('alt', 'IMG005.JPG');
    await expect(page.getByRole('button', { name: 'Previous image' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next image' })).toHaveCount(0);
  } else {
    await expect(positionReadout(page)).toHaveText('5 / 6');
    await expect(focusedTile(page)).toHaveCount(0);
  }
});
When('another species key is pressed after exhaustion', async ({ page }) => {
  await page.keyboard.press('p');
});
Then('only the original identification was applied and earlier matches remain untouched', async ({ page }) => {
  await expect.poll(async () => {
    const drafts = await readStore(page, 'drafts') as { mediaPath: string; observations: { scientificName: string; count: number }[] }[];
    return drafts.map((draft) => ({ file: draft.mediaPath.split('/').pop(), observations: draft.observations.map(({ scientificName, count }) => ({ scientificName, count })) }));
  }).toEqual([{ file: 'IMG005.JPG', observations: [{ scientificName: 'Odocoileus hemionus', count: 1 }] }]);
});
When('the previous filtered match is requested in {string}', async ({ page }, view: string) => {
  if (view === 'Focus') await page.getByRole('button', { name: 'Previous image' }).click();
  else await page.keyboard.press('ArrowUp');
});
Then('the earlier matching image is reachable in {string}', async ({ page }, view: string) => {
  if (view === 'Focus') {
    await expect(page.getByRole('dialog', { name: 'Focus image viewer' }).locator('.react-transform-component img')).toHaveAttribute('alt', 'IMG002.JPG');
    await expect(page.getByRole('button', { name: 'Close Focus' })).toBeFocused();
  } else await expect(focusedTile(page)).toHaveAttribute('title', 'IMG002.JPG');
});

When('the filter is narrowed to the earlier matching image', async ({ page }) => {
  await page.locator('button[aria-controls="image-filter-panel"]').click();
  await page.getByLabel('Match text').fill('IMG002');
  await page.keyboard.press('Escape');
});

When('both image matches are selected with the earlier match focused', async ({ page }) => {
  await gridCell(page, 'IMG005.JPG').click();
  await gridCell(page, 'IMG002.JPG').click({ modifiers: ['ControlOrMeta'] });
  await expect(selectedTiles(page)).toHaveCount(2);
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG002.JPG');
});

Then('exhausted bulk focus stays at the earlier image and all matches are removed', async ({ page }) => {
  await expect(page.getByText('No images match these filters.', { exact: true })).toBeVisible();
  await expect(positionReadout(page)).toHaveText('2 / 6');
  await expect(selectedTiles(page)).toHaveCount(0);
  await expect.poll(async () => {
    const drafts = await readStore(page, 'drafts') as { mediaPath: string; observations: { scientificName: string; count: number }[] }[];
    return drafts.map((draft) => ({ file: draft.mediaPath.split('/').pop(), observations: draft.observations.map(({ scientificName, count }) => ({ scientificName, count })) }));
  }).toEqual([
    { file: 'IMG002.JPG', observations: [{ scientificName: 'Odocoileus hemionus', count: 1 }] },
    { file: 'IMG005.JPG', observations: [{ scientificName: 'Odocoileus hemionus', count: 1 }] },
  ]);
});

When('the images are sorted by Species ascending', async ({ page }) => {
  await page.getByRole('button', { name: /^Species/ }).click();
  await expect.poll(() => tileOrder(page)).toEqual(['IMG002.JPG', 'IMG005.JPG', 'VID001.MP4', 'IMG001.JPG', 'IMG003.JPG', 'IMG004.JPG']);
});

Then('the sorted exhausted focus remains on IMG005 in {string}', async ({ page }, view: string) => {
  if (view === 'Focus') {
    await expect(page.getByRole('dialog', { name: 'Focus image viewer' }).locator('.react-transform-component img')).toHaveAttribute('alt', 'IMG005.JPG');
  } else {
    await expect(positionReadout(page)).toHaveText('5 / 6');
    await expect(focusedTile(page)).toHaveCount(0);
  }
});
