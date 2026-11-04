// The Charts view as data. Each chart counts the detections in view (one per
// species tag), so a species filtered out goes and the scale follows. A click
// on a bar toggles that filter. Hours and months are camera-local, read from
// the timestamp text, and keep their axis: a bar outside the filter drops to
// zero and can still be picked.

import type { FilterState, Model } from '@/data';
import { datesToMonths, monthPasses, monthsToDates, type MonthAxis } from './months';

/** Round tick values (steps of 1, 2 or 5 × 10ⁿ, never below 1) from 0 to at least `max`. */
export function niceTicks(max: number, n = 5): number[] {
  const raw = Math.max(1, max) / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
  const ticks = [0];
  while (ticks.length < 2 || ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** A linear scale from 0…`top` onto 0…`length` pixels, so bars are drawn to scale. */
export const linear =
  (top: number, length: number) =>
  (v: number): number =>
    (v / top) * length;

export type SpeciesCount = { species: number; detections: number };

export function speciesCounts(model: Model, detections: number[]): SpeciesCount[] {
  const counts = new Map<number, number>();
  for (const d of detections) {
    const s = model.detections[d].species;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts]
    .map(([species, n]) => ({ species, detections: n }))
    .sort((a, b) => b.detections - a.detections || model.species[a.species].name.localeCompare(model.species[b.species].name));
}

/** Detections per camera-local hour, 0-23. Photos whose time has no hour are left out. */
export function hourCounts(model: Model, detections: number[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const d of detections) {
    const hour = model.photos[model.detections[d].photo].hour;
    if (hour !== null) hours[hour]++;
  }
  return hours;
}

/** Detections per camera-local month along the shared axis. */
export function monthCounts(model: Model, detections: number[], axis: MonthAxis): number[] {
  const months = new Array<number>(axis.count).fill(0);
  for (const d of detections) {
    const p = model.photos[model.detections[d].photo];
    if (p.year !== null) months[p.year * 12 + p.month! - 1 - axis.first]++;
  }
  return months;
}

/** The three charts' numbers, from the detections in view. */
export function chartData(model: Model, detections: number[], axis: MonthAxis | null) {
  return {
    species: speciesCounts(model, detections),
    hours: hourCounts(model, detections),
    months: axis ? monthCounts(model, detections, axis) : [],
  };
}

/** How a bar shows the active filter: picked (`on`), or plain. */
export type BarState = 'on' | null;

export function speciesBar(f: FilterState, key: string): BarState {
  const { hidden, hideUntagged } = f.species;
  return (hidden.length || hideUntagged) && !hidden.includes(key) ? 'on' : null;
}

export const inHours = ([h0, h1]: [number, number], h: number): boolean => (h0 <= h1 ? h >= h0 && h <= h1 : h >= h0 || h <= h1);

export function hourBar(f: FilterState, hour: number): BarState {
  return f.hours && inHours(f.hours, hour) ? 'on' : null;
}

export function monthBar(f: FilterState, m: number, axis: MonthAxis): BarState {
  if (!f.dateFrom && !f.dateTo && !f.years.length && !f.months.length) return null;
  return monthPasses(f, m, datesToMonths(f.dateFrom, f.dateTo, axis)) ? 'on' : null;
}

/** An hour bar: that hour alone, or no hours when it already was. */
export function toggleHour(f: FilterState, hour: number): FilterState {
  const alone = f.hours?.[0] === hour && f.hours[1] === hour;
  return { ...f, hours: alone ? null : [hour, hour] };
}

/** A month bar: that month as Dates, or no dates when it already was. Hours stay. */
export function toggleMonth(f: FilterState, m: number): FilterState {
  const dates = monthsToDates(m, m);
  const alone = f.dateFrom === dates.dateFrom && f.dateTo === dates.dateTo && !f.years.length && !f.months.length;
  return alone ? { ...f, dateFrom: null, dateTo: null } : { ...f, ...dates, years: [], months: [] };
}
