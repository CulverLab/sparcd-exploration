// Synthetic camera frames for the photo grid: a sky, a ground line and, when
// something was tagged, a dark shape. Night frames are grey, as infrared
// shots are. Each JPEG carries a 160×120 EXIF thumbnail unless asked not to:
// one solid colour of its own, so a test can tell every tile's thumbnail apart.

import { encodeJpeg, withExifThumbnail, type Painter, type Rgb } from '../../../test/support/jpeg';

export type { Rgb };

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb;
const grey = ([r, g, b]: Rgb): Rgb => {
  const y = 0.3 * r + 0.59 * g + 0.11 * b;
  return [y, y, y];
};

function painter(seed: number, cols: number, rows: number, animal: boolean, night: boolean): Painter {
  const sky: Rgb = mix([150, 180, 205], [205, 185, 150], (seed % 7) / 7);
  const ground: Rgb = mix([105, 110, 70], [140, 120, 80], (seed % 5) / 5);
  const horizon = Math.round(rows * (0.45 + (seed % 3) * 0.05));
  const cx = cols * (0.3 + ((seed * 37) % 40) / 100);
  const cy = horizon + rows * 0.12;
  return (x, y) => {
    let c: Rgb = y < horizon ? mix(sky, [235, 235, 225], y / horizon) : mix(ground, [60, 62, 40], (y - horizon) / (rows - horizon));
    if (animal && ((x - cx) / (cols * 0.14)) ** 2 + ((y - cy) / (rows * 0.1)) ** 2 < 1) c = [52, 44, 34];
    return night ? grey(mix(c, [20, 20, 20], 0.35)) : c;
  };
}

const cache = new Map<string, Buffer>();

/** The `n`th photo's thumbnail colour: 512 colours, each channel at least 28 apart. */
export const thumbColor = (n: number): Rgb => [30 + (n % 8) * 28, 30 + (Math.floor(n / 8) % 8) * 28, 30 + (Math.floor(n / 64) % 8) * 28];

/** A frame for one photo; the same arguments give the same bytes. */
export function cameraJpeg(seed: number, opts: { animal: boolean; night: boolean; thumbnail?: Rgb | false }): Buffer {
  const thumb = opts.thumbnail;
  const id = `${seed}|${opts.animal}|${opts.night}|${thumb ? thumb.join(',') : 'none'}`;
  let out = cache.get(id);
  if (!out) {
    const main = encodeJpeg(640, 480, painter(seed, 80, 60, opts.animal, opts.night));
    const bytes = thumb ? withExifThumbnail(main, encodeJpeg(160, 120, () => thumb)) : main;
    cache.set(id, (out = Buffer.from(bytes)));
  }
  return out;
}
