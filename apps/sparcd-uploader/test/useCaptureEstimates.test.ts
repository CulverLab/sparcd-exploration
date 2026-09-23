import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../src/store';
import type { NaiveDateTime } from '../src/lib/exifTime';
import { methodLine } from '../src/lib/useCaptureEstimates';

const naive = (hour: number): NaiveDateTime => ({ year: 2026, month: 7, day: 1, hour, minute: 0, second: 0 });

const spreadFile = (
  manualHour: number,
  spread: { method: 'sequence'; startHour: number } | { method: 'file-modified'; timeZone: string } | undefined,
): FileEntry =>
  ({
    id: 'x', relPath: 'x.jpg', fileName: 'x.jpg', size: 1, mediaKind: 'image', processState: 'ready',
    file: new File(['x'], 'x.jpg'),
    manualNaive: naive(manualHour),
    manualSource: 'spread',
    manualSpreadStart: spread?.method === 'sequence' ? naive(spread.startHour) : undefined,
    manualSpreadMethod: spread?.method,
    manualSpreadTimeZone: spread?.method === 'file-modified' ? spread.timeZone : undefined,
  }) as FileEntry;

describe('methodLine — "spread from" reflects the file\'s own spread, not the batch', () => {
  it('reports the start stamped on the file, not a value derived from other files (#256)', () => {
    // Two folders spread independently: folder A from 08:00, folder B from
    // 14:00. Each file must report its own folder's start, not the
    // batch-wide earliest one.
    const folderA = spreadFile(8, { method: 'sequence', startHour: 8 });
    const folderB = spreadFile(14, { method: 'sequence', startHour: 14 });
    expect(methodLine(folderA, undefined, 'UTC')).toBe(
      'spread from 2026-07-01 08:00:00',
    );
    expect(methodLine(folderB, undefined, 'UTC')).toBe(
      'spread from 2026-07-01 14:00:00',
    );
  });

  it('identifies a file-modified spread rather than calling it a hand entry', () => {
    const fileModified = spreadFile(9, { method: 'file-modified', timeZone: 'America/Phoenix' });
    expect(methodLine(fileModified, undefined, 'UTC')).toBe('spread from file modified times (America/Phoenix)');
  });

  it('keeps the file-modified timezone used when the spread was applied', () => {
    const fileModified = spreadFile(9, { method: 'file-modified', timeZone: 'America/Phoenix' });
    expect(methodLine(fileModified, undefined, 'Europe/London')).toBe(
      'spread from file modified times (America/Phoenix)',
    );
  });

  it('does not substitute the current timezone for a legacy file-modified spread', () => {
    const legacyFileModified = {
      ...spreadFile(9, undefined),
      manualSpreadMethod: 'file-modified',
      manualSpreadTimeZone: undefined,
    } as FileEntry;
    expect(methodLine(legacyFileModified, undefined, 'Europe/London')).toBe(
      'spread from file modified times (timezone unavailable)',
    );
  });

  it('does not invent file-modified provenance for a legacy spread', () => {
    const legacy = spreadFile(9, undefined);
    expect(methodLine(legacy, undefined, 'UTC')).toBe('spread (provenance unavailable)');
  });

  it('reports "set by hand" for a plain manual override (not a spread)', () => {
    const manual: FileEntry = {
      id: 'y', relPath: 'y.jpg', fileName: 'y.jpg', size: 1, mediaKind: 'image', processState: 'ready',
      file: new File(['y'], 'y.jpg'),
      manualNaive: naive(10),
      manualSource: 'manual',
    } as FileEntry;
    expect(methodLine(manual, undefined, 'UTC')).toBe('set by hand');
  });
});
