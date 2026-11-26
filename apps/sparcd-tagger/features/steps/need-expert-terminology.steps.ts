import { type Page } from '@playwright/test';
import { Given, When, Then, expect, focusFrame, enterFocusView, openWorkspace } from './support/world';
import { waitForAutomaticSave } from './support/flows';

const expertAction = (page: Page) => page.getByRole('button', { name: /^Need expert:/ });

Given('the Focus expert action is opened at width {int}', async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 950 });
  await focusFrame(page, 'IMG002.JPG');
  await enterFocusView(page);
});
Then('the Focus Need expert action is {string}', async ({ page }, state: string) => {
  const marked = state === 'marked';
  const description = marked ? 'Need expert: clear request for expert opinion' : 'Need expert: mark image for expert opinion';
  const action = expertAction(page);
  await expect(action).toBeVisible();
  await expect(action).toHaveText('Need expert');
  await expect(action).toHaveAttribute('aria-pressed', String(marked));
  await expect(action).toHaveAccessibleName(description);
  await expect(action).toHaveAttribute('title', description);
  await expect(page.getByRole('button', { name: "Toggle needing an expert's opinion", exact: true })).toHaveAttribute('aria-pressed', String(marked));
  await expect(page.getByTestId('focus-drop-zone').getByTestId('need-expert-badge')).toHaveCount(marked ? 1 : 0);
  await expect(page.getByRole('button', { name: /questionable/i })).toHaveCount(0);
});
When('the Focus Need expert action is toggled', async ({ page }) => {
  await expertAction(page).click();
});
When('the expert request is saved and the same image is reopened', async ({ page }) => {
  await waitForAutomaticSave(page);
  await page.reload();
  await openWorkspace(page);
  await focusFrame(page, 'IMG002.JPG');
  await enterFocusView(page);
});
