import type { Page } from '@playwright/test';
import { Given, When, Then, expect, sectionTab, uploadRow, focusFrame, enterFocusView } from './support/world';
import { readStore, waitForAutomaticSave } from './support/flows';
import { BUCKET, PREFIX_A } from './support/data';

const status = (page: Page) => page.getByTestId('automatic-save');
async function activeControls(page: Page) {
  const focus = page.getByTestId('focus-save-controls');
  return await focus.count() ? focus : status(page);
}
const undo = (page: Page) => status(page).getByRole('button', { name: 'Undo latest action', exact: true });
Given('the save controls are viewed at width {int}', async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 950 });
});
Then('the empty Undo controls are absent', async ({ page }) => {
  const controls = await activeControls(page);
  await expect(controls.getByRole('status')).toHaveText('Saved');
  await expect(controls.getByRole('button', { name: 'Undo latest action', exact: true })).toHaveCount(0);
  await expect(controls.getByTestId('automatic-undo-help')).toHaveCount(0);
  await expect(controls).not.toContainText('No completed action to undo');
});
Then('the Undo control is available', async ({ page }) => { await expect(undo(page)).toBeEnabled(); });
When('the final Undo is activated with {string}', async ({ page }, key: string) => {
  const controls = await activeControls(page);
  await controls.getByRole('button', { name: 'Undo latest action', exact: true }).focus();
  await page.keyboard.press(key);
  await expect(controls.getByRole('status')).toHaveText('Saved');
});
Then('the save status receives keyboard focus', async ({ page }) => {
  await expect((await activeControls(page)).getByRole('status')).toBeFocused();
});
When('the final Undo is held while another control receives focus', async ({ page, scratch }) => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { entered = resolve; });
  scratch.saveRelease = release;
  let held = false;
  await page.route('**/*', async route => {
    if (!held && route.request().method() === 'PUT' && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}observations.csv`)) {
      held = true; entered(); await gate;
    }
    await route.fallback();
  });
  await undo(page).click(); await writing;
  await sectionTab(page, 'Tag').focus();
});
Then('the Tag tab retains keyboard focus', async ({ page }) => { await expect(sectionTab(page, 'Tag')).toBeFocused(); });
When('Browse is opened during the held save', async ({ page }) => { await sectionTab(page, 'Browse').click(); });
When('Settings is opened during the held save', async ({ page }) => { await sectionTab(page, 'Settings').click(); });
When('Tag is reopened from Browse', async ({ page }) => { await sectionTab(page, 'Tag').click(); });
Then('the global save row is absent', async ({ page }) => {
  await expect(status(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo latest action', exact: true })).toHaveCount(0);
});
Then('the save row still reports the pending write', async ({ page }) => {
  await expect(status(page).getByRole('status')).toHaveText('Saving…');
});
Then('the upload finishes saving while Browse stays open', async ({ page, s3 }) => {
  await expect(uploadRow(page, 'priortagger').locator('[data-save-status]')).toHaveAttribute('data-save-status', 'saved');
  expect(JSON.parse(s3.text(BUCKET, `${PREFIX_A}UploadMeta.json`)).taggerActions).toHaveLength(1);
  const records = await readStore(page, 'automatic') as { actions: unknown[] }[];
  expect(records[0].actions).toHaveLength(0);
});
Then('Browse reports the retained save failure without the global row', async ({ page }) => {
  await expect(status(page)).toHaveCount(0);
  await expect(uploadRow(page, 'priortagger').locator('[data-save-status]')).toHaveText('Repair');
  const records = await readStore(page, 'automatic') as { actions: unknown[] }[];
  expect(records[0].actions).toHaveLength(1);
});
Then('the save failure can be retried from its restored row', async ({ page }) => {
  await expect(status(page).getByRole('status')).toContainText('Save failed');
  await expect(undo(page)).toBeDisabled();
  await status(page).getByRole('button', { name: 'Retry save', exact: true }).click();
  await waitForAutomaticSave(page);
  await expect(undo(page)).toBeEnabled();
});

When('a species is assigned for Undo visibility', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await page.keyboard.press('p');
});

When('Focus is opened for the Undo visibility check', async ({ page }) => { await enterFocusView(page); });
Then('the compact Undo control is available', async ({ page }) => {
  await expect(page.getByTestId('focus-save-controls').getByRole('button', { name: 'Undo latest action', exact: true })).toBeEnabled();
});
Then('Focus remains open after Undo', async ({ page }) => {
  await expect(page.getByRole('dialog', { name: 'Focus image viewer', exact: true })).toBeVisible();
});

Given('recovery starts with {string} Undo', async ({ page, scratch }, state: string) => {
  if (state === 'saved') {
    await focusFrame(page, 'IMG002.JPG');
    await page.keyboard.press('p');
    await waitForAutomaticSave(page);
    await expect(undo(page)).toBeEnabled();
  }
  const records = await readStore(page, 'automatic') as { undo?: { id: string } }[];
  scratch.recoveryUndo = records[0]?.undo ?? null;
  expect(!!scratch.recoveryUndo).toBe(state === 'saved');
});
Then('Undo visibility matches its retained record while collection reads are blocked', async ({ page, s3, scratch }) => {
  await expect(status(page).getByRole('status')).toContainText('could not be read');
  if (scratch.recoveryUndo) {
    await expect(undo(page)).toBeVisible();
    await expect(undo(page)).toBeDisabled();
    await expect(undo(page)).toHaveAccessibleDescription('Undo is unavailable while opening save recovery.');
    // The shortcut must not consume a blocked Undo.
    await page.keyboard.press('ControlOrMeta+z');
  } else {
    await expect(undo(page)).toHaveCount(0);
    await expect(status(page).getByTestId('automatic-undo-help')).toHaveCount(0);
  }
  const records = await readStore(page, 'automatic') as { undo?: unknown }[];
  expect(records[0]?.undo ?? null).toEqual(scratch.recoveryUndo);
  scratch.blockedRecoveryWrites = s3.puts.length;
});
Then('recovery restores the original Undo availability', async ({ page, s3, scratch }) => {
  await expect(status(page).getByRole('status')).toHaveText('Saved');
  if (scratch.recoveryUndo) await expect(undo(page)).toBeEnabled();
  else await expect(undo(page)).toHaveCount(0);
  const records = await readStore(page, 'automatic') as { undo?: unknown }[];
  expect(records[0]?.undo ?? null).toEqual(scratch.recoveryUndo);
  expect(s3.puts.length).toBe(scratch.blockedRecoveryWrites);
});

When('the saved upload is reopened with local draft loading blocked', async ({ page }) => {
  await page.evaluate(async () => {
    const draftsUrl = new URL('src/lib/drafts.ts', location.href).href;
    const saveUrl = new URL('src/components/AutomaticSave.tsx', location.href).href;
    const { useDraftStore } = await import(/* @vite-ignore */ draftsUrl);
    const { useAutomaticSave } = await import(/* @vite-ignore */ saveUrl);
    const load = useDraftStore.getState().loadUpload;
    (window as any).restoreUndoDraftLoader = () => useDraftStore.setState({ loadUpload: load });
    useDraftStore.setState({ loadUpload: async () => { throw new Error('Blocked local draft loading for Undo regression'); } });
    useAutomaticSave.setState((state: { setupRevision: number }) => ({ setupRevision: state.setupRevision + 1 }));
  });
});
Then('the local setup failure retains a disabled Undo', async ({ page, s3, scratch }) => {
  await expect(status(page).getByRole('status')).toContainText('Blocked local draft loading');
  await expect(undo(page)).toBeVisible();
  await expect(undo(page)).toBeDisabled();
  await expect(undo(page)).toHaveAccessibleDescription('Undo is unavailable while opening save recovery.');
  const records = await readStore(page, 'automatic') as { undo?: unknown }[];
  expect(records[0]?.undo).toEqual(scratch.recoveryUndo);
  scratch.blockedRecoveryWrites = s3.puts.length;
});
When('local draft loading is restored and setup is retried', async ({ page }) => {
  await page.evaluate(() => (window as any).restoreUndoDraftLoader());
  await status(page).getByRole('button', { name: 'Retry save', exact: true }).click();
  await waitForAutomaticSave(page);
});
