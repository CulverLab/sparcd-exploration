import { describe, it, expect } from 'vitest';
import { formatHistoryBatchStart, summarizeUploadFiles, formatTransferBreakdown, formatUploadDate, formatUploadHeader } from '../src/lib/uploadDisplay';
import { formatDateTime24, type UploadMetaJson } from '@sparcd/camtrap';

const meta: UploadMetaJson = {
  uploadUser: 'Jane Doe',
  uploadDate: { date: { year: 2026, month: 3, day: 9 }, time: { hour: 7, minute: 5, second: 0, nano: 0 } },
  imagesWithSpecies: 12,
  imageCount: 40,
  editComments: [],
  bucket: 'sparcd-x',
  uploadPath: 'Collections/x/Uploads/stamp',
  description: '',
};

describe('uploadDisplay', () => {
  it('formats the stored local-time fields directly (zero-padded, no Date round-trip)', () => {
    expect(formatUploadDate(meta.uploadDate)).toBe('2026-03-09 at 07:05');
  });

  it('builds the uploader+date header', () => {
    expect(formatUploadHeader(meta)).toBe('Jane Doe on 2026-03-09 at 07:05');
  });

  it('does not throw on shape-drifted metadata (missing uploadDate / uploadUser)', () => {
    // A legacy/foreign UploadMeta.json is a plain JSON cast; tolerate gaps.
    expect(formatUploadDate(undefined)).toBe('unknown date');
    const drifted = { ...meta, uploadUser: '', uploadDate: undefined } as unknown as UploadMetaJson;
    expect(formatUploadHeader(drifted)).toBe('(unknown uploader) on unknown date');
  });

  it('formats late upload instants with a 24-hour clock', () => {
    expect(formatDateTime24('2026-09-11T22:15:10.000Z', 'UTC')).toBe('2026-09-11 22:15:10');
    expect(formatDateTime24('2026-09-11T00:05:10.000Z', 'UTC')).toBe('2026-09-11 00:05:10');
  });

  it('formats the timestamp used by History through its display helper', () => {
    expect(formatHistoryBatchStart('2026-09-11T22:15:10.000Z', 'UTC')).toBe('2026-09-11 22:15:10');
    expect(formatHistoryBatchStart('2026-09-11T00:05:10.000Z', 'UTC')).toBe('2026-09-11 00:05:10');
  });
});

describe('verified upload completion', () => {
  it('counts stored verified files as complete without calling them newly uploaded', () => {
    const result = summarizeUploadFiles([
      { state: 'done' }, { state: 'skipped' }, { state: 'skipped' },
      { state: 'failed' }, { state: 'pending' }, { state: 'uploading' },
    ]);
    expect(result).toEqual({ uploaded: 1, verified: 2, complete: 3, failed: 1 });
    expect(formatTransferBreakdown(result.uploaded, result.verified)).toBe('1 uploaded this attempt; 2 already stored and verified.');
  });
});
