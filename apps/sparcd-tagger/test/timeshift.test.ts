import { describe, it, expect } from 'vitest';
import { shiftTimestamp, correctedTimestamp } from '@sparcd/camtrap';
import {
  ZERO_OFFSET_RECORD,
  offsetActive,
  formatOffsetDelta,
  normalizeTimestampInput,
  earliestCorrected,
} from '../src/lib/timeshift';

describe('offsetActive', () => {
  it('is false for null and the zero offset', () => {
    expect(offsetActive(null)).toBe(false);
    expect(offsetActive(undefined)).toBe(false);
    expect(offsetActive(ZERO_OFFSET_RECORD)).toBe(false);
  });

  it('is true when any field is non-zero, including a negative one', () => {
    expect(offsetActive({ ...ZERO_OFFSET_RECORD, hours: 1 })).toBe(true);
    expect(offsetActive({ ...ZERO_OFFSET_RECORD, minutes: -30 })).toBe(true);
    expect(offsetActive({ ...ZERO_OFFSET_RECORD, seconds: 1 })).toBe(true);
  });
});

describe('formatOffsetDelta', () => {
  it('renders a single signed unit', () => {
    expect(formatOffsetDelta({ ...ZERO_OFFSET_RECORD, hours: 1 })).toBe('+1h');
    expect(formatOffsetDelta({ ...ZERO_OFFSET_RECORD, hours: -2 })).toBe('-2h');
  });

  it('joins multiple units in y→s order, keeping signs per field', () => {
    expect(
      formatOffsetDelta({ years: 0, months: 0, days: -1, hours: 7, minutes: -30, seconds: 0 }),
    ).toBe('-1d +7h -30m');
  });

  it('says "no shift" for null/zero', () => {
    expect(formatOffsetDelta(null)).toBe('no shift');
    expect(formatOffsetDelta(ZERO_OFFSET_RECORD)).toBe('no shift');
  });
});

describe('normalizeTimestampInput', () => {
  it('accepts a space or T separator and fills missing seconds', () => {
    expect(normalizeTimestampInput('2024-01-11 06:42')).toBe('2024-01-11T06:42:00.000Z');
    expect(normalizeTimestampInput('2024-01-11T06:42:18')).toBe('2024-01-11T06:42:18.000Z');
    expect(normalizeTimestampInput('  2024-01-11 06:42:18  ')).toBe('2024-01-11T06:42:18.000Z');
  });

  it('round-trips a full ISO value unchanged (the shape `corrected` seeds the box with)', () => {
    expect(normalizeTimestampInput('2024-01-11T06:42:18.000Z')).toBe('2024-01-11T06:42:18.000Z');
  });

  it('rejects malformed or out-of-range input', () => {
    expect(normalizeTimestampInput('not a date')).toBeNull();
    expect(normalizeTimestampInput('2024-13-01 06:00:00')).toBeNull(); // month 13
    expect(normalizeTimestampInput('2024-01-11 25:00:00')).toBeNull(); // hour 25
    expect(normalizeTimestampInput('2024-01-11')).toBeNull(); // no time
  });

  it('rejects impossible calendar days but accepts a real leap day', () => {
    expect(normalizeTimestampInput('2024-02-30 00:00:00')).toBeNull(); // Feb 30 never exists
    expect(normalizeTimestampInput('2024-04-31 00:00:00')).toBeNull(); // April has 30 days
    expect(normalizeTimestampInput('2023-02-29 00:00:00')).toBeNull(); // 2023 is not a leap year
    expect(normalizeTimestampInput('2024-02-29 06:42:18')).toBe('2024-02-29T06:42:18.000Z'); // leap year
  });
});

describe('earliestCorrected', () => {
  it('returns the smallest non-empty corrected time among the targets', () => {
    const targets = [
      { currentCorrected: '2024-01-01T09:00:00.000Z' },
      { currentCorrected: '2024-01-01T08:00:00.000Z' },
      { currentCorrected: '2024-01-01T08:30:00.000Z' },
    ];
    expect(earliestCorrected(targets)).toBe('2024-01-01T08:00:00.000Z');
  });

  it('returns "" for an empty target set', () => {
    expect(earliestCorrected([])).toBe('');
  });
});

describe('bulk offset preview matches the persisted override', () => {
  it('anchor (corrected) + delta equals what apply freezes, with offset + override present', () => {
    const base = '2024-01-01T08:00:00.000Z';
    const uploadOffset = { ...ZERO_OFFSET_RECORD, hours: 1 };
    const existingOverride = '2024-01-01T10:00:00.000Z'; // a prior per-image absolute
    const delta = { ...ZERO_OFFSET_RECORD, minutes: 15 };

    // The corrected time the UI shows now (override wins over offset) is exactly
    // the anchor fed to the preview AND the value apply shifts.
    const currentCorrected = correctedTimestamp(base, uploadOffset, existingOverride);
    expect(currentCorrected).toBe('2024-01-01T10:00:00.000Z');
    const anchor = earliestCorrected([{ currentCorrected }]);

    const previewAfter = shiftTimestamp(anchor, delta); // what the modal shows
    const persistedOverride = shiftTimestamp(currentCorrected, delta); // what apply writes
    expect(previewAfter).toBe(persistedOverride);
    expect(persistedOverride).toBe('2024-01-01T10:15:00.000Z');
    // Resolution still routes through the same two canonical inputs (override wins).
    expect(correctedTimestamp(base, uploadOffset, persistedOverride)).toBe('2024-01-01T10:15:00.000Z');
  });
});
