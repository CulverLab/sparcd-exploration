// Steps for the preview feedback (Juli4nG/sparcd-explorer-preview#1–#7).

import type { Locator } from '@playwright/test';
import { ALPHA, addUpload } from './support/data';
import { Given, Then, When, expect } from './support/world';

// --- #4 Year labels that never pile up -------------------------------------------

Given('{string} also has photos from {int}', async ({ s3 }, _name: string, year: number) => {
  addUpload(s3, ALPHA, {
    stamp: `${year}.06.01.10.00.00_fielduser`,
    deployment: { id: 'AB08', name: 'Old Spring', lat: 0.56, lon: -150.2, elevation: 1250 },
    photos: [{ file: 'IMG0801.JPG', time: `${year}-05-10T08:00:00` }],
  });
});

/** Each label's left and right edge, in order. */
async function labelEdges(labels: Locator): Promise<{ text: string; left: number; right: number }[]> {
  return labels.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent ?? '', left: r.left, right: r.right };
    }),
  );
}

async function expectApart(labels: Locator, first: string) {
  const edges = await labelEdges(labels);
  expect(edges[0].text).toBe(first);
  expect(edges.length).toBeGreaterThan(1);
  for (let i = 1; i < edges.length; i++) expect(edges[i].left - edges[i - 1].right).toBeGreaterThanOrEqual(4);
}

Then('the Activity year labels start at {string} and none touch', async ({ page }, first: string) => {
  await expectApart(page.locator('#table .yaxis span'), first);
});

Then('the effort strip year labels start at {string} and none touch', async ({ page }, first: string) => {
  await expectApart(page.locator('svg.effort text.year'), first);
});
