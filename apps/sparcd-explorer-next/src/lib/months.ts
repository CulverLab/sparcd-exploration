// One month axis for the effort strip, the Activity column and its header:
// months count as `year * 12 + month - 1`, from the first month of the opened
// data to the last, so every strip lines up with every other.

import type { FilterState, Model } from '@/data';

export type MonthAxis = { first: number; count: number };
/** Per month: [photos, untagged photos, matching photos]. */
export type MonthCounts = Map<number, [number, number, number]>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export const monthIndex = (date: string): number => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
export const yearOf = (m: number): number => Math.floor(m / 12);
/** `2024-04` */
export const monthKey = (m: number): string => `${yearOf(m)}-${pad((m % 12) + 1)}`;
/** `Apr 2024` */
export const monthLabel = (m: number): string => `${MONTHS[m % 12]} ${yearOf(m)}`;

/** The span of the opened data, or null when no photo has a readable date. */
export function monthAxis(model: Model): MonthAxis | null {
  if (!model.dateSpan) return null;
  const first = monthIndex(model.dateSpan.first);
  return { first, count: monthIndex(model.dateSpan.last) - first + 1 };
}

const monthOf = (model: Model, i: number): number | null => {
  const p = model.photos[i];
  return p.year === null ? null : p.year * 12 + p.month! - 1;
};

/**
 * Camera effort per month: the `effort` photos, tagged and untagged, and how
 * many of them are in `match` (the photos a species filter or the tag switch
 * keeps, a subset of `effort`).
 */
export function countByMonth(model: Model, effort: number[], match: number[] = []): MonthCounts {
  const counts: MonthCounts = new Map();
  for (const i of effort) {
    const m = monthOf(model, i);
    if (m === null) continue;
    const c = counts.get(m) ?? [0, 0, 0];
    c[0]++;
    if (!model.photos[i].tagged) c[1]++;
    counts.set(m, c);
  }
  for (const i of match) {
    const m = monthOf(model, i);
    if (m !== null) counts.get(m)![2]++;
  }
  return counts;
}

/** The camera-local dates a run of months covers, from its first day to its last. */
export function monthsToDates(a: number, b: number): { dateFrom: string; dateTo: string } {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const last = new Date(Date.UTC(yearOf(hi), (hi % 12) + 1, 0)).getUTCDate();
  return { dateFrom: `${monthKey(lo)}-01`, dateTo: `${monthKey(hi)}-${pad(last)}` };
}

/** The months a date range touches, clamped to the axis; null when the range is unset or misses the axis. */
export function datesToMonths(from: string | null, to: string | null, axis: MonthAxis): [number, number] | null {
  if (!from && !to) return null;
  const end = axis.first + axis.count - 1;
  const lo = Math.max(axis.first, from ? monthIndex(from) : axis.first);
  const hi = Math.min(end, to ? monthIndex(to) : end);
  return lo <= hi ? [lo, hi] : null;
}

/** Whether a month survives the Dates filter's years, months and range (from `datesToMonths`). */
export function monthPasses(f: FilterState, m: number, range: [number, number] | null): boolean {
  if (f.years.length && !f.years.includes(yearOf(m))) return false;
  if (f.months.length && !f.months.includes((m % 12) + 1)) return false;
  return !range || (m >= range[0] && m <= range[1]);
}

/** A year label on an axis: its month, `x` px from the axis start, and its text starting there or ending at the axis end. */
export type AxisTick = { month: number; year: number; x: number; anchor: 'start' | 'end' };

/** The least room, in px, from one year label's start to the next. */
export const TICK_GAP = 36;

/**
 * Year labels that fit an axis `width` px wide, at least `gap` px apart: the
 * first month and every January if they fit, else every 2nd or 5th year,
 * else only the first year and the last ("2013 … 2026"). The first label
 * always stays; a January that would crowd it goes, and a label too near the
 * end ends at the end.
 */
export function axisTicks(axis: MonthAxis, width: number, gap = TICK_GAP): AxisTick[] {
  const last = axis.first + axis.count - 1;
  const tick = (month: number, x: number): AxisTick => ({ month, year: yearOf(month), x, anchor: x + gap > width ? 'end' : 'start' });
  const first = tick(axis.first, 0);
  const left = (t: AxisTick) => (t.anchor === 'end' ? width - gap : t.x);
  for (const step of [1, 2, 5]) {
    const ticks = [first];
    for (let y = yearOf(axis.first) + 1; y <= yearOf(last); y++) {
      const x = ((y * 12 - axis.first) / axis.count) * width;
      if (y % step === 0 && x >= gap) ticks.push(tick(y * 12, x));
    }
    if (ticks.every((t, i) => i === 0 || left(t) >= left(ticks[i - 1]) + gap)) return ticks;
  }
  return yearOf(last) === yearOf(axis.first) || width < 2 * gap ? [first] : [first, { month: last, year: yearOf(last), x: width, anchor: 'end' }];
}

/** How dark a month's bar is, from 0.25 for the quietest to 1 for the busiest. */
export const monthShade = (photos: number, max: number): number => 0.25 + 0.75 * Math.sqrt(photos / Math.max(1, max));

/** A month bar's fill: busier months darker, and every one lighter while inner bars sit on top. */
export const barFill = (photos: number, max: number, behind: boolean): string =>
  `color-mix(in srgb, var(--accent) ${Math.round(monthShade(photos, max) * (behind ? 40 : 100))}%, var(--accentSoft))`;
