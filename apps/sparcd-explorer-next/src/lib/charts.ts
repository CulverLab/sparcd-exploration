// The Charts view as data. Each chart counts detections (one per species tag)
// under every filter but its own, so any bar can be picked, and a click on a
// bar toggles that filter. Hours and months are camera-local, read from the
// timestamp text.

import { NO_FILTERS, applyFilters, type FilterState, type Model } from '@/data';
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

/** The three charts' numbers, each under every filter but its own. */
export function chartData(model: Model, f: FilterState, axis: MonthAxis | null) {
  const without = (change: Partial<FilterState>) => applyFilters(model, { ...f, ...change }).detections;
  return {
    species: speciesCounts(model, without({ species: NO_FILTERS.species })),
    hours: hourCounts(model, without({ hours: null })),
    months: axis ? monthCounts(model, without({ dateFrom: null, dateTo: null, years: [], months: [] }), axis) : [],
  };
}

/** How a bar shows the active filter: picked (`on`), left out (`dim`), or plain when its filter is off. */
export type BarState = 'on' | 'dim' | null;

export function speciesBar(f: FilterState, key: string): BarState {
  const { hidden, hideUntagged } = f.species;
  if (!hidden.length && !hideUntagged) return null;
  return hidden.includes(key) ? 'dim' : 'on';
}

export const inHours = ([h0, h1]: [number, number], h: number): boolean => (h0 <= h1 ? h >= h0 && h <= h1 : h >= h0 || h <= h1);

export function hourBar(f: FilterState, hour: number): BarState {
  if (!f.hours) return null;
  return inHours(f.hours, hour) ? 'on' : 'dim';
}

export function monthBar(f: FilterState, m: number, axis: MonthAxis): BarState {
  if (!f.dateFrom && !f.dateTo && !f.years.length && !f.months.length) return null;
  return monthPasses(f, m, datesToMonths(f.dateFrom, f.dateTo, axis)) ? 'on' : 'dim';
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
