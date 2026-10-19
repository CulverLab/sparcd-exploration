import { describe, expect, it } from 'vitest';
import { dayNumber, formatTimestamp24, parseLocalTimestamp } from '../src/data';

describe('parseLocalTimestamp', () => {
  it('reads the camera wall clock with no UTC conversion', () => {
    // 23:30 at -07:00 is the next day in UTC; the photo still belongs to the 10th.
    expect(parseLocalTimestamp('2024-03-10T23:30:00.000-07:00')).toMatchObject({
      date: '2024-03-10',
      year: 2024,
      month: 3,
      hour: 23,
    });
    // A legacy Z timestamp is read for its written fields too.
    expect(parseLocalTimestamp('2024-03-10T01:15:00Z')).toMatchObject({ date: '2024-03-10', hour: 1 });
  });

  it('accepts naive and space-separated timestamps and date-only values', () => {
    expect(parseLocalTimestamp('2018-06-15T10:00:00')?.hour).toBe(10);
    expect(parseLocalTimestamp('2018-06-15 21:05')?.hour).toBe(21);
    expect(parseLocalTimestamp('2018-06-15')).toMatchObject({ date: '2018-06-15', hour: null });
  });

  it('returns null for timestamps that do not parse', () => {
    for (const bad of ['', 'unknown', '0000-00-00T00:00:00', '2023-02-30T10:00:00', '2024-13-01T00:00:00', '2024-01-01T25:00:00']) {
      expect(parseLocalTimestamp(bad), bad).toBeNull();
    }
  });

  it('numbers days so ranges compare as integers', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(parseLocalTimestamp('2024-01-01T00:00:00')!.day).toBe(dayNumber('2024-01-01'));
  });
});

describe('formatTimestamp24', () => {
  it('shows late hours in 24-hour form without AM/PM', () => {
    expect(formatTimestamp24('2026-09-11T22:15:10.000Z')).toBe('2026-09-11 22:15:10');
  });

  it('shows a missing timestamp as empty', () => {
    expect(formatTimestamp24(null)).toBe('');
    expect(formatTimestamp24(undefined)).toBe('');
  });
});
