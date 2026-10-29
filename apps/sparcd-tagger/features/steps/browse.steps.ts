import {
  Given,
  When,
  Then,
  expect,
  openAppConnected,
  connect,
  collectionRail,
  collectionButton,
  uploadRow,
  sectionTab,
  selectCollection,
  openUpload,
  gridCell,
  speciesRow,
  speciesApply,
  focusFrame,
  enterFocusView,
} from './support/world';
import {
  BUCKET,
  SETTINGS_BUCKET,
  BUCKET_B,
  UUID,
  UUID_B,
  COLLECTION_NAME,
  COLLECTION_B_NAME,
  PREFIX_A,
  PREFIX_B,
  LOCATION_NAME,
  PREFIX_F,
  uploadMetaJson,
  MEDIA_A,
  deploymentsCsv,
} from './support/data';
import { makeLocalEdit, waitForAutomaticSave, waitForDirtyDrafts } from './support/flows';

// --- Collection rail --------------------------------------------------------

When('Browse is opened', async ({ page }) => {
  await sectionTab(page, 'Browse').click();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
});

Then('the rail lists the collections readable with the connected credentials', async ({ page }) => {
  await expect(collectionButton(page, COLLECTION_NAME)).toBeVisible();
  await expect(collectionButton(page, COLLECTION_B_NAME)).toBeVisible();
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(2);
});

Then(
  'when none are readable it says no collections are visible to these credentials',
  async ({ page, s3 }) => {
    s3.delete(BUCKET, `Collections/${UUID}/collection.json`);
    s3.delete(BUCKET_B, `Collections/${UUID_B}/collection.json`);
    await page.reload();
    await connect(page);
    await expect(page.getByText('No collections visible to these credentials.')).toBeVisible();
  },
);

Given('several collections are listed', async ({ page }) => {
  await openAppConnected(page);
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(2);
});

When('text is typed into the collection filter', async ({ page }) => {
  await page.getByLabel('Filter collections').fill('Backcountry');
});

Then('only collections whose name or organization contains that text remain', async ({ page }) => {
  await expect(collectionButton(page, COLLECTION_B_NAME)).toBeVisible();
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(1);
  // The organization field matches too.
  await page.getByLabel('Filter collections').fill('Culver Lab');
  await expect(collectionButton(page, COLLECTION_NAME)).toBeVisible();
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(1);
});

Then('a message names the filter text when nothing matches', async ({ page }) => {
  await page.getByLabel('Filter collections').fill('nothing-like-this');
  await expect(page.getByText('No collections match')).toContainText('nothing-like-this');
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(0);
});

Then('hovering each collection shows its own collection ID', async ({ page }) => {
  const cases = [
    { name: COLLECTION_B_NAME, organization: 'Field Office', id: UUID_B },
    { name: COLLECTION_NAME, organization: 'Culver Lab', id: UUID },
  ];
  for (const { name, organization, id } of cases) {
    const button = collectionButton(page, name);
    await expect(button).toHaveAccessibleName(`${name} ${organization}`);
    await expect(button).toHaveAccessibleDescription(`Collection ID: ${id}`);
    await button.hover();
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    await expect(page.getByRole('tooltip')).toHaveText(`Collection ID: ${id}`);
    await expect(button).not.toHaveAttribute('aria-current', 'true');
  }
});

