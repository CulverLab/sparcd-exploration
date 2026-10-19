import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { When, Then } = createBdd();

When('I open the explorer', async ({ page }) => {
  await page.goto('/sparcd-exploration/explorer-next/');
});

Then('I see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).toBeVisible();
});
