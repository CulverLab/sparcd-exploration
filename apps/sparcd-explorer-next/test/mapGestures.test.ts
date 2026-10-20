import { describe, expect, it } from 'vitest';
import { pinchZoomTarget } from '../src/lib/mapGestures';

describe('pinchZoomTarget', () => {
  it('zooms in on a pinch out (negative delta) and out on a pinch in', () => {
    expect(pinchZoomTarget(8, -50, 2, 18)).toBeCloseTo(8.5);
    expect(pinchZoomTarget(8, 50, 2, 18)).toBeCloseTo(7.5);
  });
  it('stays within the map’s zoom range', () => {
    expect(pinchZoomTarget(17.9, -500, 2, 18)).toBe(18);
    expect(pinchZoomTarget(2.1, 500, 2, 18)).toBe(2);
  });
});