Then('the collection ID tooltip stays open while hovered and dismisses with Escape', async ({ page }) => {
  const tooltip = page.getByRole('tooltip');
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await collectionRail(page).getByRole('heading', { name: 'Collections' }).hover();
  const button = collectionButton(page, COLLECTION_NAME);
  await button.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await collectionRail(page).getByRole('heading', { name: 'Collections' }).hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

Then('tabbing through collections shows their IDs without changing their names', async ({ page }) => {
  await page.mouse.move(0, 0);
  await page.getByLabel('Filter collections').focus();
  for (const { name, organization, id } of [
    { name: COLLECTION_B_NAME, organization: 'Field Office', id: UUID_B },
    { name: COLLECTION_NAME, organization: 'Culver Lab', id: UUID },
  ]) {
    await page.keyboard.press('Tab');
    const button = collectionButton(page, name);
    await expect(button).toBeFocused();
    await expect(button).toHaveAccessibleName(`${name} ${organization}`);
    await expect(button).toHaveAccessibleDescription(`Collection ID: ${id}`);
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    await expect(page.getByRole('tooltip')).toHaveText(`Collection ID: ${id}`);
  }
});

Then('Escape dismisses the collection tooltip without moving focus', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(collectionButton(page, COLLECTION_NAME)).toBeFocused();
  await expect(collectionButton(page, COLLECTION_NAME)).toHaveAccessibleDescription(`Collection ID: ${UUID}`);
});

Then('activating the focused collection still selects it', async ({ page }) => {
  await page.keyboard.press('Enter');
  await expect(collectionButton(page, COLLECTION_NAME)).toHaveAttribute('aria-current', 'true');
  await expect(uploadRow(page, 'priortagger')).toBeVisible();
});

Then('collection ID tooltips remain fully inside each viewport', async ({ page }) => {
  for (const width of [375, 1280, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.mouse.move(0, 0);
    const button = collectionButton(page, COLLECTION_NAME);
    await button.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(`Collection ID: ${UUID}`);
    const box = await tooltip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(950);
  }
});

Then('only the hovered collection tooltip appears while another collection has focus', async ({ page }) => {
  const first = collectionButton(page, COLLECTION_B_NAME);
  const second = collectionButton(page, COLLECTION_NAME);
  await first.focus();
  await expect(page.getByRole('tooltip')).toHaveText(`Collection ID: ${UUID_B}`);
  await second.hover();
  await expect(first).toBeFocused();
  await expect(first).toHaveAccessibleDescription(`Collection ID: ${UUID_B}`);
  await expect(second).toHaveAccessibleDescription(`Collection ID: ${UUID}`);
  await expect(page.getByRole('tooltip')).toHaveCount(1);
  await expect(page.getByRole('tooltip')).toHaveText(`Collection ID: ${UUID}`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(second).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveCount(1);
  await expect(page.getByRole('tooltip')).toHaveText(`Collection ID: ${UUID}`);
});

Then('collection rows remain directly selectable around narrow-screen tooltips', async ({ page }) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 950 });
    await page.mouse.move(0, 0);
    const first = collectionButton(page, COLLECTION_B_NAME);
    const second = collectionButton(page, COLLECTION_NAME);
    for (const { button, neighbor, id } of [
      { button: second, neighbor: first, id: UUID },
      { button: first, neighbor: second, id: UUID_B },
    ]) {
      await page.mouse.move(0, 0);
      await neighbor.focus();
      await page.keyboard.press('Enter');
      await expect(neighbor).toHaveAttribute('aria-current', 'true');
      await expect(button).not.toHaveAttribute('aria-current', 'true');
      await button.hover();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toHaveCount(1);
      await expect(tooltip).toHaveText(`Collection ID: ${id}`);
      const help = (await tooltip.boundingBox())!;
      const row = (await button.boundingBox())!;
      expect(help.x).toBeGreaterThanOrEqual(row.x);
      expect(help.x + help.width).toBeLessThanOrEqual(row.x + row.width);
      expect(help.y).toBeGreaterThanOrEqual(row.y);
      expect(help.y + help.height).toBeLessThanOrEqual(row.y + row.height);
      await page.mouse.move(help.x + help.width / 2, help.y + help.height / 2);
      await expect(tooltip).toBeVisible();
      // A swallowed click must fail: this target is explicitly unselected.
      await expect(button).not.toHaveAttribute('aria-current', 'true');
      await page.mouse.click(help.x + help.width / 2, help.y + help.height / 2);
      await expect(button).toHaveAttribute('aria-current', 'true');
      await expect(neighbor).not.toHaveAttribute('aria-current', 'true');
      await neighbor.click();
      await expect(neighbor).toHaveAttribute('aria-current', 'true');
      await expect(button).not.toHaveAttribute('aria-current', 'true');
    }
  }
});

Then('desktop collection tooltips preserve selection until a collection button is activated', async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.mouse.move(0, 0);
    const first = collectionButton(page, COLLECTION_B_NAME);
    const second = collectionButton(page, COLLECTION_NAME);
    for (const { button, neighbor, id } of [
      { button: second, neighbor: first, id: UUID },
      { button: first, neighbor: second, id: UUID_B },
    ]) {
      await page.mouse.move(0, 0);
      await neighbor.focus();
      await page.keyboard.press('Enter');
      await expect(neighbor).toHaveAttribute('aria-current', 'true');
      await expect(button).not.toHaveAttribute('aria-current', 'true');
      await button.hover();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toHaveCount(1);
      await expect(tooltip).toHaveText(`Collection ID: ${id}`);
      const help = (await tooltip.boundingBox())!;
      const row = (await button.boundingBox())!;
      expect(help.x).toBeGreaterThanOrEqual(row.x + row.width - 1);
      expect(help.x + help.width / 2).toBeGreaterThan(row.x + row.width);
      await tooltip.click();
      await expect(neighbor).toHaveAttribute('aria-current', 'true');
      await expect(button).not.toHaveAttribute('aria-current', 'true');
      await button.click();
      await expect(button).toHaveAttribute('aria-current', 'true');
      await expect(neighbor).not.toHaveAttribute('aria-current', 'true');
    }
  }
});

