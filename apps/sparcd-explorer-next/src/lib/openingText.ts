// Plain words for opening collections: why one couldn't open, those reasons
// gathered for the opening panel, and a note when the explorer adjusted for
// a computer clock that is off.

import { readErrorDetails } from '@sparcd/s3-safe';
import { plural } from './format';

export const SKEW_REASON =
  "The server refused the request because your computer's clock is off. Check your date and time settings, then retry.";

/** Why a collection couldn't open, in plain words. */
export function openFailure(err: unknown): string {
  if (readErrorDetails(err).code === 'RequestTimeTooSkewed') return SKEW_REASON;
  return err instanceof Error ? err.message : String(err);
}

/** The note under Data checks once the explorer has adjusted for a clock that is off; null while it hasn't. */
export function clockNote(offsetMs: number): string | null {
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  if (minutes === 0) return null;
  const off = minutes < 90 ? plural(minutes, 'minute') : plural(Math.round(minutes / 60), 'hour');
  return `Your computer's clock is about ${off} off. The explorer adjusted for it.`;
}

/**
 * One line per reason, naming the collections that failed for it, in the
 * order they failed: fifty collections refused for the same clock read as
 * one line. Names are left out when only one collection was opening.
 */
export function failureLines(failures: { name: string; reason: string }[], named: boolean): { names: string | null; reason: string }[] {
  const byReason = new Map<string, string[]>();
  for (const f of failures) byReason.set(f.reason, [...(byReason.get(f.reason) ?? []), f.name]);
  return [...byReason].map(([reason, names]) => ({ names: named ? andList(names) : null, reason }));
}

const andList = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
