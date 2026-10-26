// Synthetic JPEGs for tests: a tiny baseline encoder where every 8×8 block is
// one flat colour (DC coefficients only), and an EXIF wrapper that embeds a
// second JPEG as the IFD1 thumbnail, the way cameras do. No real photos.

export type Rgb = [number, number, number];
/** The colour of the block at block column `x`, row `y`. */
export type Painter = (x: number, y: number) => Rgb;

class BitWriter {
  readonly bytes: number[] = [];
  private acc = 0;
  private n = 0;

  put(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        // A 0xFF data byte is stuffed with a zero so it never reads as a marker.
        if (this.acc === 0xff) this.bytes.push(0);
        this.acc = 0;
        this.n = 0;
      }
    }
  }

  /** Pad the last byte with ones. */
  end(): number[] {
    if (this.n) this.put((1 << (8 - this.n)) - 1, 8 - this.n);
    return this.bytes;
  }
}

// The standard luminance DC table (categories 0-11), and an AC table that only
// needs end-of-block.
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const AC_VALS = [0x00, 0x01];

function codes(bits: number[], vals: number[]): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) out.set(vals[k++], [code++, len]);
    code <<= 1;
  }
  return out;
}
const DC = codes(DC_BITS, DC_VALS);
const EOB = codes(AC_BITS, AC_VALS).get(0)!;

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const segment = (marker: number, body: number[]) => [0xff, marker, ...u16(body.length + 2), ...body];
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** A baseline JPEG of `width` × `height` (multiples of 8), one colour per 8×8 block. */
export function encodeJpeg(width: number, height: number, paint: Painter): Uint8Array {
  const bits = new BitWriter();
  const previous = [0, 0, 0];
  for (let by = 0; by < height / 8; by++) {
    for (let bx = 0; bx < width / 8; bx++) {
      const [r, g, b] = paint(bx, by);
      const ycc = [
        0.299 * r + 0.587 * g + 0.114 * b,
        128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
        128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
      ];
      ycc.forEach((v, c) => {
        // A flat block's only coefficient: 8 × (value - 128), quantized by 1.
        const dc = 8 * (clamp(v) - 128);
        const diff = dc - previous[c];
        previous[c] = dc;
        const category = diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1;
        const [code, len] = DC.get(category)!;
        bits.put(code, len);
        if (category) bits.put(diff >= 0 ? diff : diff + (1 << category) - 1, category);
        bits.put(EOB[0], EOB[1]);
      });
    }
  }
  const components = [1, 2, 3].flatMap((id) => [id, 0x11, 0]);
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xdb, [0x00, ...new Array(64).fill(1)]),
    ...segment(0xc0, [8, ...u16(height), ...u16(width), 3, ...components]),
    ...segment(0xc4, [0x00, ...DC_BITS, ...DC_VALS, 0x10, ...AC_BITS, ...AC_VALS]),
    ...segment(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]),
    ...bits.end(),
    0xff, 0xd9,
  ]);
}

/**
 * `main` with an EXIF APP1 segment after its start marker whose IFD1 holds
 * `thumb` as the embedded JPEG thumbnail (little-endian TIFF).
 */
export function withExifThumbnail(main: Uint8Array, thumb: Uint8Array): Uint8Array {
  const ifd0 = 8;
  const ifd1 = ifd0 + 2 + 12 + 4;
  const at = ifd1 + 2 + 3 * 12 + 4;
  const tiff = new Uint8Array(at + thumb.length);
  const v = new DataView(tiff.buffer);
  v.setUint16(0, 0x4949);
  v.setUint16(2, 42, true);
  v.setUint32(4, ifd0, true);
  const entry = (offset: number, tag: number, type: number, value: number) => {
    v.setUint16(offset, tag, true);
    v.setUint16(offset + 2, type, true);
    v.setUint32(offset + 4, 1, true);
    if (type === 3) v.setUint16(offset + 8, value, true);
    else v.setUint32(offset + 8, value, true);
  };
  // IFD0: Orientation, then the link to IFD1.
  v.setUint16(ifd0, 1, true);
  entry(ifd0 + 2, 0x0112, 3, 1);
  v.setUint32(ifd0 + 14, ifd1, true);
  // IFD1: a JPEG thumbnail at `at`.
  v.setUint16(ifd1, 3, true);
  entry(ifd1 + 2, 0x0103, 3, 6);
  entry(ifd1 + 14, 0x0201, 4, at);
  entry(ifd1 + 26, 0x0202, 4, thumb.length);
  v.setUint32(ifd1 + 38, 0, true);
  tiff.set(thumb, at);
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const out = new Uint8Array(main.length + 4 + payload.length);
  out.set([0xff, 0xd8, 0xff, 0xe1, ...u16(payload.length + 2), ...payload]);
  out.set(main.subarray(2), 4 + payload.length + 2);
  return out;
}
