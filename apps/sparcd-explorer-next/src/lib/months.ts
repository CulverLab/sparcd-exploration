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

/** Where the year labels go: the axis's first month and every January after it. */
export function yearTicks(axis: MonthAxis): { month: number; year: number; at: number }[] {
  const ticks: { month: number; year: number; at: number }[] = [];
  for (let m = axis.first; m < axis.first + axis.count; m++) {
    if (m === axis.first || m % 12 === 0) ticks.push({ month: m, year: yearOf(m), at: (m - axis.first) / axis.count });
  }
  return ticks;
}

/** How dark a month's bar is, from 0.25 for the quietest to 1 for the busiest. */
export const monthShade = (photos: number, max: number): number => 0.25 + 0.75 * Math.sqrt(photos / Math.max(1, max));

/** A month bar's fill: busier months darker, and every one lighter while inner bars sit on top. */
export const barFill = (photos: number, max: number, behind: boolean): string =>
  `color-mix(in srgb, var(--accent) ${Math.round(monthShade(photos, max) * (behind ? 40 : 100))}%, var(--accentSoft))`;