Given('the collections have matching display names', async ({ page, s3 }) => {
  for (const { bucket, id } of [{ bucket: BUCKET, id: UUID }, { bucket: BUCKET_B, id: UUID_B }]) {
    s3.put(bucket, `Collections/${id}/collection.json`, JSON.stringify({
      nameProperty: 'Matching collection', organizationProperty: 'Same organization',
    }), 'application/json');
  }
  await page.reload();
  await connect(page);
  await expect(collectionRail(page).locator('ul > li')).toHaveCount(2);
});

Then('hovering each matching collection shows its own collection ID', async ({ page }) => {
  const buttons = collectionRail(page).getByRole('button', { name: 'Matching collection Same organization', exact: true });
  await expect(buttons).toHaveCount(2);
  for (const [index, id] of [UUID_B, UUID].entries()) {
    const button = buttons.nth(index);
    await expect(button).toHaveAccessibleDescription(`Collection ID: ${id}`);
    await button.hover();
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    await expect(page.getByRole('tooltip')).toHaveText(`Collection ID: ${id}`);
  }
});

// --- Upload list ------------------------------------------------------------

Given('a failed upload left blobs and CSVs without its UploadMeta marker', async ({ s3 }) => {
  expect(s3.has(BUCKET, `${PREFIX_F}media.csv`)).toBe(true);
  expect(s3.has(BUCKET, `${PREFIX_F}deployments.csv`)).toBe(true);
  expect(s3.has(BUCKET, `${PREFIX_F}UploadMeta.json`)).toBe(false);
});

Given('a collection is selected', async ({ page }) => {
  await openAppConnected(page);
  await selectCollection(page);
});

Then('that incomplete upload is not listed', async ({ page }) => {
  await expect(uploadRow(page, 'interrupted')).toHaveCount(0);
});

Then('the completed uploads remain listed', async ({ page }) => {
  await expect(uploadRow(page, 'priortagger')).toBeVisible();
  await expect(uploadRow(page, 'fielduser')).toBeVisible();
});

Then('each upload row shows the upload date and time', async ({ page }) => {
  const row = uploadRow(page, 'priortagger');
  await expect(row).toContainText('2024-01-15');
  await expect(row).toContainText('10:00');
});

Then(
  "it shows the account that made the upload, when the upload's name carries one",
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toContainText('priortagger');
    await expect(uploadRow(page, 'fielduser')).toContainText('fielduser');
  },
);



Then(
  'it shows the image count and how many of those images already carry a species',
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toContainText('6');
    await expect(uploadRow(page, 'priortagger')).toContainText('3 / 6');
  },
);

Then('the upload row shows the location name followed by its site ID', async ({ page }) => {
  await expect(uploadRow(page, 'priortagger')).toContainText(`${LOCATION_NAME} (SAN15)`);
});

Given("an upload's description records a collection date", async ({ page, s3 }) => {
  s3.put(
    BUCKET,
    `${PREFIX_A}UploadMeta.json`,
    uploadMetaJson({
      bucket: BUCKET,
      prefix: PREFIX_A,
      user: 'priortagger',
      imageCount: MEDIA_A.length,
      imagesWithSpecies: 3,
      description: 'Santa Rita Mountains - San Pedro 15 - 6 images - uploaded 2024-01-15 - collected 2024-01-10',
    }),
    'application/json',
  );
  await openAppConnected(page);
  await selectCollection(page);
});

Then('the upload row shows that date in the Collected column', async ({ page }) => {
  await expect(uploadRow(page, 'priortagger').locator('[data-column="collected"] [data-collected-value]')).toHaveText('2024-01-10');
});

Then("the upload row's Collected column shows a dash", async ({ page }) => {
  await expect(uploadRow(page, 'priortagger').locator('[data-column="collected"] [data-collected-value]').getByText('—', { exact: true })).toBeVisible();
});

Then('hovering it explains the date is missing or not in a recognized format', async ({ page }) => {
  await uploadRow(page, 'priortagger').locator('[data-column="collected"]').hover();
  await expect(uploadRow(page, 'priortagger').locator('[data-column="collected"]')).toHaveAttribute(
    'title',
    'Date collected is missing or not in a recognized format',
  );
});

Given('the upload metadata description is {string}', async ({ page, s3 }, kind: string) => {
  const meta: Record<string, unknown> = JSON.parse(uploadMetaJson({
    bucket: BUCKET, prefix: PREFIX_A, user: 'priortagger', imageCount: MEDIA_A.length,
    imagesWithSpecies: 3, description: '',
  }));
  const values: Record<string, unknown> = {
    null: null, number: 42, boolean: true,
    array: ['collected 2024-02-29'], object: { date: 'collected 2024-02-29' },
  };
  if (kind === 'omitted') delete meta.description;
  else {
    expect(Object.hasOwn(values, kind)).toBe(true);
    meta.description = values[kind];
  }
  s3.put(BUCKET, `${PREFIX_A}UploadMeta.json`, JSON.stringify(meta), 'application/json');
  await openAppConnected(page);
  await selectCollection(page);
});

