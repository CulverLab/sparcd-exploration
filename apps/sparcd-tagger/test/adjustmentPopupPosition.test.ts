import { expect, it } from 'vitest';
import { adjustmentPopupPosition } from '../src/lib/adjustmentPopupPosition';

it('uses the right side when the left side is constrained', () => {
  expect(adjustmentPopupPosition({ left: 10, right: 250, top: 40, width: 240, height: 180 }, { left: 0, right: 224, top: 0, width: 224, height: 260 }, { width: 800, height: 600 }).left).toBe(262);
});

it('uses the right side when the left side would cover a navigation rail', () => {
  expect(adjustmentPopupPosition(
    { left: 280, right: 900, top: 40, width: 620, height: 500 },
    { left: 0, right: 224, top: 0, width: 224, height: 260 },
    { width: 1440, height: 950 },
    [{ left: 0, right: 280, top: 0, width: 280, height: 950 }],
  ).left).toBe(912);
});

it('prefers the left side when it fits', () => {
  expect(adjustmentPopupPosition({ left: 400, right: 640, top: 40, width: 240, height: 180 }, { left: 0, right: 224, top: 0, width: 224, height: 260 }, { width: 800, height: 600 })).toEqual({ left: 164, top: 40 });
});

it('uses the clamped side with the least media overlap when neither side fits', () => {
  const position = adjustmentPopupPosition(
    { left: 70, right: 220, top: 40, width: 150, height: 180 },
    { left: 0, right: 224, top: 0, width: 224, height: 260 },
    { width: 320, height: 600 },
  );
  expect(position.left).toBe(88);
});

it('keeps constrained placement off the navigation rail', () => {
  expect(adjustmentPopupPosition(
    { left: 100, right: 1_000, top: 40, width: 900, height: 500 },
    { left: 0, right: 224, top: 0, width: 224, height: 260 },
    { width: 1_000, height: 700 },
    [{ left: 0, right: 280, top: 0, width: 280, height: 700 }],
  ).left).toBe(768);
});

it('keeps a short viewport placement inside its gutters', () => {
  expect(adjustmentPopupPosition(
    { left: 300, right: 540, top: 120, width: 240, height: 180 },
    { left: 0, right: 224, top: 0, width: 224, height: 134 },
    { width: 800, height: 150 },
  ).top).toBe(8);
});

it('falls back to the left when the species sidebar blocks the right', () => {
  const media = { left: 480, right: 1_092, top: 40, width: 612, height: 800 };
  const panel = { left: 0, right: 224, top: 0, width: 224, height: 260 };
  const viewport = { width: 1_440, height: 950 };
  const rail = { left: 0, right: 280, top: 0, width: 280, height: 950 };
  const sidebar = { left: 1_100, right: 1_440, top: 0, width: 340, height: 950 };
  expect(adjustmentPopupPosition(media, panel, viewport, [rail]).left).toBe(1_104);
  expect(adjustmentPopupPosition(media, panel, viewport, [rail, sidebar]).left).toBe(244);
});

it('drops below the media when neither side fits a phone-width viewport', () => {
  expect(adjustmentPopupPosition(
    { left: 20, right: 370, top: 260, width: 350, height: 300 },
    { left: 0, right: 224, top: 0, width: 224, height: 260 },
    { width: 390, height: 844 },
  )).toEqual({ left: 8, top: 572 });
});

// The measured Focus layout at 1440x950: a 788px-wide image leaves 16px either
// side of it, so the panel has to share a rail. Sitting low keeps the rail's
// first rows, the species filter and the image itself readable.
it('sits low beside a desktop image which fills its column', () => {
  expect(adjustmentPopupPosition(
    { left: 296, right: 1_084, top: 137.5, width: 788, height: 718.5 },
    { left: 0, right: 224, top: 0, width: 224, height: 236 },
    { width: 1_440, height: 950 },
    [
      { left: 0, right: 280, top: 121.5, width: 280, height: 750.5 },
      { left: 1_100, right: 1_440, top: 121.5, width: 340, height: 828.5 },
    ],
  )).toEqual({ left: 60, top: 706 });
});

// The measured Focus layout at 390x844: the image runs off the bottom of the
// window, so over it is the only clear spot.
it('rises above a phone image which runs past the bottom of the window', () => {
  expect(adjustmentPopupPosition(
    { left: 16, right: 374, top: 666.6875, width: 358, height: 290.1875 },
    { left: 0, right: 224, top: 0, width: 224, height: 320 },
    { width: 390, height: 844 },
  )).toEqual({ left: 8, top: 334.6875 });
});

// The left rail runs the full height while the species list stops short, so
// only the right side has a clear spot under the image.
it('drops under the image on whichever side is clear', () => {
  expect(adjustmentPopupPosition(
    { left: 296, right: 1_084, top: 137.5, width: 788, height: 500 },
    { left: 0, right: 224, top: 0, width: 224, height: 236 },
    { width: 1_440, height: 950 },
    [
      { left: 0, right: 270, top: 121.5, width: 270, height: 828.5 },
      { left: 1_100, right: 1_440, top: 121.5, width: 340, height: 478.5 },
    ],
  )).toEqual({ left: 1_096, top: 649.5 });
});
