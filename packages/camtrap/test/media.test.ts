import { describe, it, expect } from 'vitest';
import {
  captureStamp,
  existingOriginal,
  isOriginalName,
  mediaKey,
  mediaObjectName,
  UNKNOWN_CAPTURE_STAMP,
} from '../src/index';

const SHA = '1f3a'.padEnd(64, '0');

describe('captureStamp', () => {
  it('formats camera-local wall-clock time as YYYYMMDDHHmmss', () => {
    expect(captureStamp({ year: 2021, month: 5, day: 31, hour: 8, minute: 25, second: 38 })).toBe('20210531082538');
  });

  it('is fourteen zeros when there is no capture time', () => {
    expect(captureStamp(undefined)).toBe('00000000000000');
    expect(UNKNOWN_CAPTURE_STAMP).toHaveLength(14);
  });
});

describe('mediaKey', () => {
  it('puts the stamped camera filename in the hash folder', () => {
    expect(mediaKey(SHA, '20210531082538', 'RCNX0031.JPG')).toBe(`Media/${SHA}/20210531082538-RCNX0031.JPG`);
  });
});

describe('isOriginalName / existingOriginal', () => {
  it('tells stamped originals from derived files', () => {
    expect(isOriginalName('20210531082538-RCNX0031.JPG')).toBe(true);
    expect(isOriginalName('00000000000000-IMG_1.JPG')).toBe(true);
    expect(isOriginalName('preview-640.jpg')).toBe(false);
    expect(isOriginalName('20210531082538-')).toBe(false);
  });

  it('ignores derived files and picks the alphabetically first original', () => {
    const folder = `Media/${SHA}/`;
    expect(existingOriginal([`${folder}preview-640.jpg`])).toBeUndefined();
    expect(
      existingOriginal([`${folder}preview-640.jpg`, `${folder}20240101000000-B.JPG`, `${folder}20210101000000-A.JPG`]),
    ).toBe(`${folder}20210101000000-A.JPG`);
  });
});

describe('mediaObjectName', () => {
  const prefix = 'Collections/u1/Uploads/2026.01.01.00.00.00_ana/';

  it('takes the tail past the hash folder for a Media key', () => {
    expect(mediaObjectName(`Media/${SHA}/20210531082538-RCNX0031.JPG`, prefix)).toBe('20210531082538-RCNX0031.JPG');
  });

  it('takes the tail past the upload folder for an old-layout key, with or without the slash', () => {
    expect(mediaObjectName(`${prefix}DCIM/IMG_1.JPG`, prefix)).toBe('DCIM/IMG_1.JPG');
    expect(mediaObjectName(`${prefix}DCIM/IMG_1.JPG`, prefix.slice(0, -1))).toBe('DCIM/IMG_1.JPG');
  });
});
