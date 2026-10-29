import { describe, expect, it } from 'vitest';
import { formatFocusPosition } from '../src/lib/focusPosition';

describe('formatFocusPosition', () => {
  it('formats large full-list positions with the browser locale', () => {
    expect(formatFocusPosition(201, 4500, false, 'en-US')).toBe('Image 201 of 4,500 total');
    expect(formatFocusPosition(1201, 4500, false, 'de-DE')).toBe('Image 1.201 of 4.500 total');
  });

  it('keeps a one-item filtered list distinct from the full list', () => {
    expect(formatFocusPosition(1, 1, true, 'en-US')).toBe('Image 1 of 1 filtered');
  });
});
