// How long the Photos view and its switches take with 50 collections and
// 500,000 photos open. Prints one line per interaction: the time to the first
// paint after the click, the time until the new rows show, and the longest
// task the main thread ran meanwhile. Every name, ID and position is made up.

import { test, type Page } from '@playwright/test';
import { putBulkCollections } from '../features/steps/support/bulk';
import { MockS3, installS3Mock, testOrigin } from '../features/steps/support/s3mock';

type Timing = { firstPaint: number; done: number; longest: number };

/** Click the `selector` match whose text starts with `text`, then wait until the expression `ready` is true. */
async function measure(page: Page, click: { selector: string; text: string }, ready: string): Promise<Timing> {
  return page.evaluate(
    async ({ click, ready }) => {
      const tasks: number[] = [];
      const observer = new PerformanceObserver((list) => tasks.push(...list.getEntries().map((e) => e.duration)));
      observer.observe({ type: 'longtask' });
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const target = [...document.querySelectorAll<HTMLElement>(click.selector)].find((el) => el.textContent?.trim().startsWith(click.text));
      const isReady = new Function(`return ${ready}`) as () => boolean;
      if (!target) throw new Error(`no ${click.selector} reading ${click.text}`);
      const t0 = performance.now();
      target.click();
      await frame();
      const firstPaint = performance.now() - t0;
      while (!isReady()) await frame();
      await frame();
      const done = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 300));
      observer.disconnect();
      return { firstPaint, done, longest: Math.max(0, ...tasks) };
    },
    { click, ready },
  );
}

const view = (name: string) => ({ selector: '[aria-label="Show"] button', text: name });
const layout = (name: string) => ({ selector: '[aria-label="Layout"] button', text: name });
const header = (name: string) => ({ selector: '#table th button', text: name });
const has = (selector: string) => `!!document.querySelector(${JSON.stringify(selector)})`;
const sortedBy = (name: string, dir: string) =>
  `[...document.querySelectorAll('#table th[aria-sort="${dir}"]')].some((th) => th.textContent.startsWith(${JSON.stringify(name)})) && ${has('#table tbody tr[data-index]')}`;
const LIST = `!!document.querySelector('#table thead')?.textContent.includes('Date and time') && ${has('#table tbody tr[data-index]')}`;

const STEPS: [string, { selector: string; text: string }, string][] = [
  ['Locations → Photos (Grid)', view('Photos'), has('.gallery .tile')],
  ['Grid → List', layout('List'), LIST],
  ['Sort by Species', header('Species'), sortedBy('Species', 'ascending')],
  ['Sort by Date and time', header('Date and time'), sortedBy('Date and time', 'ascending')],
  ['Photos → Locations', view('Locations'), has('#table .yaxis')],
  ['Locations → Photos (List)', view('Photos'), LIST],
  ['List → Grid', layout('Grid'), has('.gallery .tile')],
  ['Photos → Species', view('Species'), has('#table td .cellbtn')],
  ['Species → Charts', view('Charts'), has('.charts figure')],
  ['Charts → Locations', view('Locations'), has('#table .yaxis')],
];

test('Photos with 50 collections and 500,000 photos', async ({ page }) => {
  const s3 = new MockS3();
  putBulkCollections(s3, 50, 5, 2000);
  await installS3Mock(page, s3);
  // Thumbnail reads are refused at once: a refusal never marks a file gone.
  await page.route(/\.JPG(\?|$)/, (route) => route.fulfill({ status: 403, body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('sparcd-explorer-view', '"locations"');
    localStorage.setItem('sparcd-explorer-photo-layout', '"grid"');
  });
  await page.goto('/sparcd-exploration/explorer-next/');
  await page.locator('#endpoint').fill(testOrigin());
  await page.locator('#accessKey').fill('bench');
  await page.locator('#secretKey').fill('a-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  const opened = Date.now();
  await page.getByRole('button', { name: /^Open \d+ collections together/ }).click();
  await page.locator('#sticky-top').waitFor({ timeout: 15 * 60_000 });
  await page.locator('.fright .result').getByText('500,000 photos').waitFor({ timeout: 5 * 60_000 });
  console.log(`opened in ${((Date.now() - opened) / 1000).toFixed(1)} s`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  const ms = (n: number) => `${Math.round(n)}`.padStart(7);
  console.log(`${'interaction'.padEnd(28)}${'paint'.padStart(7)}${'done'.padStart(7)}${'longest'.padStart(8)}  (ms)`);
  for (const [label, click, ready] of STEPS) {
    const t = await measure(page, click, ready);
    console.log(`${label.padEnd(28)}${ms(t.firstPaint)}${ms(t.done)} ${ms(t.longest)}`);
  }
});
