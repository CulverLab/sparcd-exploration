// Capture times are the camera's own wall clock. Dates, years, months and
// hours come straight from the timestamp text, never through a UTC
// conversion, so a photo taken at 23:30 stays on its own day.

export type LocalTime = {
  date: string; // YYYY-MM-DD
  day: number; // days since 1970-01-01, for fast range checks
  year: number;
  month: number; // 1-12
  hour: number | null; // null when the text carries a date only
};

const LOCAL_TS = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;
const DAY_MS = 86_400_000;

export function dayNumber(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
}

/** The wall-clock fields of a timestamp, or null when it doesn't parse. */
export function parseLocalTimestamp(timestamp: string): LocalTime | null {
  const m = LOCAL_TS.exec(timestamp.trim());
  if (!m) return null;
  const [year, month, dayOfMonth] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== dayOfMonth) {
    return null;
  }
  const hour = m[4] === undefined ? null : Number(m[4]);
  if (hour !== null && (hour > 23 || Number(m[5]) > 59)) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return { date, day: dayNumber(date), year, month, hour };
}

/** A stored timestamp as `YYYY-MM-DD HH:MM:SS`, 24-hour, with no locale AM/PM. */
export function formatTimestamp24(timestamp: string | null | undefined): string {
  return (timestamp ?? '').replace('T', ' ').slice(0, 19);
}
