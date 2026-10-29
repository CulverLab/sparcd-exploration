import type { Page, Locator } from '@playwright/test';
import { parseMedia } from '@sparcd/camtrap';
import {
  Given,
  When,
  Then,
  expect,
  gridCell,
  listRow,
  focusFrame,
  enterFocusView,
  sectionTab,
  positionReadout,
  openUpload,
  selectCollection,
  openFindFilter,
} from './support/world';
import { BUCKET, PREFIX_A, PREFIX_E, MEDIA_A, mediaCsv } from './support/data';
import {
  openSyncDialog,
  waitForAutomaticSave,
  setSyncDryRun,
  readStore,
  waitForDirtyDrafts,
  waitForSyncDialogClosed,
  writeStore,
} from './support/flows';

const timeShiftButton = (page: Page) =>
  page
    .locator(
      'button[title$="by a signed offset"], button[title^="Upload time shift is active"], button[title^="No image in this upload"]',
    )
    .first();

const uploadShiftModal = (page: Page) =>
  page.locator('div[role="dialog"][aria-label="Time shift"]');

const selectionShiftModal = (page: Page) =>
  page.getByRole('dialog', { name: 'Time shift · selection' });

const perImageTime = (page: Page) => page.locator('span.font-mono.font-\\[600\\]').first();

async function bump(modal: ReturnType<typeof uploadShiftModal>, label: string, times: number) {
  for (let i = 0; i < times; i++) await modal.getByRole('button', { name: `Increase ${label}` }).click();
}

async function openFocus(page: Page): Promise<void> {
  await enterFocusView(page);
}

async function closeFocus(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close Focus', exact: true });
  if (await close.count()) {
    await close.click();
    await expect(page.getByRole('dialog', { name: 'Focus image viewer' })).toHaveCount(0);
  }
}

async function showFrame(page: Page, file: string): Promise<void> {
  await closeFocus(page);
  await gridCell(page, file).click();
  await openFocus(page);
}

/** The corrected time the Focus footer currently shows for the focused frame. */
async function shownTime(page: Page): Promise<string> {
  const text = (await page.locator('div.mt-1 span.flex.flex-col').first().innerText()) ?? '';
  // The prominent line is the corrected time; the badge ("shifted" / "image
  // override") and the struck-through original follow it.
  return text.match(/\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}(?::\d{2})?/)?.[0] ?? text.split('\n')[0].trim();
}

// --- Whole-upload shift -----------------------------------------------------

When('the time-shift dialog is opened', async ({ page }) => {
  await timeShiftButton(page).click();
  await expect(uploadShiftModal(page)).toBeVisible();
});

Then(
  'a signed offset in years, months, days, hours, minutes and seconds can be set',
  async ({ page }) => {
    for (const label of ['Year', 'Month', 'Day', 'Hour', 'Min', 'Sec']) {
      await expect(
        uploadShiftModal(page).getByRole('button', { name: `Increase ${label}` }),
      ).toBeVisible();
      await expect(
        uploadShiftModal(page).getByRole('button', { name: `Decrease ${label}` }),
      ).toBeVisible();
    }
    await bump(uploadShiftModal(page), 'Hour', 1);
    await uploadShiftModal(page).getByRole('button', { name: 'Decrease Min' }).click();
    await expect(uploadShiftModal(page)).toContainText('+1h -1m');
  },
);

Then(
  'a sample capture time is shown before and after the shift as the offset changes',
  async ({ page }) => {
    const preview = uploadShiftModal(page).locator('div.border.bg-panel').first();
    await expect(preview).toContainText('2024-01-10 08:00');
    await expect(preview).toContainText('2024-01-10 08:59');
    await uploadShiftModal(page).getByRole('button', { name: 'Increase Min' }).click();
    await expect(preview).toContainText('2024-01-10 09:00');
  },
);

