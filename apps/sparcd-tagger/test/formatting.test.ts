import { describe, it, expect } from 'vitest';
import { formatDate, formatTime, formatDateTime } from '../src/lib/formatting';

const ISO = '2026-09-11T13:24:05.000Z';

describe('formatDate', () => {
  it('renders an ISO local date without timezone conversion', () => {
    expect(formatDate(ISO, 'iso-local', 'en-US')).toBe('2026-09-11');
  });

  it('uses the browser locale for long, short and numeric dates', () => {
    expect(formatDate(ISO, 'long', 'en-US')).toBe('September 11, 2026');
    expect(formatDate(ISO, 'short', 'en-US')).toBe('Sep 11, 2026');
    expect(formatDate(ISO, 'numeric', 'en-US')).toBe('9/11/2026');
  });

  it('uses locale-specific order and punctuation', () => {
    expect(formatDate(ISO, 'long', 'de-DE')).toBe('11. September 2026');
  });

  it('preserves a wall-clock time that falls in a daylight-saving gap', () => {
    const dstGap = '2026-03-08T02:30:00.000Z';
    expect(formatDateTime(dstGap, 'iso-local', '24h', 'en-US')).toBe('2026-03-08 02:30');
  });
});

describe('formatTime', () => {
  it('renders 24-hour by default', () => {
    expect(formatTime(ISO, '24h', 'en-US')).toBe('13:24');
  });

  it('renders 12-hour with AM/PM', () => {
    expect(formatTime(ISO, '12h', 'en-US')).toBe('1:24 PM');
  });

  it('renders midnight and noon correctly in 12-hour', () => {
    expect(formatTime('2026-09-11T00:05:00.000Z', '12h', 'en-US')).toBe('12:05 AM');
    expect(formatTime('2026-09-11T12:05:00.000Z', '12h', 'en-US')).toBe('12:05 PM');
  });

  it('includes seconds only for the selected seconds formats', () => {
    expect(formatTime(ISO, '24h-seconds', 'en-US')).toBe('13:24:05');
    expect(formatTime(ISO, '12h-seconds', 'en-US')).toBe('1:24:05 PM');
  });

  it('keeps late-night and midnight values in 24-hour form', () => {
    expect(formatTime('2026-09-11T22:15:10.000Z', '24h-seconds', 'en-US')).toBe('22:15:10');
    expect(formatTime('2026-09-11T00:05:10.000Z', '24h-seconds', 'en-US')).toBe('00:05:10');
  });
});

describe('formatDateTime', () => {
  it('joins date and time per the chosen formats', () => {
    expect(formatDateTime(ISO, 'numeric', '12h', 'en-US')).toBe('9/11/2026 1:24 PM');
  });
});
