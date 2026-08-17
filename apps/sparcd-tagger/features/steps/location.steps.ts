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
} from './support/world';
import { LOCATION_NAME, DEPLOYMENT } from './support/data';

const SENSITIVITY_WORDS =
  /sensitiv|protected species|redact|coarsen|withheld|obfuscat|restricted location/i;

Given('the tagger is connected with credentials that can read a collection', async ({ page }) => {
  await openAppConnected(page);
});

Then(
  'each upload shows the location name\\(s\\) recorded in its deployment file',
  async ({ page }) => {
    await expect(uploadRow(page, 'priortagger')).toContainText(LOCATION_NAME);
  },
);

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
  'the deployment identifier recorded for that image is shown alongside its file name',
  async ({ page }) => {
    const caption = page.locator('div.text-\\[14px\\].font-mono').filter({ hasText: 'IMG001.JPG' });
    await expect(caption).toContainText('IMG001.JPG');
    // The readable tail of `<collection-uuid>:<location-id>`.
    await expect(caption).toContainText(DEPLOYMENT.split(':').pop()!);
  },
);

When('any view, dialog or synced file is produced', async ({ page }) => {
  await selectCollection(page);
  await openUpload(page);
});

Then('no species is treated as sensitive', async ({ page }) => {
  const surfaces: string[] = [];
  surfaces.push(await page.locator('body').innerText());

  await page.getByRole('button', { name: 'Sync…' }).click();
  await expect(page.getByRole('heading', { name: 'Sync to S3' })).toBeVisible();
  surfaces.push(await page.locator('body').innerText());
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Snapshots…' }).click();
  await expect(page.getByRole('heading', { name: 'Snapshots' })).toBeVisible();
  surfaces.push(await page.locator('body').innerText());
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();

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
    await enterFocusView(page);
    await expect(page.locator('body')).toContainText(DEPLOYMENT.split(':').pop()!);
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
