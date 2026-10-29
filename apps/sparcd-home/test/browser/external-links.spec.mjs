import { test, expect } from '@playwright/test';
import { pathToFileURL, fileURLToPath } from 'node:url';

const home = pathToFileURL(fileURLToPath(new URL('../../index.html', import.meta.url))).href;
const destinations = [
  ['Open Source', 'https://opensource.org/osd'],
  ['View on GitHub', 'https://github.com/CulverLab/sparcd-exploration'],
  ['Wildcat Research', 'https://www.wildcatresearch.arizona.edu/'],
];

test.beforeEach(async ({ context, page }) => {
  // Use the actual static Home document; keep third-party fonts and popup
  // destinations deterministic and independent of external services.
  await context.route('https://**', (route) => {
    if (destinations.some(([, url]) => route.request().url() === url)) {
      return route.fulfill({ contentType: 'text/html', body: '<title>External destination</title>' });
    }
    return route.abort();
  });
  await page.goto(home);
});

for (const width of [320, 1280]) {
  for (const colorScheme of ['light', 'dark']) {
    test(`external labels and icons fit at ${width}px in ${colorScheme} mode`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      for (const [label] of destinations) {
        const link = page.getByRole('link', { name: label, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveAccessibleDescription('Opens in a new tab or window.');
        await expect(link.locator('svg')).toBeVisible();
        const layout = await link.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const icon = element.lastElementChild.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element.firstChild);
          const text = range.getBoundingClientRect();
          return {
            insideViewport: bounds.left >= 0 && bounds.right <= innerWidth,
            iconAfterText: icon.left > text.right,
            iconInside: icon.right <= bounds.right + 1 && icon.top >= bounds.top - 1 && icon.bottom <= bounds.bottom + 1,
          };
        });
        expect(layout).toEqual({ insideViewport: true, iconAfterText: true, iconInside: true });
      }
    });
  }
}

test('keyboard activation opens each destination separately and preserves Home', async ({ page }) => {
  // Theme button and the three existing app cards precede the footer links.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  for (const [label, url] of destinations) {
    await page.keyboard.press('Tab');
    const link = page.getByRole('link', { name: label, exact: true });
    await expect(link).toBeFocused();
    const outline = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThan(0);
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
    await popup.waitForLoadState();
    await expect(popup).toHaveURL(url);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await expect(page).toHaveURL(home);
    await expect(page.locator('nav[aria-label="Tools"]')).toBeVisible();
    await popup.close();
  }
});
