import { describe, expect, it } from 'vitest';
import { gestureZoom, splitPan, wheelPixels, wheelZoom } from '../src/lib/mapGestures';

describe('wheelZoom', () => {
  it('zooms a level per doubling of a Chrome pinch, which sends deltaY = −100·ln(scale)', () => {
    expect(wheelZoom(8, -100 * Math.log(2))).toBeCloseTo(9);
    expect(wheelZoom(8, 100 * Math.log(2))).toBeCloseTo(7);
    expect(wheelZoom(8, -100 * Math.log(1.5))).toBeCloseTo(8 + Math.log2(1.5));
    expect(wheelZoom(8, 0)).toBe(8);
  });
  it('zooms at most a level for one Ctrl + mouse wheel notch', () => {
    expect(wheelZoom(8, -500)).toBeCloseTo(9);
    expect(wheelZoom(8, 500)).toBeCloseTo(7);
  });
});

describe('gestureZoom', () => {
  it('zooms a level per doubling of Safari’s pinch scale, from where the pinch started', () => {
    expect(gestureZoom(8, 2)).toBeCloseTo(9);
    expect(gestureZoom(8, 0.5)).toBeCloseTo(7);
    expect(gestureZoom(8, 1.5)).toBeCloseTo(8 + Math.log2(1.5));
    expect(gestureZoom(8, 1)).toBe(8);
  });
});

describe('wheelPixels', () => {
  it('reads a wheel delta in pixels, 16 px lines, or pages the map’s height', () => {
    expect(wheelPixels(0, 360)).toBe(1);
    expect(wheelPixels(1, 360)).toBe(16);
    expect(wheelPixels(2, 360)).toBe(360);
  });
});

describe('splitPan', () => {
  it('moves whole pixels and carries the rest', () => {
    const { step, rest } = splitPan({ x: 2.4, y: -1.6 });
    expect(step).toEqual({ x: 2, y: -2 });
    expect(rest.x).toBeCloseTo(0.4);
    expect(rest.y).toBeCloseTo(0.4);
  });
  it('keeps up with a slow drag, a fraction of a pixel at a time', () => {
    let pan = { x: 0, y: 0 };
    let moved = 0;
    for (let i = 0; i < 10; i++) {
      const { step, rest } = splitPan({ x: pan.x + 0.3, y: pan.y });
      moved += step.x;
      pan = rest;
    }
    expect(moved + pan.x).toBeCloseTo(3);
    expect(moved).toBe(3);
  });
});
