import type { Page } from '@playwright/test';
import { parseMedia } from '@sparcd/camtrap';
import {
  Given,
  When,
  Then,
  expect,
  gridCell,
  listRow,
  focusFrame,
  sectionTab,
  positionReadout,
} from './support/world';
import { BUCKET, PREFIX_A, MEDIA_A, mediaCsv } from './support/data';
import { openSyncDialog, setSyncDryRun, readStore } from './support/flows';

const timeShiftButton = (page: Page) =>
  page.locator('button[title$="by a signed offset"], button[title^="Upload time shift is active"]').first();

const uploadShiftModal = (page: Page) =>
  page.locator('div[role="dialog"][aria-label="Time shift"]');

const selectionShiftModal = (page: Page) =>
  page.locator('div[role="dialog"][aria-label="Time shift selection"]');

const perImageTime = (page: Page) => page.locator('span.font-mono.font-\\[600\\]').first();

async function bump(modal: ReturnType<typeof uploadShiftModal>, label: string, times: number) {
  for (let i = 0; i < times; i++) await modal.getByRole('button', { name: `Increase ${label}` }).click();
}

async function openFocus(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Adjust time' })).toBeVisible();
}

/** The corrected time the Focus footer currently shows for the focused frame. */
async function shownTime(page: Page): Promise<string> {
  const text = (await page.locator('div.mt-1 span.flex.flex-col').first().innerText()) ?? '';
  // The prominent line is the corrected time; the badge ("shifted" / "image
  // override") and the struck-through original follow it.
  return text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)?.[0] ?? text.split('\n')[0].trim();
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
    await expect(preview).toContainText('2024-01-10T08:00:00');
    await expect(preview).toContainText('2024-01-10T08:59:00');
    await uploadShiftModal(page).getByRole('button', { name: 'Increase Min' }).click();
    await expect(preview).toContainText('2024-01-10T09:00:00');
  },
);

Then('applying it shifts every frame in the upload', async ({ page }) => {
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
  await expect(uploadShiftModal(page)).toHaveCount(0);
  await expect(page.getByText(/clock \+1h/)).toBeVisible();
  await openFocus(page);
  for (const [file, when] of [
    ['IMG001.JPG', '2024-01-10T09:00:00'],
    ['IMG003.JPG', '2024-01-10T23:15:00'],
    ['IMG005.JPG', '2024-01-11T07:00:30'],
  ] as const) {
    await listRow(page, file).click();
    await expect.poll(async () => shownTime(page)).toBe(when);
  }
});

Given('a whole-upload shift is in effect', async ({ page }) => {
  await timeShiftButton(page).click();
  await bump(uploadShiftModal(page), 'Hour', 2);
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
  await expect(page.getByText(/clock \+2h/)).toBeVisible();
});

Then('the workspace toolbar shows the shift and its size', async ({ page }) => {
  await expect(timeShiftButton(page)).toContainText('clock +2h');
  await expect(timeShiftButton(page)).toHaveAttribute(
    'title',
    'Upload time shift is active — click to edit',
  );
});

Then('each shifted image is marked as shifted where its time is displayed', async ({ page }) => {
  await openFocus(page);
  await expect(page.getByText('shifted')).toBeVisible();
  await expect.poll(async () => shownTime(page)).toBe('2024-01-10T10:00:00');
  await expect(page.getByText('was 2024-01-10T08:00:00')).toBeVisible();
});

When('the shift is cleared', async ({ page }) => {
  await timeShiftButton(page).click();
  await uploadShiftModal(page).getByRole('button', { name: 'Clear shift' }).click();
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
});

Then('the images show their original capture times again', async ({ page }) => {
  await expect(page.getByText(/clock \+/)).toHaveCount(0);
  await openFocus(page);
  await expect.poll(async () => shownTime(page)).toBe('2024-01-10T08:00:00');
  await expect(page.getByText('shifted')).toHaveCount(0);
});

// --- Selection-scoped shift -------------------------------------------------

When("the selection's time shift is applied", async ({ page }) => {
  await page.getByRole('button', { name: 'Shift selection' }).click();
  await expect(selectionShiftModal(page)).toBeVisible();
  await bump(selectionShiftModal(page), 'Hour', 1);
  await selectionShiftModal(page).getByRole('button', { name: /^Apply to 3 selected/ }).click();
  await expect(selectionShiftModal(page)).toHaveCount(0);
});