Then('the upload retains its metadata and still opens for tagging', async ({ page }) => {
  const row = uploadRow(page, 'priortagger');
  await expect(row.locator('[data-column="location"]')).toContainText(`${LOCATION_NAME} (SAN15)`);
  await expect(row.locator('[data-column="tagged-total"]')).toContainText('3 / 6');
  // Another upload remains usable too: a bad description cannot crash the collection.
  await expect(uploadRow(page, 'videoproducer')).toBeVisible();
  await openUpload(page);
  await expect(gridCell(page, 'IMG001.JPG')).toBeVisible();
});

Given('the upload description contains collected date {string}', async ({ page, s3 }, date: string) => {
  s3.put(BUCKET, `${PREFIX_A}UploadMeta.json`, uploadMetaJson({
    bucket: BUCKET, prefix: PREFIX_A, user: 'priortagger', imageCount: MEDIA_A.length,
    imagesWithSpecies: 3,
    description: `Santa Rita Mountains - San Pedro 15 - 6 images - uploaded 2024-01-15 - collected ${date} - optional notes`,
  }), 'application/json');
  await openAppConnected(page);
  await selectCollection(page);
});

Then('the Collected value is {string}', async ({ page }, date: string) => {
  await expect(uploadRow(page, 'priortagger').locator('[data-collected-value]')).toHaveText(date);
});

