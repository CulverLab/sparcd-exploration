import {
  Given,
  When,
  Then,
  expect,
  openAppConnected,
  selectCollection,
  openUpload,
  uploadRow,
  gridCell,
  sectionTab,
  enterFocusView,
  focusFrame,
  speciesApply,
} from './support/world';
import { LOCATION_NAME, DEPLOYMENT, BUCKET, PREFIX_A, PREFIX_B, PREFIX_C, UUID, SETTINGS_BUCKET } from './support/data';
import { MEDIA_COL, parseCsvRows, parseObservations, serializeCsvRows } from '@sparcd/camtrap';
import { waitForAutomaticSave } from './support/flows';

const SENSITIVITY_WORDS =
  /sensitiv|protected species|redact|coarsen|withheld|obfuscat|restricted location/i;

Given('the connected account cannot read exact coordinates', async ({ s3 }) => {
  s3.exactLocations = false;
});

Given('the connected account can read exact coordinates', async ({ s3 }) => {
  s3.exactLocations = true;
  // Exercise shared-settings fallback: the settings registry remains redacted
  // even when collection membership grants exact deployment coordinates.
  s3.delete(BUCKET, `Collections/${UUID}/locations.json`);
});

Then('the location identity remains visible but precise coordinates and location editing do not', async ({ page, s3 }) => {
  await expect(uploadRow(page, 'priortagger')).toContainText(LOCATION_NAME);
  await selectCollection(page);
  await openUpload(page);
  await enterFocusView(page);
  await expect(page.getByRole('button', { name: 'Change location' })).toHaveCount(0);
  await expect(page.locator('body')).toContainText(LOCATION_NAME);
  await expect(page.locator('body')).toContainText('SAN15');
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/31\.500000|-110\.200000/);
  expect(s3.servedBody(BUCKET, `Collections/${UUID}/locations.json`) ?? '').not.toMatch(/31\.5|-110\.2/);
  expect(s3.servedBody(BUCKET, `${PREFIX_A}deployments.csv`) ?? '').not.toMatch(/31\.500000|-110\.200000/);
});

When('the user identifies the focused image and automatic saving finishes', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await waitForAutomaticSave(page);
});

