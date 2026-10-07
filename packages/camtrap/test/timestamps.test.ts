import { it, expect } from 'vitest';
import {
  buildMediaComments,
  timestampSourceFromComments,
  serializeMedia,
  parseMedia,
  mergeMedia,
  parseCsvRows,
  captureTimestampInZone,
  rebaseCaptureTimestamp,
  shiftTimestamp,
  ZERO_OFFSET,
  formatDateTime24,
  type TimestampSource,
} from '../src/index';

it.each<TimestampSource>(['manual', 'spread', 'interpolated', 'offset', 'file-modified', 'exif-modify'])('round trips %s', (timestampSource) => {
  expect(timestampSourceFromComments(buildMediaComments({ timestampSource }))).toBe(timestampSource);
});
it('returns no source for absent or unknown markers', () => {
  expect(buildMediaComments({})).toBe('');
  expect(timestampSourceFromComments('')).toBeNull();
  expect(timestampSourceFromComments('[TIMESTAMP:unknown]')).toBeNull();
});
it('preserves media comments through merge, parse, append and re-serialization', () => {
  const comments = '[TIMESTAMP:interpolated] note, "keep this"';
  const csv = serializeMedia([{ mediaId: 'a', mediaPath: 'a', deploymentId: 'd', fileName: 'a', timestamp: 'old', mimeType: 'image/jpeg', comments }]);
  const merged = mergeMedia(csv, [{ mediaId: 'a', deploymentId: 'd', timestamp: 'new', mediaTimestamp: 'new', observations: [] }]);
  const rows = parseMedia(merged);
  const appended = serializeMedia([...rows, { ...rows[0], mediaId: 'b', mediaPath: 'b' }]);
  expect(parseCsvRows(appended)[0][10]).toBe(comments);
  expect(merged.replace('"new"', '"old"')).toBe(csv);
  expect(serializeMedia(rows)).toBe(merged);
});

it('changes an estimated timestamp marker to manual without losing other comments', () => {
  const comments = '[TIMESTAMP:interpolated] note [UPLOADER:kept]';
  const csv = serializeMedia([
    { mediaId: 'a', mediaPath: 'a', deploymentId: 'd', fileName: 'a', timestamp: 'old', mimeType: 'image/jpeg', comments },
  ]);
  const merged = mergeMedia(csv, [
    { mediaId: 'a', deploymentId: 'd', timestamp: 'new', mediaTimestamp: 'new', timestampSource: 'manual', observations: [] },
  ]);

  const row = parseMedia(merged)[0];
  expect(row.timestamp).toBe('new');
  expect(row.comments).toBe('[TIMESTAMP:manual] note [UPLOADER:kept]');
  expect(timestampSourceFromComments(row.comments ?? '')).toBe('manual');
});

it('writes and rebases offset-bearing capture timestamps', () => {
  const phoenix = captureTimestampInZone('2026-07-01T12:00:00', 'America/Phoenix');
  expect(phoenix).toBe('2026-07-01T12:00:00.000-07:00');
  expect(rebaseCaptureTimestamp(phoenix, 'America/Phoenix', 'America/New_York')).toBe(
    '2026-07-01T12:00:00.000-04:00',
  );
  expect(rebaseCaptureTimestamp('2026-01-15T19:00:00.000Z', 'America/Phoenix', 'America/New_York')).toBe(
    '2026-01-15T12:00:00.000-05:00',
  );
  expect(rebaseCaptureTimestamp('2026-01-15T12:00:00', 'America/Phoenix', 'America/New_York')).toBe(
    '2026-01-15T12:00:00.000-05:00',
  );
});

it('rebases six-digit fractional seconds across zones without dropping digits', () => {
  expect(rebaseCaptureTimestamp('2024-05-01T20:02:11.123456+00:00', 'UTC', 'America/New_York')).toBe(
    '2024-05-01T20:02:11.123456-04:00',
  );
  expect(rebaseCaptureTimestamp('2024-05-01T20:02:11.123456Z', 'America/Phoenix', 'America/New_York')).toBe(
    '2024-05-01T13:02:11.123456-04:00',
  );
  expect(shiftTimestamp('2024-05-01T20:02:11.123456+00:00', { ...ZERO_OFFSET, hours: 1 }, 'UTC')).toBe(
    '2024-05-01T21:02:11.123456+00:00',
  );
});

it('shifts a Z value as the local time of its instant when the zone is known', () => {
  expect(shiftTimestamp('2026-01-15T15:00:00.000Z', { ...ZERO_OFFSET, hours: 1 }, 'America/Phoenix')).toBe(
    '2026-01-15T09:00:00.000-07:00',
  );
  expect(shiftTimestamp('2026-01-15T15:00:00.000Z', { ...ZERO_OFFSET, hours: 1 })).toBe('2026-01-15T16:00:00.000+00:00');
});

it('keeps daylight-saving offsets tied to the local date', () => {
  expect(captureTimestampInZone('2026-01-15T12:00:00', 'America/New_York')).toContain('-05:00');
  expect(captureTimestampInZone('2026-07-15T12:00:00', 'America/New_York')).toContain('-04:00');
});

it('moves a spring-forward wall clock through the nonexistent hour', () => {
  expect(captureTimestampInZone('2026-03-08T02:30:00', 'America/New_York')).toBe(
    '2026-03-08T03:30:00.000-04:00',
  );
});

it('formats midnight and late-night instants with a 24-hour clock', () => {
  expect(formatDateTime24('2026-09-11T00:05:10.000Z', 'UTC')).toBe('2026-09-11 00:05:10');
  expect(formatDateTime24('2026-09-11T22:15:10.000Z', 'UTC')).toBe('2026-09-11 22:15:10');
});