Then('only the selected frames move by the offset', async ({ page }) => {
  await openFocus(page);
  for (const [file, when] of [
    ['IMG001.JPG', '2024-01-10T09:00:00'],
    ['IMG002.JPG', '2024-01-10T09:00:30'],
    ['IMG003.JPG', '2024-01-10T23:15:00'],
  ] as const) {
    await listRow(page, file).click();
    await expect.poll(async () => shownTime(page)).toBe(when);
  }
  // Untouched frames keep their stored time.
  await listRow(page, 'IMG005.JPG').click();
  await expect.poll(async () => shownTime(page)).toBe('2024-01-11T06:00:30');
});

Then('each moves relative to the time it was already showing', async ({ page }) => {
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await gridCell(page, 'IMG001.JPG').click();
  await gridCell(page, 'IMG003.JPG').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Shift selection' }).click();
  await bump(selectionShiftModal(page), 'Min', 30);
  await selectionShiftModal(page).getByRole('button', { name: /^Apply to 3 selected/ }).click();
  await openFocus(page);
  await listRow(page, 'IMG001.JPG').click();
  await expect.poll(async () => shownTime(page)).toBe('2024-01-10T09:30:00');
});

Then('the preview is anchored on the earliest selected frame', async ({ page }) => {
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await gridCell(page, 'IMG003.JPG').click();
  await gridCell(page, 'IMG001.JPG').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Shift selection' }).click();
  await expect(selectionShiftModal(page)).toContainText('Preview · earliest selected');
  await expect(selectionShiftModal(page).locator('div.line-through')).toContainText(
    '2024-01-10T09:30:00',
  );
  await selectionShiftModal(page).getByRole('button', { name: 'Cancel' }).click();
});

Given('the selection includes frames with no recorded capture time', async ({ page }) => {
  await gridCell(page, 'IMG005.JPG').click();
  await gridCell(page, 'VID001.MP4').click({ modifiers: ['Shift'] });
  await expect(positionReadout(page)).toHaveText('2 selected');
});

When('a selection shift is applied', async ({ page }) => {
  await page.getByRole('button', { name: 'Shift selection' }).click();
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
  await expect.poll(overrides).toEqual({ 'IMG005.JPG': '2024-01-11T07:00:30' });
});

Then('the dialog states that they are', async ({ page }) => {
  await gridCell(page, 'IMG005.JPG').click();
  await gridCell(page, 'VID001.MP4').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Shift selection' }).click();
  await expect(selectionShiftModal(page)).toContainText(
    'Frames without a capture time are skipped.',
  );
  await expect(selectionShiftModal(page)).toContainText('1 selected frame');
  await selectionShiftModal(page).getByRole('button', { name: 'Cancel' }).click();
});

// --- Per-image override -----------------------------------------------------

When('a corrected timestamp is typed for it', async ({ page }) => {
  await openFocus(page);
  await page.getByRole('button', { name: 'Adjust time' }).click();
  await page.getByLabel('Corrected timestamp for this image').fill('2023-12-24 18:45:10');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
});

Then(
  'that image shows the corrected time and is marked as carrying an image override',
  async ({ page }) => {
    await expect.poll(async () => shownTime(page)).toBe('2023-12-24T18:45:10');
    await expect(page.getByText('image override')).toBeVisible();
    await expect(page.getByText('was 2024-01-10T08:00:30')).toBeVisible();
  },
);

Then(
  'its override can be cleared to fall back to the whole-upload shift',
  async ({ page }) => {
    await page.getByRole('button', { name: 'clear override' }).click();
    await expect(page.getByText('image override')).toHaveCount(0);
    await expect.poll(async () => shownTime(page)).toBe('2024-01-10T08:00:30');
    // With an upload offset in effect the frame falls back to that instead.
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await timeShiftButton(page).click();
    await bump(uploadShiftModal(page), 'Hour', 3);
    await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
    await openFocus(page);
    await expect.poll(async () => shownTime(page)).toBe('2024-01-10T11:00:30');
    await expect(page.getByText('shifted')).toBeVisible();
  },
);

When('a typed timestamp is not a real date and time', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await openFocus(page);
  await page.getByRole('button', { name: 'Adjust time' }).click();
  await page.getByLabel('Corrected timestamp for this image').fill('2024-02-30 10:00');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
});