Then('the identification is saved', async ({ s3 }) => {
  expect(parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`)).some(row => row.scientificName === 'Canis latrans')).toBe(true);
});

Then('the saved identification does not disclose precise coordinates', async ({ page, s3 }) => {
  expect(s3.servedBody(BUCKET, `Collections/${UUID}/locations.json`) ?? '').not.toMatch(/31\.5|-110\.2/);
  expect(s3.servedBody(BUCKET, `${PREFIX_A}deployments.csv`) ?? '').not.toMatch(/31\.500000|-110\.200000/);
  expect(await page.locator('body').innerText()).not.toMatch(/31\.500000|-110\.200000/);
});

Then('the identification is saved to the fresh upload', async ({ s3 }) => {
  const rows = parseObservations(s3.text(BUCKET, `${PREFIX_C}observations.csv`));
  expect(rows.some(row => row.mediaId.endsWith('/IMG002.JPG') && row.scientificName === 'Canis latrans')).toBe(true);
});

Then('the saved identification does not disclose precise coordinates for the fresh upload', async ({ page, s3 }) => {
  expect(s3.servedBody(BUCKET, `Collections/${UUID}/locations.json`) ?? '').not.toMatch(/31\.5|-110\.2/);
  expect(s3.servedBody(BUCKET, `${PREFIX_C}deployments.csv`) ?? '').not.toMatch(/31\.500000|-110\.200000/);
  expect(await page.locator('body').innerText()).not.toMatch(/31\.500000|-110\.200000/);
});

Then('no location is hidden, coarsened or withheld when the connected account has exact-coordinate permission', async ({ page }) => {
  await sectionTab(page, 'Browse').click();
  await expect(uploadRow(page, 'priortagger')).toContainText(LOCATION_NAME);
});

Then('the exact coordinates remain available to the authorized account', async ({ s3 }) => {
  await expect.poll(() => s3.servedBody(SETTINGS_BUCKET, 'Settings/locations.json') ?? '').toContain('"latProperty":null');
  await expect.poll(() => s3.servedBody(SETTINGS_BUCKET, 'Settings/locations.json') ?? '').not.toMatch(/31\.5|-110\.2/);
  await expect.poll(() => s3.servedBody(BUCKET, `${PREFIX_A}deployments.csv`) ?? '').toMatch(/31\.500000/);
  await expect.poll(() => s3.servedBody(BUCKET, `${PREFIX_A}deployments.csv`) ?? '').toMatch(/-110\.200000/);
});

Given('the tagger is connected with credentials that can read a collection', async ({ page }) => {
  await openAppConnected(page);
});



Then('no location is withheld on the grounds of the species in the images', async ({ page }) => {
  // The upload carries a Mountain Lion identification; its location is shown in
  // full all the same, and nothing in the view mentions any sensitivity concept.
  await expect(uploadRow(page, 'priortagger')).toContainText(LOCATION_NAME);
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(SENSITIVITY_WORDS);
});

Given('an image is open in the Focus view', async ({ page }) => {
  await selectCollection(page);
  await openUpload(page);
  await enterFocusView(page);
});

Then(
  "the location name and ID recorded for that image's deployment are shown alongside its file name",
  async ({ page }) => {
    const focus = page.getByRole('dialog', { name: 'Focus image viewer' });
    await expect(focus).toContainText('IMG001.JPG');
    await expect(focus).not.toContainText(DEPLOYMENT);
    await expect(focus.getByLabel(`Location: ${LOCATION_NAME} (SAN15)`)).toBeVisible();
  },
);

Given('an image is open in the Focus view for an upload with no readable deployment file', async ({ page, s3 }) => {
  expect(s3.has(BUCKET, `${PREFIX_B}deployments.csv`)).toBe(false);
  await openAppConnected(page);
  await selectCollection(page);
  await openUpload(page, 'fielduser');
  await enterFocusView(page);
});

Then('no location is shown alongside its file name', async ({ page }) => {
  const focus = page.getByRole('dialog', { name: 'Focus image viewer' });
  await expect(focus).toContainText(/\.(JPG|MP4)/);
  await expect(focus.getByLabel(/^Location:/)).toHaveCount(0);
});

Given(/^the recorded deployment has (an empty file|no location name|no location ID|whitespace fields)$/, async ({ s3 }, state: string) => {
  const key = `${PREFIX_A}deployments.csv`;
  if (state === 'an empty file') {
    s3.put(BUCKET, key, '', 'text/csv');
    return;
  }
  const rows = parseCsvRows(s3.text(BUCKET, key));
  if (state === 'no location name') rows[0][2] = '';
  else if (state === 'no location ID') rows[0][1] = '';
  else {
    rows[0][1] = '  ';
    rows[0][2] = '\t ';
  }
  s3.put(BUCKET, key, serializeCsvRows(rows), 'text/csv');
});

When('the recorded location lookup becomes unreadable', async ({ page, s3 }) => {
  const key = `${PREFIX_A}deployments.csv`;
  await expect(page.getByLabel(`Location: ${LOCATION_NAME} (SAN15)`)).toBeVisible();
  const before = s3.readCount(key);
  s3.failGetsWith(key, 0, 403, 'AccessDenied');
  await page.clock.install();
  await page.clock.fastForward(61_000);
  // Model switching away and returning: Query only refetches on an actual
  // visibility transition, rather than a duplicate event while already focused.
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    }
    Reflect.deleteProperty(document, 'visibilityState');
  });
  await expect.poll(() => s3.readCount(key)).toBeGreaterThan(before);
  await expect(page.getByRole('dialog', { name: 'Focus image viewer' }).getByLabel(/^Location:/)).toHaveCount(0);
});

const LONG_LOCATION_NAME = 'San Pedro research station beside the western mountain range and riparian corridor';
const LONG_LOCATION_ID = 'SAN15-WESTERN-RIPARIAN-CORRIDOR';

Given('the recorded location has a long name and ID and the image has an EXIF warning', async ({ s3 }) => {
  const deploymentsKey = `${PREFIX_A}deployments.csv`;
  const deployments = parseCsvRows(s3.text(BUCKET, deploymentsKey));
  deployments[0][1] = LONG_LOCATION_ID;
  deployments[0][2] = LONG_LOCATION_NAME;
  s3.put(BUCKET, deploymentsKey, serializeCsvRows(deployments), 'text/csv');
  const mediaKey = `${PREFIX_A}media.csv`;
  const media = parseCsvRows(s3.text(BUCKET, mediaKey));
  media[0][MEDIA_COL.comments] = '[TIMESTAMP:exif-modify]';
  s3.put(BUCKET, mediaKey, serializeCsvRows(media), 'text/csv');
});

Then('the Focus header fits at {int} pixels with its full accessible location', async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 900 });
  const focus = page.getByRole('dialog', { name: 'Focus image viewer' });
  const location = focus.getByLabel(`Location: ${LONG_LOCATION_NAME} (${LONG_LOCATION_ID})`);
  await expect(location).toBeVisible();
  await expect(location).toHaveAttribute('title', `Location: ${LONG_LOCATION_NAME} (${LONG_LOCATION_ID})`);
  const controls = [
    focus.getByText('Focus · IMG001.JPG', { exact: true }),
    location,
    focus.getByText('EXIF Modified', { exact: true }),
    focus.getByRole('button', { name: 'Close Focus', exact: true }),
  ];
  const boxes = [];
  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    boxes.push(box!);
  }
  expect(boxes[0].width).toBeGreaterThanOrEqual(80);
  expect(boxes[3].width).toBeGreaterThanOrEqual(44);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
    }
  }
  await controls[3].click();
  await expect(focus).toHaveCount(0);
});

When('any view, dialog or synced file is produced', async ({ page }) => {
  await selectCollection(page);
  await openUpload(page);
});

Then('no species is treated as sensitive', async ({ page }) => {
  const surfaces: string[] = [];
  surfaces.push(await page.locator('body').innerText());

  await page.getByRole('button', { name: 'Time shift', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Time shift', exact: true })).toBeVisible();
  surfaces.push(await page.locator('body').innerText());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await sectionTab(page, 'Settings').click();
  surfaces.push(await page.locator('body').innerText());
  await sectionTab(page, 'Tag').click();

  for (const text of surfaces) expect(text).not.toMatch(SENSITIVITY_WORDS);
  // The Mountain Lion row is offered exactly like every other species.
  await expect(page.locator('div.group').filter({ hasText: 'Puma concolor' })).toBeVisible();
});

Then(
  'no location is hidden, coarsened or withheld from any connected user',
  async ({ page }) => {
    await sectionTab(page, 'Browse').click();
    await expect(uploadRow(page, 'priortagger')).toContainText(LOCATION_NAME);
  },
);

When('an image is displayed', async ({ page }) => {
  await selectCollection(page);
  await openUpload(page);
  await expect(gridCell(page, 'IMG001.JPG').locator('img')).toBeVisible();
});

Then('it is fetched through a link signed with the connected credentials', async ({ page }) => {
  const src = await gridCell(page, 'IMG001.JPG').locator('img').getAttribute('src');
  const url = new URL(src!);
  expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
  expect(url.searchParams.get('X-Amz-Credential')).toContain('testkey');
  expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
});

Then('that link expires about an hour after it is issued', async ({ page }) => {
  const src = await gridCell(page, 'IMG001.JPG').locator('img').getAttribute('src');
  expect(new URL(src!).searchParams.get('X-Amz-Expires')).toBe('3600');
});

Then('it grants whatever the connected credentials already grant, no less', async ({ page }) => {
  const src = await gridCell(page, 'IMG001.JPG').locator('img').getAttribute('src');
  const params = [...new URL(src!).searchParams.keys()].filter((k) => k.startsWith('X-Amz-')).sort();
  // A plain SigV4 GET presign: no policy, no session token, no extra scoping —
  // the URL simply re-uses the connected key's own permissions. (`x-id` is the
  // SDK's own operation marker, not an access restriction.)
  expect(params).toEqual([
    'X-Amz-Algorithm',
    'X-Amz-Content-Sha256',
    'X-Amz-Credential',
    'X-Amz-Date',
    'X-Amz-Expires',
    'X-Amz-Signature',
    'X-Amz-SignedHeaders',
  ]);
  expect(new URL(src!).searchParams.get('X-Amz-Security-Token')).toBeNull();
});

Then(
  'each upload shows the location name\\(s\\) recorded in its deployment file',
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toContainText(LOCATION_NAME);
  },
);
