import { describe, expect, it } from 'vitest';
import { tilesInFrame, type BasemapLayer } from '../../src/lib/basemaps';

const LAYER: BasemapLayer = { url: 'https://t.example.org/{z}/{y}/{x}', maxNativeZoom: 16 };
const rad = (deg: number) => (deg * Math.PI) / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
/** The textbook tile index for a place, to check the frame's tiles against. */
const slippy = (lat: number, lon: number, z: number) => [
  Math.floor(((lon + 180) / 360) * 2 ** z),
  Math.floor(((1 - mercY(lat) / Math.PI) / 2) * 2 ** z),
];
/** Pixels per radian at which a tile at zoom `z` is drawn at `px` pixels. */
const scaleFor = (z: number, px = 256) => (px * 2 ** z) / (2 * Math.PI);

const frame = (lat: number, lon: number, scale: number) => ({ cx: rad(lon), cy: mercY(lat), scale, width: 760, height: 360 });

describe('tilesInFrame', () => {
  it('draws a tile at the frame centre exactly where that place falls inside it', () => {
    const [lat, lon, z] = [33.45, -112.07, 9];
    const [x, y] = slippy(lat, lon, z);
    const tiles = tilesInFrame(LAYER, frame(lat, lon, scaleFor(z)));
    const centre = tiles.find((t) => t.url === `https://t.example.org/${z}/${y}/${x}`)!;
    expect(centre.size).toBeCloseTo(256);
    // The frame's centre lands inside that tile, at the place's own offset within it.
    const offX = ((((lon + 180) / 360) * 2 ** z) % 1) * 256;
    const offY = ((((1 - mercY(lat) / Math.PI) / 2) * 2 ** z) % 1) * 256;
    expect(centre.x + offX).toBeCloseTo(380, 6);
    expect(centre.y + offY).toBeCloseTo(180, 6);
  });

  it('covers the whole frame with no gap', () => {
    const tiles = tilesInFrame(LAYER, frame(33.45, -112.07, scaleFor(9, 300)));
    const size = tiles[0].size;
    expect(Math.min(...tiles.map((t) => t.x))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.y))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.x + size))).toBeGreaterThanOrEqual(760);
    expect(Math.max(...tiles.map((t) => t.y + size))).toBeGreaterThanOrEqual(360);
    expect(new Set(tiles.map((t) => `${t.x},${t.y}`)).size).toBe(tiles.length);
  });

  it('picks the zoom that draws a tile closest to its own size', () => {
    const zoomOf = (px: number) => Number(tilesInFrame(LAYER, frame(33, -112, scaleFor(9, px)))[0].url.split('/')[3]);
    expect(zoomOf(256)).toBe(9);
    expect(zoomOf(190)).toBe(9);
    expect(zoomOf(170)).toBe(8);
    expect(zoomOf(370)).toBe(10);
  });

  it('stays within the layer, however far in the frame is', () => {
    const tiles = tilesInFrame({ ...LAYER, maxNativeZoom: 4 }, frame(33, -112, scaleFor(10)));
    expect(tiles.every((t) => t.url.includes('.org/4/'))).toBe(true);
    expect(tiles[0].size).toBeCloseTo(256 * 2 ** 6);
    expect(tiles.length).toBeLessThanOrEqual(4);
  });

  it('wraps across the date line and stops at the poles', () => {
    const tiles = tilesInFrame(LAYER, { cx: rad(179.9), cy: 0, scale: scaleFor(2), width: 760, height: 4000 });
    const parts = tiles.map((t) => t.url.split('/').slice(3).map(Number));
    expect(parts.every(([z]) => z === 2)).toBe(true);
    expect(new Set(parts.map(([, , x]) => x))).toEqual(new Set([2, 3, 0, 1]));
    expect(new Set(parts.map(([, y]) => y))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('keeps the page to a small number of requests', () => {
    expect(tilesInFrame(LAYER, frame(33, -112, scaleFor(9, 182))).length).toBeLessThanOrEqual(30);
  });

  it('fills in subdomains and the retina mark the way the page map does', () => {
    const carto = { url: 'https://{s}.carto.example/{z}/{x}/{y}{r}.png', maxNativeZoom: 19, subdomains: 'abcd' };
    const [lat, lon, z] = [33.45, -112.07, 9];
    const [x, y] = slippy(lat, lon, z);
    const urls = tilesInFrame(carto, frame(lat, lon, scaleFor(z))).map((t) => t.url);
    expect(urls).toContain(`https://${'abcd'[(x + y) % 4]}.carto.example/${z}/${x}/${y}.png`);
  });
});
