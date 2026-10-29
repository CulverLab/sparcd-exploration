import { describe, it, expect } from 'vitest';
import { formatUploadComments } from '../src/lib/uploadComments';

const input = {
  required: { mountainRange: ' Santa Rita Mountains ', dateCollected: '2026-03-28' },
  siteName: 'San Pedro 15', siteId: 'SAN15', imageCount: 39, uploadDate: new Date(2026, 9, 14), comments: '',
};
const prefix = 'Santa Rita Mountains - San Pedro 15 - SAN15 - 39 images - uploaded 2026-10-14 - collected 2026-03-28';

describe('required upload comments', () => {
  it('generates the six required fields without empty optional-comment separators', () => {
    expect(formatUploadComments(input)).toBe(prefix);
    expect(formatUploadComments({ ...input, comments: '  ' })).toBe(prefix);
  });
  it('keeps site name and Site ID as separate fields even when they match', () => {
    expect(formatUploadComments({ ...input, siteName: 'SAN15' })).toBe(prefix.replace('San Pedro 15', 'SAN15'));
  });
  it('uses the newly selected Site ID', () => {
    expect(formatUploadComments({ ...input, siteName: 'Whetstone 19', siteId: 'WHE19' })).toBe(prefix.replace('San Pedro 15 - SAN15', 'Whetstone 19 - WHE19'));
  });
  it('uses singular image wording for a one-image batch', () => {
    expect(formatUploadComments({ ...input, imageCount: 1 })).toBe(
      'Santa Rita Mountains - San Pedro 15 - SAN15 - 1 image - uploaded 2026-10-14 - collected 2026-03-28',
    );
  });
  it('retains the preview date when the upload starts on a later day', () => {
    expect(formatUploadComments({
      ...input,
      required: { ...input.required, previewUploadDate: '2026-10-13' },
    })).toBe(prefix.replace('uploaded 2026-10-14', 'uploaded 2026-10-13'));
  });
  it('appends optional comments without overwriting their content', () => {
    expect(formatUploadComments({ ...input, comments: 'Notes\nsecond line' })).toBe(`${prefix} - Notes\nsecond line`);
  });
  it('preserves descriptions from existing sessions without structured inputs', () => {
    expect(formatUploadComments({ ...input, required: undefined, comments: 'Original description' })).toBe('Original description');
  });
});
