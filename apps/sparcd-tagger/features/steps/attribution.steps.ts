import { parseObservations } from '@sparcd/camtrap';
import { Given, When, Then, expect, focusFrame, gridCell, speciesApply } from './support/world';
import { runLiveSync } from './support/flows';
import { BUCKET, PREFIX_A } from './support/data';

Given('Harold is connected as the storage account', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#user')).toHaveValue('testkey');
  await expect(page.locator('#user')).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Tag', exact: true }).click();
});

When('Harold assigns a species to an image', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});

When('the connected account assigns a species to an image', async ({ page }) => {
  await focusFrame(page, 'IMG002.JPG');
  await speciesApply(page, 'Canis latrans').click();
  await expect(gridCell(page, 'IMG002.JPG')).toContainText('Coyote');
});

When('the upload is synced', async ({ page }) => {
  await runLiveSync(page);
});

Then('the new identification records that Harold made it', async ({ s3 }) => {
  const observations = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
  const added = observations.find(
    (observation) => observation.mediaId.endsWith('IMG002.JPG') && observation.scientificName === 'Canis latrans',
  );
  expect(added?.classifiedBy).toBe('testkey');
});

Then("another identifier's work on another image is not attributed to Harold", async ({ s3 }) => {
  const observations = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
  const prior = observations.find(
    (observation) => observation.mediaId.endsWith('IMG004.JPG') && observation.scientificName === 'Puma concolor',
  );
  expect(prior?.classifiedBy).toBe('jdoe');
  expect(prior?.classifiedBy).not.toBe('testkey');
});

Then('the new identification is attributed to {string}', async ({ s3 }, username: string) => {
  const observations = parseObservations(s3.text(BUCKET, `${PREFIX_A}observations.csv`));
  const added = observations.find(
    (observation) => observation.mediaId.endsWith('IMG002.JPG') && observation.scientificName === 'Canis latrans',
  );
  expect(added?.classifiedBy).toBe(username);
});