Then('the missing collected date is explained on keyboard focus', async ({ page }) => {
  const row = uploadRow(page, 'priortagger');
  // Reach the upload through the real keyboard order after the filter buttons.
  await page.getByRole('button', { name: /^Done\s+\d/ }).focus();
  for (let i = 0; i < 20 && !await row.evaluate(el => el === document.activeElement); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(row).toBeFocused();
  await expect(row).toHaveAccessibleDescription(/Stored collection data.*Date collected is missing or not in a recognized format/);
  await expect(row.locator('[data-collected-help]')).toBeVisible();
});

Given('the upload has long names for multiple locations', async ({ page, s3 }) => {
  const first = deploymentsCsv().replace(LOCATION_NAME, 'Santa Rita Mountains - San Pedro 15');
  const second = deploymentsCsv().replaceAll('SAN15', 'SAN99').replace(LOCATION_NAME, 'Northern mountain range camera with a long location name');
  s3.put(BUCKET, `${PREFIX_A}deployments.csv`, `${first}\n${second}\n${first}`, 'text/csv');
  await openAppConnected(page);
  await selectCollection(page);
});

Then('the full location names and both IDs remain readable at desktop and mobile widths', async ({ page }) => {
  const row = uploadRow(page, 'priortagger');
  for (const width of [1600, 1350, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    const cell = row.locator('[data-column="location"]');
    await expect(cell).toContainText('Santa Rita Mountains - San Pedro 15');
    await expect(cell).toContainText('Northern mountain range camera with a long location name');
    await expect(cell.locator('[data-location-id]')).toHaveText(['(SAN15)', '(SAN99)']);
    for (const node of [cell, ...await cell.locator('[data-location-id]').all()]) {
      await expect(node).toBeVisible();
      expect(await node.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

Then('mobile upload rows label their fields and explain unavailable collection dates', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    const row = uploadRow(page, 'priortagger');
    for (const label of ['Uploaded:', 'Upload:', 'Location:', 'Tagged/Total:', 'Collected:', 'Save:']) {
      await expect(row.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(row.getByText('Not recorded or unrecognized', { exact: true })).toBeVisible();
    await expect(row).toHaveAccessibleName(/Uploaded:.*Upload:.*Location:.*Tagged\/Total:.*3 \/ 6.*Collected:.*Not recorded or unrecognized.*Save:/);
    await expect(row).toHaveAccessibleDescription(/Stored collection data.*Date collected is missing or not in a recognized format/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

// The table sits beside a 320px rail from 1280px up, so the same viewport
// width means two different table widths either side of that: 1600px leaves
// the table 1238px, 1350px leaves it 988px, and 900px (below the rail's `xl`
// breakpoint) leaves it 858px. Tagged/Total and Collected are promoted ahead
// of Sync (see tailwind.config.ts), so they reappear before Sync does.
Then('a wide Browse shows every column', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const row = uploadRow(page, 'priortagger');
  const upload = row.locator('[data-column="upload"]');

  await expect(upload).toBeVisible();
  await expect(upload).toContainText('priortagger');
  await expect(row.locator('[data-column="tagged-total"]')).toBeVisible();
  await expect(row.locator('[data-column="collected"]')).toBeVisible();
  await expect(row.locator('[data-column="sync"]')).toBeVisible();
  await expect.poll(async () => (await upload.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(256);
});

Then(
  'a medium Browse yields sync status to the collection rail but keeps tagging progress and the collected date',
  async ({ page }) => {
    await page.setViewportSize({ width: 1350, height: 900 });
    const row = uploadRow(page, 'priortagger');
    const upload = row.locator('[data-column="upload"]');

    await expect(upload).toBeVisible();
    await expect(upload).toContainText('priortagger');
    await expect(row.locator('[data-column="tagged-total"]')).toBeVisible();
    await expect(row.locator('[data-column="collected"]')).toBeVisible();
    await expect(row.locator('[data-column="sync"]')).toBeHidden();
    await expect.poll(async () => (await upload.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(256);
  },
);

Then('a compact Browse at an 853px effective viewport keeps Upload and Sync available', async ({ page }) => {
  // 1280px at 150% display scaling is about 853 CSS pixels. This is the
  // compact pre-940px table band where all status columns should remain usable.
  await page.setViewportSize({ width: 853, height: 900 });
  const row = uploadRow(page, 'priortagger');
  const upload = row.locator('[data-column="upload"]');
  const sync = row.locator('[data-column="sync"]');

  await expect(upload).toBeVisible();
  await expect(upload).toContainText('priortagger');
  await expect(row.locator('[data-column="tagged-total"]')).toBeVisible();
  await expect(row.locator('[data-column="collected"]')).toBeVisible();
  await expect(sync).toBeVisible();
  await expect(sync).toContainText('stored data');
  await expect.poll(async () => (await upload.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(160);
  await expect.poll(async () => (await sync.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(124);
  expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

Then('a narrower desktop Browse hides tagging progress, collected date and sync together', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const row = uploadRow(page, 'priortagger');
  const upload = row.locator('[data-column="upload"]');

  await expect(upload).toBeVisible();
  await expect(upload).toContainText('priortagger');
  await expect(row.locator('[data-column="tagged-total"]')).toBeHidden();
  await expect(row.locator('[data-column="collected"]')).toBeHidden();
  await expect(row.locator('[data-column="sync"]')).toBeHidden();
  await expect.poll(async () => (await upload.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(256);
});

Then('wide Browse gives tagging progress usable space', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const tagged = uploadRow(page, 'priortagger').locator('[data-column="tagged-total"]');

  await expect(tagged).toBeVisible();
  await expect(tagged).toContainText('3 / 6');
  // The filled part of the bar is width:0 at 0% tagged, so it is only ever
  // attached, never "visible" in Playwright's sense.
  await expect(tagged.locator('[style*="width"]')).toBeAttached();
  await expect.poll(async () => (await tagged.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(130);
});

Then('mobile Browse keeps tagging progress aligned', async ({ page }) => {
  await page.setViewportSize({ width: 767, height: 900 });
  const tagged = uploadRow(page, 'priortagger').locator('[data-column="tagged-total"]');
  await expect(tagged).toBeVisible();
  await expect(tagged).toHaveCSS('display', 'flex');
});

Given('an upload has no readable deployment file', async ({ page, s3 }) => {
  expect(s3.has(BUCKET, `${PREFIX_B}deployments.csv`)).toBe(false);
  await openAppConnected(page);
  await selectCollection(page);
});

When('its row is shown', async ({ page }) => {
  await expect(uploadRow(page, 'fielduser')).toBeVisible();
});

Then('the row still shows its date, image count and tagging progress', async ({ page }) => {
  const row = uploadRow(page, 'fielduser');
  await expect(row).toContainText('2023-06-01');
  await expect(row).toContainText('2 / 2');
});

Then('the location column is shown as empty rather than the row being hidden', async ({ page }) => {
  await expect(uploadRow(page, 'fielduser')).toContainText('—');
  await expect(uploadRow(page, 'fielduser')).toBeVisible();
});

// --- Tabs + totals ----------------------------------------------------------

Given("a collection's uploads have been tallied", async ({ page }) => {
  await openAppConnected(page);
  await selectCollection(page);
  await expect(uploadRow(page, 'priortagger')).toContainText('3 / 6');
  await expect(uploadRow(page, 'fielduser')).toContainText('2 / 2');
});

When('the {string} tab is chosen', async ({ page }, label: string) => {
  await page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).first().click();
});

Then(
  'only uploads with at least one image still lacking a species are listed',
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toBeVisible();
    await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
  },
);

Then(
  'the {string} tab lists only uploads where every image already carries a species',
  async ({ page }, label: string) => {
    await page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).first().click();
    await expect(uploadRow(page, 'fielduser')).toBeVisible();
    await expect(uploadRow(page, 'priortagger')).toHaveCount(0);
  },
);

Then(
  'uploads whose tally has not finished loading appear only under {string}',
  async ({ page, s3 }, label: string) => {
    // Re-enter Browse with one upload's tally stalled, so its tab membership is
    // still unknown while the other has resolved.
    s3.delay(`${PREFIX_B}UploadMeta.json`, 4000);
    await page.reload();
    await connect(page);
    await selectCollection(page);
    await expect(uploadRow(page, 'priortagger')).toContainText('3 / 6');
    await page.getByRole('button', { name: /^In progress\b/ }).click();
    await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
    await page.getByRole('button', { name: /^Done\b/ }).click();
    await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
    await page.getByRole('button', { name: new RegExp(`^${label}\\b`) }).click();
    await expect(uploadRow(page, 'fielduser')).toBeVisible();
    s3.delays.clear();
  },
);

Then('each tab explains its filter on hover and to assistive technology', async ({ page }) => {
  const expectDescription = async (name: RegExp, id: string, text: string) => {
    const tab = page.getByRole('button', { name });
    await expect(tab).toHaveAttribute('title', text);
    await expect(tab).toHaveAttribute('aria-describedby', id);
    await expect(page.locator(`#${id}`)).toHaveText(text);
  };

  await expectDescription(/^All\b/, 'browse-all-tab-description', 'Every upload in this collection');
  await expectDescription(/^In progress\b/, 'browse-in-progress-tab-description', 'Uploads not yet fully tagged');
  await expectDescription(/^Done\b/, 'browse-done-tab-description', 'Uploads that are fully tagged');
});

Then('the header states how many uploads, images and tagged images it holds', async ({ page }) => {
  const header = page.locator('main p').filter({ hasText: /uploads?\b/ }).first();
  await expect(header).toContainText('5 uploads');
  await expect(header).toContainText('22 images');
  await expect(header).toContainText('8 tagged');
});

Then('it states how many images are still to go', async ({ page }) => {
  await expect(page.locator('main p').filter({ hasText: 'to go' }).first()).toContainText('14 to go');
});

Then('it indicates while tallies are still being counted', async ({ page, s3 }) => {
  s3.delay(`${PREFIX_B}UploadMeta.json`, 4000);
  await page.reload();
  await connect(page);
  await selectCollection(page);
  await expect(page.getByText('tallying…')).toBeVisible();
  await expect(page.getByText('tallying…')).toBeHidden({ timeout: 15000 });
  s3.delays.clear();
});

// --- Per-upload sync state --------------------------------------------------

Given('local edits were made to an upload in this browser', async ({ page, scratch }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); scratch.browseRelease = release;
  await page.route('**/*', async route => { if (route.request().method() === 'PUT' && decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${PREFIX_A}observations.csv`)) await gate; await route.fallback(); });
  await openAppConnected(page);
  await selectCollection(page);
  await openUpload(page);
  await makeLocalEdit(page);
  await waitForDirtyDrafts(page, 1);
  await sectionTab(page, 'Browse').click();
});

// The Sync column is served from a 5s-stale query, so it only refreshes when
// Browse is re-entered after that window — re-enter until it settles.
async function expectRowPill(
  page: import('@playwright/test').Page,
  user: string,
  text: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const content = await uploadRow(page, user).locator('[data-column="sync"]').evaluate((cell) => {
          const copy = cell.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('[aria-hidden="true"]').forEach((glyph) => glyph.remove());
          return copy.textContent?.replace(/^Save:\s*/, '').trim() ?? '';
        });
        if (content === text) return text;
        await sectionTab(page, 'Settings').click();
        await sectionTab(page, 'Browse').click();
        return content;
      },
      { timeout: 25000, intervals: [1500] },
    )
    .toBe(text);
}

Then("that upload's row is marked as having unsynced edits", async ({ page }) => {
  await expectRowPill(page, 'priortagger', 'pending save');
});

Then('an upload whose local edits have all been synced is marked as synced', async ({ page, scratch }) => {
  (scratch.browseRelease as (() => void) | undefined)?.();
  await sectionTab(page, 'Settings').click();
  await expect(page.locator('#user')).toHaveValue('testkey');
  await sectionTab(page, 'Tag').click();
  await waitForAutomaticSave(page);
  await sectionTab(page, 'Browse').click();
  await expectRowPill(page, 'priortagger', 'saved');
});

Then('an upload never edited on this machine is marked local-only', async ({ page }) => {
  await expect(uploadRow(page, 'fielduser')).toContainText('stored data');
});

async function checkSyncExplanation(page: import('@playwright/test').Page, user: string, explanation: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    const row = uploadRow(page, user);
    const pill = row.locator('[data-column="sync"] span[title]');
    await pill.hover();
    await expect(pill).toHaveAttribute('title', explanation);
    await expect(row).toHaveAccessibleDescription(new RegExp(escapeRegExp(explanation)));
    await row.focus();
    await expect(row).toBeFocused();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText(explanation);
    const box = (await tooltip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(950);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(row).toBeFocused();
    await page.getByLabel('Filter collections').focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

Then('its unsynced explanation is available on hover and keyboard focus', async ({ page }) => {
  await checkSyncExplanation(page, 'priortagger', "This upload has pending changes awaiting automatic saving");
});
Then('its synced explanation is available on hover and keyboard focus', async ({ page }) => {
  await checkSyncExplanation(page, 'priortagger', 'All required writes to storage completed');
});
Then('its local-only explanation is available on hover and keyboard focus', async ({ page }) => {
  await checkSyncExplanation(page, 'fielduser', 'Stored collection data; no pending edits in this browser');
});

// --- Entering the workspace -------------------------------------------------

Given("a collection's uploads are listed", async ({ page }) => {
  await openAppConnected(page);
  await selectCollection(page);
  await expect(uploadRow(page, 'priortagger')).toBeVisible();
});

When('an upload is opened', async ({ page }) => {
  await openUpload(page);
});

Then('the tagger switches to the Tag section for that upload', async ({ page }) => {
  await expect(sectionTab(page, 'Tag')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('automatic-save')).toBeVisible();
});

Then(
  "the upload's canonical image list and existing identifications are loaded",
  async ({ page }) => {
    await expect(page.locator('button[title$=".JPG"], button[title$=".MP4"]')).toHaveCount(6);
    await expect(gridCell(page, 'IMG001.JPG')).toContainText('Mule Deer ×2');
    await expect(gridCell(page, 'IMG003.JPG')).toContainText('Ghost');
    await expect(gridCell(page, 'IMG004.JPG')).toContainText('Mountain Lion +1');
  },
);

// Request-state coverage intentionally avoids exposing storage diagnostics.
Given('Browse loads species with {string} outcome', async ({ page, s3, scratch }, state: string) => {
  scratch.speciesOutcome = state;
  if (state === 'failure') s3.failGetsWith('Settings/species.json', 0, 403, 'AccessDenied');
  if (state === 'loading') scratch.releaseSpecies = s3.holdGet('Settings/species.json');
  const before = s3.readCount('Settings/species.json');
  await page.reload(); await connect(page); await selectCollection(page);
  await expect.poll(() => s3.readCount('Settings/species.json')).toBeGreaterThan(before);
});
Then('the collection rail contains no species diagnostic footer', async ({ page }) => {
  await expect(collectionRail(page)).not.toContainText(/species loaded from|Loading species vocabulary|Species vocabulary unavailable|skipped/i);
  await expect(collectionRail(page).locator(':scope > p')).toHaveCount(0);
});
Then('collection uploads remain available', async ({ page, scratch }) => {
  await expect(collectionButton(page, COLLECTION_NAME)).toBeVisible();
  await expect(uploadRow(page, 'priortagger')).toBeVisible();
  if (scratch.speciesOutcome === 'loading') {
    try {
      await openUpload(page);
      await expect(page.getByTestId('species-panel').getByRole('status')).toHaveText('Loading species…');
      await expect(page.getByTestId('species-panel')).not.toContainText('No species in the vocabulary.');
    } finally { (scratch.releaseSpecies as () => void)(); }
    await expect(speciesRow(page, 'Canis latrans')).toBeVisible();
  }
  if (scratch.speciesOutcome === 'success') {
    await openUpload(page);
    await expect(speciesRow(page, 'Canis latrans')).toBeVisible();
  }
});
When('the affected upload is opened for tagging in {string}', async ({ page }, view: string) => {
  await openUpload(page);
  if (view === 'Focus') {
    await focusFrame(page, 'IMG002.JPG');
    await enterFocusView(page);
  }
});
Then('the species panel explains a load failure rather than an empty list', async ({ page }) => {
  const panel = page.getByTestId('species-panel');
  await expect(panel.getByRole('alert')).toContainText("Couldn't load the species list.");
  await expect(panel.getByRole('alert')).toContainText('Check your connection and access permissions, then retry.');
  await expect(panel).not.toContainText('No species in the vocabulary.');
  await expect(panel).not.toContainText('Settings/species.json');
  await expect(panel.getByRole('button', { name: 'Retry loading species' })).toBeVisible();
});
When('the species retry still fails', async ({ page, s3, scratch }) => {
  scratch.speciesReads = s3.readCount('Settings/species.json');
  const retry = page.getByRole('button', { name: 'Retry loading species' });
  await page.getByLabel('Filter species').focus();
  for (let i = 0; i < 12 && !(await retry.evaluate(node => node === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
});
Then('the species panel retains its error and keyboard retry focus', async ({ page, s3, scratch }) => {
  await expect.poll(() => s3.readCount('Settings/species.json')).toBeGreaterThan(scratch.speciesReads as number);
  await expect(page.getByTestId('species-panel').getByRole('alert')).toContainText("Couldn't load");
  await expect(page.getByRole('button', { name: 'Retry loading species' })).toBeFocused();
});
When('the species source recovers and retry is activated from the keyboard', async ({ page, s3 }) => {
  s3.getFailures.delete('Settings/species.json'); s3.getFailureResponses.delete('Settings/species.json');
  const release = s3.holdGet('Settings/species.json');
  await page.keyboard.press('Space');
  try {
    await expect(page.getByTestId('species-panel').getByRole('status')).toHaveText('Retrying the species list…');
    await expect(page.getByRole('button', { name: 'Retry loading species' })).toHaveAttribute('aria-disabled', 'true');
  } finally { release(); }
});
Then('the species list returns and keyboard focus moves to its filter', async ({ page }) => {
  await expect(speciesRow(page, 'Canis latrans')).toBeVisible();
  await expect(page.getByTestId('species-panel').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry loading species' })).toHaveCount(0);
  await expect(page.getByLabel('Filter species')).toBeFocused();
});
Then('loaded species can still be applied', async ({ page }) => {
  const close = page.getByRole('button', { name: 'Close Focus', exact: true });
  if (await close.isVisible()) await close.click();
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});

// --- Free-text upload filter -------------------------------------------------

When("the upload filter searches for an uploader's name", async ({ page }) => {
  await page.getByLabel('Filter uploads').fill('priortagger');
});

Then('only uploads from that uploader remain', async ({ page }) => {
  await expect(uploadRow(page, 'priortagger')).toBeVisible();
  await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
  await expect(uploadRow(page, 'newuploader')).toHaveCount(0);
  await expect(uploadRow(page, 'videoproducer')).toHaveCount(0);
  await expect(uploadRow(page, 'camerauser')).toHaveCount(0);
});

When('the upload filter searches for an upload date', async ({ page }) => {
  await page.getByLabel('Filter uploads').fill('2024-01-15');
});

Then('only the upload made on that date remains', async ({ page }) => {
  await expect(uploadRow(page, 'priortagger')).toBeVisible();
  await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
});

When('the upload filter searches for a location name or site ID', async ({ page }) => {
  await page.getByLabel('Filter uploads').fill('SAN15');
});

Then(
  'uploads recorded at that location remain and uploads without a location are excluded',
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toBeVisible();
    await expect(uploadRow(page, 'fielduser')).toHaveCount(0);
  },
);

When('the upload filter searches for text nothing matches', async ({ page }) => {
  await page.getByLabel('Filter uploads').fill('zzz-no-such-upload-zzz');
});

Then('a message names the filter text when no uploads match', async ({ page }) => {
  await expect(page.getByText('No uploads match')).toContainText('zzz-no-such-upload-zzz');
});

When('the upload filter searches for text shared by two uploaders', async ({ page }) => {
  // Matches "fielduser" (done) and "camerauser" (not done); no one else.
  await page.getByLabel('Filter uploads').fill('user');
});

Then('only the finished upload among them remains', async ({ page }) => {
  await expect(uploadRow(page, 'fielduser')).toBeVisible();
  await expect(uploadRow(page, 'camerauser')).toHaveCount(0);
});

Given("an upload's summary takes time to load", async ({ page, s3 }) => {
  s3.delay(`${PREFIX_B}UploadMeta.json`, 4000);
  await openAppConnected(page);
  await selectCollection(page);
});

When('the upload filter searches for a location that upload does not have', async ({ page }) => {
  // fielduser has no deployments.csv, so it never matches a location query.
  await page.getByLabel('Filter uploads').fill('SAN15');
});

Then(
  "that upload stays visible until its summary resolves, then is hidden because it does not match",
  async ({ page, s3 }) => {
    await expect(uploadRow(page, 'fielduser')).toBeVisible();
    await expect(uploadRow(page, 'fielduser')).toHaveCount(0, { timeout: 15000 });
    s3.delays.clear();
  },
);

Then('it shows the deployment location name\\(s\\) recorded for that upload', async ({ page }) => {
  await expect(uploadRow(page, 'priortagger')).toContainText(LOCATION_NAME);
});