Then('applying it shifts every frame in the upload', async ({ page, s3 }) => {
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
  await waitForAutomaticSave(page);
  const rows = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`));
  expect(rows.find(row => row.mediaId.endsWith('IMG001.JPG'))!.timestamp).toBe('2024-01-10T09:00:00.000-07:00');
  expect(rows.find(row => row.mediaId.endsWith('VID001.MP4'))!.timestamp).toBe('');
});











/** Reasons stay hidden in the layout but are available to keyboard and pointer users. */
async function expectDisabledHint(page: Page, button: Locator, label: string, reason: string) {
  // Disabled actions are in the Overview toolbar. A Focus dialog makes that
  // background inert, so leave Focus before testing keyboard discovery.
  await closeFocus(page);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', reason);
  await expect(button).toHaveAccessibleDescription(reason);
  await expect(button).toHaveCSS('cursor', 'not-allowed');
  const target = page.getByRole('group', { name: `${label} unavailable`, exact: true });
  await expect(target).toHaveAccessibleDescription(reason);
  await page.getByRole('button', { name: 'Find & filter', exact: true }).focus();
  await expect(target).toHaveAttribute('tabindex', '0');
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveCount(0);
  await target.focus();
  await expect(target).toBeFocused();
  await expect(tooltip).toHaveText(reason);
  await expect(tooltip).toHaveCount(1);
  const position = await positionReadout(page).innerText();
  await page.keyboard.press('Enter'); await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(positionReadout(page)).toHaveText(position);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(target).toBeFocused();
  await page.getByRole('button', { name: 'Find & filter', exact: true }).focus();
  await target.hover(); await expect(tooltip).toHaveText(reason);
  await page.keyboard.press('Escape'); await expect(tooltip).toHaveCount(0);
  await page.mouse.move(0, 0); await target.hover(); await expect(tooltip).toHaveText(reason);
  await tooltip.hover(); await expect(tooltip).toBeVisible();
  await page.mouse.move(0, 0); await expect(tooltip).toHaveCount(0);
}

// --- Whole-upload shift is unavailable with nothing to shift (issue #302) --

Given('an upload with no capture times is open in the tagging workspace', async ({ page }) => {
  await sectionTab(page, 'Browse').click();
  await openUpload(page, 'camerauser');
});

Then('the whole-upload time shift is disabled with an explanation', async ({ page }) => {
  const button = timeShiftButton(page);
  await expectDisabledHint(page, button, 'Time shift', 'No image in this upload has a capture time to shift');
});



// --- Selection-scoped shift -------------------------------------------------

Given('a single image is focused with no selection', async ({ page }) => {
  await focusFrame(page, 'IMG001.JPG');
  await expect(positionReadout(page)).not.toContainText('selected');
});

Then('time shift selection is disabled with an explanation', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Time shift selection', exact: true });
  await expectDisabledHint(page, button, 'Time shift selection', 'Select one or more images to time shift');
});

Given('exactly one image is selected in the {string} Overview', async ({ page }, view: string) => {
  if (view === 'list') await page.getByRole('button', { name: '☰ List' }).click();
  if (view === 'narrow') await page.setViewportSize({ width: 390, height: 844 });
  const image = view === 'list' ? listRow(page, 'IMG001.JPG') : gridCell(page, 'IMG001.JPG');
  await image.click();
  const shift = page.getByRole('button', { name: 'Time shift selection', exact: true });
  await expect(shift).toBeDisabled();
  if (view === 'narrow') {
    await page.getByRole('button', { name: '＋ Select', exact: true }).click();
  } else {
    await image.click({ modifiers: ['ControlOrMeta'] });
  }
  await expect(positionReadout(page)).toHaveText('1 selected');
  await expect(shift).toBeEnabled();
});

When('that one-image selection is toggled off', async ({ page }) => {
  const touchToggle = page.getByRole('button', { name: '✓ In selection', exact: true });
  if (await touchToggle.isVisible()) {
    await touchToggle.click();
  } else {
    const tile = gridCell(page, 'IMG001.JPG');
    const image = await tile.count() ? tile : listRow(page, 'IMG001.JPG');
    await image.click({ modifiers: ['ControlOrMeta'] });
  }
  await expect(positionReadout(page)).not.toContainText('selected');
});

When('the selection is filtered down to IMG001.JPG', async ({ page }) => {
  await openFindFilter(page);
  await page.getByRole('group', { name: 'Search in' }).getByRole('radio', { name: 'Filename' }).check();
  await page.getByLabel('Match text').fill('IMG001.JPG');
  await page.getByLabel('Match text').press('Escape');
  await expect(gridCell(page, 'IMG002.JPG')).toHaveCount(0);
  await expect(gridCell(page, 'IMG003.JPG')).toHaveCount(0);
  await expect(positionReadout(page)).toHaveText('1 selected');
});

When('that one-frame selection is shifted', async ({ page }) => {
  await page.getByRole('button', { name: 'Time shift selection' }).click();
  await expect(selectionShiftModal(page)).toContainText('1 selected frame');
  await bump(selectionShiftModal(page), 'Hour', 1);
  await selectionShiftModal(page).getByRole('button', { name: 'Apply to 1 selected frame →' }).click();
});

Then('exactly that selected image receives a time override', async ({ page }) => {
  await waitForDirtyDrafts(page, 1);
  const drafts = (await readStore(page, 'drafts')) as {
    mediaPath: string;
    timeOverride: string | null;
  }[];
  expect(drafts).toHaveLength(1);
  expect(drafts[0].mediaPath).toMatch(/IMG001\.JPG$/);
  expect(drafts[0].timeOverride).toBe('2024-01-10T09:00:00.000-07:00');
});



When("the selection's time shift is applied", async ({ page }) => {
  await page.getByRole('button', { name: 'Time shift selection' }).click();
  await expect(selectionShiftModal(page)).toBeVisible();
  await bump(selectionShiftModal(page), 'Hour', 1);
  await selectionShiftModal(page).getByRole('button', { name: /^Apply to 3 selected/ }).click();
  await expect(selectionShiftModal(page)).toHaveCount(0);
});

When('the selected images are shown in Focus', async ({ page }) => {
  await openFocus(page);
  await expect(positionReadout(page)).toHaveText('3 selected');
  await closeFocus(page);
});

Then('time shift selection is enabled', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Time shift selection', exact: true })).toBeEnabled();
});

Then('the selection time-shift dialog opens', async ({ page }) => {
  await page.getByRole('button', { name: 'Time shift selection', exact: true }).click();
  await expect(selectionShiftModal(page)).toBeVisible();
  await expect(selectionShiftModal(page).getByRole('button', { name: 'Close' })).toBeFocused();
});

Then('the selection time-shift dialog confines focus and closes with Escape', async ({ page }) => {
  const dialog = selectionShiftModal(page);
  const close = dialog.getByRole('button', { name: 'Close' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Time shift selection', exact: true })).toBeFocused();
});

Then('only the selected frames move by the offset', async ({ page }) => {
  await waitForDirtyDrafts(page, 3);
  const drafts = (await readStore(page, 'drafts')) as { mediaPath: string; timeOverride: string | null }[];
  const overrides = Object.fromEntries(drafts.map((row) => [row.mediaPath.split('/').pop()!, row.timeOverride]));
  expect(Object.keys(overrides).sort()).toEqual(['IMG001.JPG', 'IMG002.JPG', 'IMG003.JPG']);
  expect(overrides).toMatchObject({
    'IMG001.JPG': '2024-01-10T09:00:00.000-07:00',
    'IMG002.JPG': '2024-01-10T09:00:30.000-07:00',
    'IMG003.JPG': '2024-01-10T23:15:00.000-07:00',
  });
  expect(overrides['IMG005.JPG']).toBeUndefined();
});

Then('each moves relative to the time it was already showing', async ({ page }) => {
  const drafts = (await readStore(page, 'drafts')) as { mediaPath: string; timeOverride: string | null }[];
  const overrides = Object.fromEntries(drafts.map((row) => [row.mediaPath.split('/').pop()!, row.timeOverride]));
  expect(overrides).toMatchObject({
    'IMG001.JPG': '2024-01-10T09:00:00.000-07:00',
    'IMG002.JPG': '2024-01-10T09:00:30.000-07:00',
    'IMG003.JPG': '2024-01-10T23:15:00.000-07:00',
  });
});

Then('the preview is anchored on the earliest selected frame', async ({ page }) => {
  await closeFocus(page);
  await gridCell(page, 'IMG003.JPG').click();
  await gridCell(page, 'IMG001.JPG').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Time shift selection' }).click();
  await expect(selectionShiftModal(page)).toContainText('Preview · earliest selected');
  await expect(selectionShiftModal(page).locator('div.line-through')).toContainText(
    '2024-01-10 09:00',
  );
  await selectionShiftModal(page).getByRole('button', { name: 'Cancel' }).click();
});

Given('the selection includes frames with no recorded capture time', async ({ page }) => {
  await gridCell(page, 'IMG005.JPG').click();
  await gridCell(page, 'VID001.MP4').click({ modifiers: ['Shift'] });
  await expect(positionReadout(page)).toHaveText('2 selected');
});

When('a selection shift is applied', async ({ page }) => {
  await page.getByRole('button', { name: 'Time shift selection' }).click();
  await expect(selectionShiftModal(page)).toBeVisible();
  await bump(selectionShiftModal(page), 'Hour', 1);
  await selectionShiftModal(page).getByRole('button', { name: /^Apply to 1 selected/ }).click();
});

Then('those frames are skipped', async ({ page }) => {
  const overrides = async () => {
    const drafts = (await readStore(page, 'drafts')) as {
      mediaPath: string;
      timeOverride: string | null;
    }[];
    return Object.fromEntries(
      drafts.map((d) => [d.mediaPath.split('/').pop()!, d.timeOverride]),
    ) as Record<string, string | null>;
  };
  await expect.poll(overrides).toEqual({ 'IMG005.JPG': '2024-01-11T07:00:30.000-07:00' });
});

Then('the dialog states that they are', async ({ page }) => {
  await gridCell(page, 'IMG005.JPG').click();
  await gridCell(page, 'VID001.MP4').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Time shift selection' }).click();
  await expect(selectionShiftModal(page)).toContainText(
    '1 selected frame without a capture time is skipped.',
  );
  await expect(selectionShiftModal(page)).toContainText('1 of 2 selected frames');
  await selectionShiftModal(page).getByRole('button', { name: 'Cancel' }).click();
});

Given('only timestamp-less images are selected', async ({ page }) => {
  await gridCell(page, 'VID001.MP4').click();
  await gridCell(page, 'VID001.MP4').click({ modifiers: ['ControlOrMeta'] });
  await expect(positionReadout(page)).toHaveText('1 selected');
});

Then('time shift selection is disabled because no selected frame has a capture time', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Time shift selection', exact: true });
  await expectDisabledHint(page, button, 'Time shift selection', 'None of the selected frames has a capture time to shift');
});

// --- Per-image override -----------------------------------------------------

















// --- Nothing stored until a sync --------------------------------------------









Given('a whole-upload shift is automatically saved', async ({ page, s3, scratch }) => {
  scratch.originalTimes = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).map(row => [row.mediaId, row.timestamp, row.timestampSource]);
  await timeShiftButton(page).click(); await bump(uploadShiftModal(page), 'Hour', 1);
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click(); await waitForAutomaticSave(page);
});
Then('all original capture times are restored', async ({ s3, scratch }) => {
  expect(parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`)).map(row => [row.mediaId, row.timestamp, row.timestampSource])).toEqual(scratch.originalTimes);
});