Then('the entry is marked invalid and is not applied', async ({ page }) => {
  const input = page.getByLabel('Corrected timestamp for this image');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toBeVisible();
  for (const bad of ['not a date', '2024-13-01 10:00', '2024-01-10 25:00']) {
    await input.fill(bad);
    await page.getByRole('button', { name: 'Set', exact: true }).click();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
  }
  expect(await readStore(page, 'drafts')).toHaveLength(0);
});

Given("a frame's time has been corrected", async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await openFocus(page);
  await page.getByRole('button', { name: 'Adjust time' }).click();
  await page.getByLabel('Corrected timestamp for this image').fill('2024-01-10 09:15:00');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
});

Then('the corrected time is shown prominently', async ({ page }) => {
  await expect.poll(async () => shownTime(page)).toBe('2024-01-10T09:15:00');
});

Then('the original capture time is shown struck through beneath it', async ({ page }) => {
  const was = page.getByText('was 2024-01-10T08:00:30');
  await expect(was).toBeVisible();
  await expect(was).toHaveClass(/line-through/);
});

// --- Nothing stored until a sync --------------------------------------------

Given('times have been corrected in the workspace', async ({ page }) => {
  await timeShiftButton(page).click();
  await bump(uploadShiftModal(page), 'Hour', 1);
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
  await expect(page.getByText(/clock \+1h/)).toBeVisible();
});

Then('the stored capture times are unchanged', async ({ s3 }) => {
  expect(s3.text(BUCKET, `${PREFIX_A}media.csv`)).toBe(mediaCsv(PREFIX_A, MEDIA_A));
  expect(s3.puts).toHaveLength(0);
});

Then('the sync preview counts how many images would have a corrected time', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await page.locator('#user').fill('jgonzalez');
  await sectionTab(page, 'Tag').click();
  await openSyncDialog(page);
  await expect(
    page.locator('div.border.text-center').filter({ hasText: 'Time-corrected' }),
  ).toHaveText('5Time-corrected');
});

Then(
  "only a live sync writes the corrected times into the upload's stored files",
  async ({ page, s3 }) => {
    await page.getByRole('button', { name: 'Run dry-run' }).click();
    await expect(page.getByText('Dry-run complete — nothing was written.')).toBeVisible();
    expect(s3.puts).toHaveLength(0);

    await setSyncDryRun(page, false);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
    const media = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`));
    expect(media.find((m) => m.mediaId.endsWith('IMG001.JPG'))!.timestamp).toBe(
      '2024-01-10T09:00:00',
    );
    expect(media.find((m) => m.mediaId.endsWith('VID001.MP4'))!.timestamp).toBe('');
  },
);

Given('a whole-upload shift was written to the stored files by a sync', async ({ page }) => {
  await sectionTab(page, 'Settings').click();
  await page.locator('#user').fill('jgonzalez');
  await sectionTab(page, 'Tag').click();
  await timeShiftButton(page).click();
  await bump(uploadShiftModal(page), 'Hour', 1);
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
  await expect(page.getByText(/clock \+1h/)).toBeVisible();
  await openSyncDialog(page);
  await setSyncDryRun(page, false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced — canonical files replaced.')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
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
    await openFocus(page);
    await expect.poll(async () => shownTime(page)).toBe('2024-01-10T09:00:00');
    await expect(page.getByText('shifted')).toHaveCount(0);
    await expect(page.getByText(/^was /)).toHaveCount(0);
    const media = parseMedia(s3.text(BUCKET, `${PREFIX_A}media.csv`));
    expect(media.find((m) => m.mediaId.endsWith('IMG001.JPG'))!.timestamp).toBe(
      '2024-01-10T09:00:00',
    );
  },
);

// --- Shifts do not re-band bursts -------------------------------------------

When('a whole-upload shift is applied', async ({ page, scratch }) => {
  scratch.bandsBefore = await page.getByText(/^Burst \d+ ·/).allTextContents();
  await timeShiftButton(page).click();
  await bump(uploadShiftModal(page), 'Hour', 1);
  await uploadShiftModal(page).getByRole('button', { name: /^Apply to all/ }).click();
  await expect(page.getByText(/clock \+1h/)).toBeVisible();
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
  expect(before[0]).toContain('08:00:00–08:00:30');
  expect(after[0]).toContain('09:00:00–09:00:30');
  expect(after[0]).not.toBe(before[0]);
});
