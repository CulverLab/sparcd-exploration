// Steps whose exact wording is shared by more than one feature file.

import { Given, Then, expect } from './fixtures';

Given('the uploader is connected', async ({ app }) => {
  await app.connect();
});

Then('the Continue button is disabled', async ({ app }) => {
  await expect(app.continueButton()).toBeDisabled();
});
