import { When, Then, expect, openFindFilter, gridCell, overviewImage, selectedTiles, focusedTile, sectionTab, openUpload } from './support/world';

const panel = (page: import('@playwright/test').Page) => page.locator('#image-filter-panel');
const find = (page: import('@playwright/test').Page) => page.getByLabel('Find image', { exact: true });

Then('the Find and filter rail starts closed', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Find & filter', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(find(page)).not.toBeVisible();
});
When('Find is opened with the slash shortcut', async ({ page }) => {
  await page.keyboard.press('/');
  await expect(find(page)).toBeFocused();
});
Then('Find navigates independently and clearing preserves selection', async ({ page }) => {
  await find(page).fill('IMG004');
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG004.JPG');
  await expect(gridCell(page, 'IMG001.JPG')).toBeVisible();
  await gridCell(page, 'IMG004.JPG').click({ modifiers: ['ControlOrMeta'] });
  const selected = await selectedTiles(page).count();
  expect(selected).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Clear image search' }).click();
  await expect(focusedTile(page)).toHaveAttribute('title', 'IMG004.JPG');
  await expect(selectedTiles(page)).toHaveCount(selected);
});
Then('Reset filter and Close have their distinct clearing behavior', async ({ page }) => {
  await find(page).fill('IMG004');
  await page.getByLabel('Match text').fill('missing');
  await expect(panel(page).getByRole('status')).toHaveText('Showing 0 of 6 images');
  await page.getByRole('button', { name: 'Reset filter', exact: true }).last().click();
  await expect(find(page)).toHaveValue('IMG004');
  await expect(panel(page).getByRole('status')).toHaveText('Showing 6 of 6 images');
  await page.getByLabel('Match text').fill('IMG');
  await panel(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find & filter', exact: true })).toBeFocused();
  await openFindFilter(page);
  await expect(find(page)).toHaveValue('');
  await expect(page.getByLabel('Match text')).toHaveValue('');
  await expect(panel(page).getByRole('status')).toHaveText('Showing 6 of 6 images');
});
Then('all filter radio choices retain their combinations and result counts', async ({ page }) => {
  const scope = page.getByRole('group', { name: 'Search in', exact: true });
  const state = page.getByRole('group', { name: 'Tag state', exact: true });
  await page.getByLabel('Match text').fill('Coyote');
  await scope.getByRole('radio', { name: 'Species', exact: true }).check();
  await state.getByRole('radio', { name: 'Tagged only', exact: true }).check();
  await page.getByLabel('Capture year').fill('2024');
  await expect(panel(page).getByRole('status')).toHaveText('Showing 1 of 6 images');
  await state.getByRole('radio', { name: 'Untagged only', exact: true }).check();
  await expect(panel(page).getByRole('status')).toHaveText('Showing 0 of 6 images');
  await expect(page.getByText('No images match these filters.', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Untagged only', exact: true })).toBeFocused();
  await state.getByRole('radio', { name: 'All images', exact: true }).check();
  for (const [name, text, count] of [['Filename', 'IMG004', 1], ['Date', '2024', 5], ['All fields', 'IMG', 5]] as const) {
    await scope.getByRole('radio', { name, exact: true }).check();
    await page.getByLabel('Match text').fill(text);
    await expect(panel(page).getByRole('status')).toHaveText(`Showing ${count} of 6 images`);
  }
  await scope.getByRole('radio', { name: 'All fields', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(scope.getByRole('radio', { name: 'Filename', exact: true })).toBeChecked();
  for (const [part, value] of [['month', '01'], ['day', '11'], ['hour', '06'], ['minute', '00']]) {
    await page.getByLabel(`Capture ${part}`).fill(value);
  }
  await expect(panel(page).getByRole('status')).toHaveText('Showing 2 of 6 images');
  await page.getByLabel('Capture minute').fill('01');
  await expect(panel(page).getByRole('status')).toHaveText('Showing 0 of 6 images');
  await page.getByRole('button', { name: 'Reset filter', exact: true }).last().click();
  await expect(panel(page).getByRole('status')).toHaveText('Showing 6 of 6 images');
  await expect(scope.getByRole('radio', { name: 'All fields', exact: true })).toBeChecked();
  await expect(state.getByRole('radio', { name: 'All images', exact: true })).toBeChecked();
  for (const part of ['year', 'month', 'day', 'hour', 'minute']) await expect(page.getByLabel(`Capture ${part}`)).toHaveValue('');
});
Then('docked Escape preserves Find and filters and permits outside focus', async ({ page }) => {
  await expect(panel(page)).toHaveAttribute('data-layout', 'docked');
  await find(page).fill('IMG004');
  await page.getByLabel('Match text').fill('IMG');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeVisible();
  await expect(find(page)).toHaveValue('IMG004');
  await expect(page.getByLabel('Match text')).toHaveValue('IMG');
  await panel(page).getByRole('button', { name: 'Reset filter', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => panel(page).evaluate(node => node.contains(document.activeElement))).toBe(false);
});
When('the rail is opened in the {string} Overview', async ({ page }, kind: string) => {
  if (kind === 'list') await page.getByRole('button', { name: '☰ List' }).click();
  await openFindFilter(page);
  await find(page).fill('IMG004');
  await page.getByLabel('Match text').fill('IMG');
});
Then('resizing and increased text size preserve rail values without clipping', async ({ page }) => {
  for (const width of [1440, 1100, 900, 600, 320, 1440]) {
    await page.setViewportSize({ width, height: 860 });
    await expect(panel(page)).toHaveAttribute('data-layout', width === 1440 || width === 900 ? 'docked' : 'overlay');
    await expect(find(page)).toHaveValue('IMG004');
    await expect(page.getByLabel('Match text')).toHaveValue('IMG');
    await expect(page.getByLabel('Match text')).toBeFocused();
    const box = await panel(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(860);
    await panel(page).getByRole('button', { name: 'Reset filter', exact: true }).scrollIntoViewIfNeeded();
    await expect(panel(page).getByRole('button', { name: 'Reset filter', exact: true })).toBeInViewport();
    await expect.poll(() => panel(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/find-filter-${await page.getByRole('button', { name: '☰ List' }).getAttribute('class').then(c => c?.includes('bg-ink') ? 'list' : 'grid')}-${width}.png` });
  }
  // A 720x430 CSS viewport gives the layout space of 200% zoom on 1440x860.
  await page.setViewportSize({ width: 720, height: 430 });
  await expect(panel(page)).toHaveAttribute('data-layout', 'overlay');
  await panel(page).getByRole('button', { name: 'Reset filter', exact: true }).scrollIntoViewIfNeeded();
  await expect(panel(page).getByRole('button', { name: 'Reset filter', exact: true })).toBeInViewport();
  const compact = await panel(page).boundingBox();
  expect(compact!.height).toBeLessThanOrEqual(430);
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.evaluate(() => document.documentElement.style.fontSize = '32px');
  await expect(panel(page)).toHaveAttribute('data-layout', 'overlay');
  await expect(find(page)).toHaveValue('IMG004');
  await expect(page.getByLabel('Match text')).toHaveValue('IMG');
  await page.evaluate(() => document.documentElement.style.fontSize = '');
});
Then('the overlay traps focus and only explicit dismissal clears values', async ({ page }) => {
  await find(page).fill('IMG004');
  await page.getByLabel('Match text').fill('IMG');
  const close = panel(page).getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(panel(page).getByRole('button', { name: 'Reset filter', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await overviewImage(page, 'IMG001.JPG').evaluate((node: HTMLElement) => node.focus());
  await expect(close).toBeFocused();
  await page.mouse.click(1, 1);
  await expect(panel(page)).toBeVisible();
  await expect(find(page)).toHaveValue('IMG004');
  await page.keyboard.press('Escape');
  await expect(panel(page)).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Find & filter', exact: true })).toBeFocused();
  await openFindFilter(page);
  await expect(find(page)).toHaveValue('');
  await expect(page.getByLabel('Match text')).toHaveValue('');
});
Then('Focus excludes the rail and returning closes it without clearing values', async ({ page }) => {
  await find(page).fill('IMG004');
  await page.getByLabel('Match text').fill('IMG');
  await overviewImage(page, 'IMG004.JPG').dblclick();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find & filter', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Focus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find & filter', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Active image filter')).toBeVisible();
  await expect(page.getByLabel('Active image filter')).toContainText('IMG');
  await openFindFilter(page);
  await expect(find(page)).toHaveValue('IMG004');
  await expect(page.getByLabel('Match text')).toHaveValue('IMG');
});

When('the workspace is left for {string} and reopened', async ({ page }, destination: string) => {
  if (destination === 'upload') {
    await sectionTab(page, 'Browse').click();
    await openUpload(page, 'fielduser');
  } else {
    await sectionTab(page, 'Settings').click();
    await sectionTab(page, 'Tag').click();
  }
});

Then('the overlay supports touch clearing, resetting, and closing', async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const tap = async (control: import('@playwright/test').Locator) => {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await find(page).fill('IMG004');
  await tap(page.getByRole('button', { name: 'Clear image search' }));
  await expect(find(page)).toHaveValue('');
  await page.getByLabel('Match text').fill('missing');
  await tap(panel(page).getByRole('button', { name: 'Reset filter', exact: true }));
  await expect(panel(page).getByRole('status')).toHaveText('Showing 6 of 6 images');
  await tap(panel(page).getByRole('button', { name: 'Close', exact: true }));
  await expect(panel(page)).not.toBeVisible();
  await session.detach();
});

Then('the {string} dialog keeps priority while resizing and restores the rail at {int} pixels', async ({ page }, name: string, width: number) => {
  await page.getByRole('button', { name, exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Time shift', exact: true }).getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeEnabled();
  await close.focus();
  await expect(panel(page)).not.toBeVisible();
  for (const resized of [600, 1440, 600, width]) {
    await page.setViewportSize({ width: resized, height: 860 });
    await expect(panel(page)).not.toBeVisible();
    await expect(close).toBeFocused();
    await expect.poll(() => panel(page).evaluate(node => node.matches(':modal'))).toBe(false);
  }
  await close.click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-layout', width === 600 ? 'overlay' : 'docked');
  await expect(find(page)).toHaveValue('IMG004');
  await expect(page.getByLabel('Match text')).toHaveValue('IMG');
  if (width === 600) {
    await expect(find(page)).toBeFocused();
    await page.keyboard.press('Escape');
  } else await panel(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel(page)).not.toBeVisible();
  await openFindFilter(page);
  await expect(find(page)).toHaveValue('');
  await expect(page.getByLabel('Match text')).toHaveValue('');
});

Then('Escape closes only the species dialog after narrowing the window', async ({ page }) => {
  await page.getByRole('button', { name: 'Enlarge Coyote reference image', exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Coyote reference image', exact: true }).getByRole('button', { name: 'Close', exact: true });
  await page.setViewportSize({ width: 600, height: 860 });
  await expect(panel(page)).not.toBeVisible();
  // Observe whether the owning viewer consumes Escape's native dismiss action,
  // including on browsers where the restored rail opens before keyup.
  await page.evaluate(() => window.addEventListener('keydown', (event) => {
    setTimeout(() => {
      document.documentElement.dataset.speciesEscapePrevented = String(event.defaultPrevented);
    }, 0);
  }, { capture: true, once: true }));
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-species-escape-prevented', 'true');
  await expect(close).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(find(page)).toHaveValue('IMG004');
  await expect(page.getByLabel('Match text')).toHaveValue('IMG');
});

When('the rail is open while Species Help opens and the viewport narrows', async ({ page }) => {
  await openFindFilter(page);
  await find(page).fill('IMG004');
  await page.getByLabel('Match text').fill('IMG');
  await page.getByRole('button', { name: 'About the species list', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Using the species list', exact: true });
  await expect(help).toBeVisible();
  await page.setViewportSize({ width: 600, height: 860 });
  await expect(help).toHaveAttribute('aria-modal', 'true');
  await expect(panel(page)).not.toBeVisible();
  await expect.poll(() => panel(page).evaluate(node => node.matches(':modal'))).toBe(false);
});
Then('Species Help remains modal and the rail restores with its values after closing', async ({ page }) => {
  const help = page.getByRole('dialog', { name: 'Using the species list', exact: true });
  await help.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(help).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-layout', 'overlay');
  await expect(find(page)).toHaveValue('IMG004');
  await expect(page.getByLabel('Match text')).toHaveValue('IMG');
});
