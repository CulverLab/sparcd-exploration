import { describe, expect, it } from 'vitest';
import { gestureZoom } from '../src/lib/mapGestures';

describe('gestureZoom', () => {
  it('zooms a level per doubling of the pinch scale, from where the pinch started', () => {
    expect(gestureZoom(8, 2, 2, 18)).toBeCloseTo(9);
    expect(gestureZoom(8, 0.5, 2, 18)).toBeCloseTo(7);
    expect(gestureZoom(8, 1.5, 2, 18)).toBeCloseTo(8 + Math.log2(1.5));
    expect(gestureZoom(8, 1, 2, 18)).toBe(8);
  });
  it('stays within the map’s zoom range', () => {
    expect(gestureZoom(17.5, 4, 2, 18)).toBe(18);
    expect(gestureZoom(2.5, 0.25, 2, 18)).toBe(2);
  });
});
