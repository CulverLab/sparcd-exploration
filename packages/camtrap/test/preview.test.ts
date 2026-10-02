import { expect, it } from 'vitest';
import { PREVIEW_NAME, previewKeyFor } from '../src';

const hash = 'a'.repeat(64);

it('derives only original keys in the Media hash layout', () => {
  expect(previewKeyFor(`Media/${hash}/x.jpg`)).toBe(`Media/${hash}/${PREVIEW_NAME}`);
  expect(previewKeyFor('Uploads/x.jpg')).toBeUndefined();
  expect(previewKeyFor(`Media/${hash}/${PREVIEW_NAME}`)).toBeUndefined();
  expect(previewKeyFor(`Media/${hash}/nested/x.jpg`)).toBeUndefined();
});