Then('the standing shift is cleared afterwards', async ({ page }) => {
  await expect(page.getByText(/clock \+/)).toHaveCount(0);
  await expect(timeShiftButton(page)).toContainText('Time shift');
  const uploads = (await readStore(page, 'uploads')) as { timeOffset: unknown }[];
  expect(uploads.every((u) => u.timeOffset === null)).toBe(true);
});

Then(
  'the images show their now-corrected stored times without a further shift',
  async ({ page, s3 }) => {
    await expect(page.getByTestId('overview-view')).toBeVisible();
    await expect(gridCell(page, 'IMG001.JPG')).toBeVisible();
    const media = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`));
    expect(media.find((m) => m.mediaId.endsWith('IMG001.JPG'))!.timestamp).toBe(
      '2024-01-10T09:00:00.000-07:00',
    );
  },
);

// --- Shifts do not re-band bursts -------------------------------------------

When('a whole-upload shift is applied', async ({ page, scratch }) => {
  scratch.bandsBefore = await page.getByText(/^Burst \d+ ·/).allTextContents();
  await timeShiftButton(page).click();
  await bump(uploadShiftModal(page), 'Hour', 1);
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
  await waitForAutomaticSave(page);
});

Then('the same images remain grouped together', async ({ page, scratch }) => {
  const before = scratch.bandsBefore as string[];
  const after = await page.getByText(/^Burst \d+ ·/).allTextContents();
  expect(after).toHaveLength(before.length);
  const sizes = (rows: string[]) => rows.map((r) => r.match(/· (\d+) img/)![1]);
  expect(sizes(after)).toEqual(sizes(before));
});

Then('only the times shown on the burst bands change', async ({ page, scratch }) => {
  const before = scratch.bandsBefore as string[];
  const after = await page.getByText(/^Burst \d+ ·/).allTextContents();
  expect(before[0]).toContain('08:00–08:00');
  expect(after[0]).toContain('09:00–09:00');
  expect(after[0]).not.toBe(before[0]);
});

Then('disabled time-shift hints are touch-readable and stay within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const target = page.getByRole('group', { name: 'Time shift selection unavailable', exact: true });
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText('Select one or more images to time shift');
    const bounds = (await tooltip.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390); expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach(); }
});
Then('only one time-shift explanation is visible at a time', async ({ page }) => {
  const upload = page.getByRole('group', { name: 'Time shift unavailable', exact: true });
  const selection = page.getByRole('group', { name: 'Time shift selection unavailable', exact: true });
  await upload.focus(); await expect(page.getByRole('tooltip')).toHaveText('No image in this upload has a capture time to shift');
  await selection.hover(); await expect(page.getByRole('tooltip')).toHaveCount(1);
  await expect(page.getByRole('tooltip')).toHaveText('Select one or more images to time shift');
});

When('the keyboard selects images while the disabled selection explanation has focus', async ({ page }) => {
  await page.getByRole('group', { name: 'Time shift selection unavailable', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A');
});
Then('the enabled selection time-shift button receives focus', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Time shift selection', exact: true });
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  await expect(page.getByRole('group', { name: 'Time shift selection unavailable', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});
