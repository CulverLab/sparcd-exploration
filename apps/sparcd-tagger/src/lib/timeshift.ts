// Pure helpers for the time-correction UI. The actual date math lives in
// `@sparcd/camtrap` (`shiftTimestamp` / `correctedTimestamp`), which mirrors the
// original desktop tooling's `LocalDateTime`-style clamping — see that
// package's `contracts.test.ts`. These are just the display/format glue the UI
// needs, kept pure so they can be unit-tested without React or Dexie.

import type { TimeOffsetRecord } from './db';

/** The earliest already-corrected timestamp among the bulk targets — the anchor a
 *  selection-scoped shift previews against. It MUST be the corrected time (not the
 *  raw base), because the shift is applied relative to the time each frame shows
 *  now, so the preview's before→after matches what apply actually persists. ISO
 *  timestamps sort chronologically, so a lexicographic min is the earliest.
 *  Returns '' for an empty target set. */
export function earliestCorrected(targets: { currentCorrected: string }[]): string {
  let earliest = '';
  for (const t of targets) {
    if (t.currentCorrected && (earliest === '' || t.currentCorrected < earliest)) {
      earliest = t.currentCorrected;
    }
  }
  return earliest;
}

export const ZERO_OFFSET_RECORD: TimeOffsetRecord = {
  years: 0,
  months: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
};

/** True when any field of the offset is non-zero (drives the active indicator). */
export function offsetActive(o: TimeOffsetRecord | null | undefined): boolean {
  return !!o && (o.years || o.months || o.days || o.hours || o.minutes || o.seconds) !== 0;
}

/** Compact signed delta, e.g. `+1h`, `-1d 7h 30m`, or `no shift` when zero.
 *  Matches the design's `fmtDelta` (TimeShiftModal / ClockChip label). */
export function formatOffsetDelta(o: TimeOffsetRecord | null | undefined): string {
  if (!o) return 'no shift';
  const parts: string[] = [];
  const push = (v: number, unit: string) => {
    if (v) parts.push(`${v > 0 ? '+' : ''}${v}${unit}`);
  };
  push(o.years, 'y');
  push(o.months, 'mo');
  push(o.days, 'd');
  push(o.hours, 'h');
  push(o.minutes, 'm');
  push(o.seconds, 's');
  return parts.length ? parts.join(' ') : 'no shift';
}

// Accepts a space or `T` separator, an optional seconds field, and an optional
// trailing `.sss` + `Z`/offset — the shape `PerImageTime` seeds its edit box
// with `corrected`, which is now a full ISO 8601 UTC string, so a user who
// commits without touching the text must still round-trip cleanly.
const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Normalize a user-typed corrected timestamp to a full ISO 8601 UTC string
 *  (the form `media.csv` / `observations.csv` col 4 now stores). Returns null on
 *  a shape or range violation so the caller can reject the edit instead of
 *  writing junk. A bare `YYYY-MM-DDTHH:mm:ss` with no offset is treated as
 *  already UTC (matching what `corrected` displays), not the browser's zone. */
export function normalizeTimestampInput(raw: string): string | null {
  const m = INPUT_RE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const min = Number(mi);
  const sec = s ? Number(s) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) {
    return null;
  }
  // Reject impossible calendar days (Feb 30, Apr 31, Feb 29 in a non-leap year):
  // a real day round-trips through Date unchanged, while an overflow rolls the
  // date into the following month.
  const probe = new Date(Date.UTC(Number(y), month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return new Date(Date.UTC(Number(y), month - 1, day, hour, min, sec)).toISOString();
}
