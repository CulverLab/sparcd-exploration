// What each filter button says: its name when inactive, its value when active
// ("Species: Bobcat +1"), so the bar stays one line with no chip row.

import { activeFilters, elevationIn, type ElevationUnit, type FilterDimension, type FilterState, type Model } from '@/data';
import { fmtN, monthName, plural } from './format';
import { areaLocations } from './mapData';

export type FilterButton = { dim: FilterDimension; name: string; label: string; active: boolean };

const NAMES: Record<FilterDimension, string> = {
  collections: 'Collections',
  species: 'Species',
  locations: 'Locations',
  area: 'Area',
  dates: 'Dates',
  elevation: 'Elevation',
  ranges: 'Mountain range',
};

const first = (values: string[]): string => (values.length > 1 ? `${values[0]} +${values.length - 1}` : values[0]);

/** A location filter key as people know it: the location ID, or "No location set". */
export function locationLabel(model: Model, key: string): string {
  if (key.startsWith('id:')) return key.slice(3);
  const site = model.sites.find((s) => s.key === key || s.groupKey === key);
  return !site || site.noLocation ? 'No location set' : site.locationId;
}

const lastDayOf = (date: string): number =>
  new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();

function dateRange(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  const months = (!from || from.endsWith('-01')) && (!to || Number(to.slice(8)) === lastDayOf(to));
  const show = (d: string) => (months ? monthName(d) : d);
  if (from && to) return show(from) === show(to) ? show(from) : `${show(from)} – ${show(to)}`;
  return from ? `from ${show(from)}` : `until ${show(to!)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function value(model: Model, f: FilterState, dim: FilterDimension, unit: ElevationUnit, separate: boolean): string {
  switch (dim) {
    case 'collections':
      return first(model.collections.filter((c) => f.collections.includes(c.key)).map((c) => c.name));
    case 'species': {
      const byKey = new Map(model.species.map((s) => [s.key, s.name]));
      return first(f.species.map((k) => byKey.get(k) ?? k));
    }
    case 'locations':
      return first(f.locations.map((k) => locationLabel(model, k)));
    case 'area':
      return plural(areaLocations(model, f.area, separate), 'location');
    case 'dates': {
      const parts: string[] = [];
      const range = dateRange(f.dateFrom, f.dateTo);
      if (range) parts.push(range);
      const years = [...f.years].sort();
      if (years.length) parts.push(years.length <= 2 ? years.join(', ') : `${years.length} years`);
      if (f.months.length) parts.push(`${f.months.length} month${f.months.length === 1 ? '' : 's'}`);
      if (f.hours) parts.push(`hours ${pad(f.hours[0])}:00–${pad(f.hours[1])}:59`);
      return first(parts);
    }
    case 'elevation': {
      const [lo, hi] = f.elevation!;
      return `${fmtN(elevationIn(lo, unit))}–${fmtN(elevationIn(hi, unit))} ${unit}`;
    }
    case 'ranges':
      return first([...f.ranges].sort());
  }
}

/**
 * The bar's buttons in order. Collections shows only with several collections
 * open, and Area only while a map area is selected.
 */
export function filterButtons(model: Model, f: FilterState, unit: ElevationUnit, separate = false): FilterButton[] {
  const active = new Set(activeFilters(f));
  const dims: FilterDimension[] = ['collections', 'species', 'locations', 'area', 'dates', 'elevation', 'ranges'];
  return dims
    .filter((dim) => (dim === 'collections' ? model.collections.length > 1 : dim === 'area' ? active.has('area') : true))
    .map((dim) => {
      const on = active.has(dim);
      const name = dim === 'species' && f.speciesMode === 'hide' ? 'Hiding' : NAMES[dim];
      return { dim, name: NAMES[dim], label: on ? `${name}: ${value(model, f, dim, unit, separate)}` : NAMES[dim], active: on };
    });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Every filter in force, in full and in plain words, for a report:
 * "Species: Bobcat, Mountain lion · Dates: Sep 2023 – Sep 2025", or
 * "No filters: all photos".
 */
export function filterWords(model: Model, f: FilterState, unit: ElevationUnit, separate = false): string {
  const parts: string[] = [];
  if (model.collections.length > 1 && f.collections.length) {
    parts.push(`Collections: ${model.collections.filter((c) => f.collections.includes(c.key)).map((c) => c.name).join(', ')}`);
  }
  if (f.species.length) {
    const byKey = new Map(model.species.map((s) => [s.key, s.name]));
    parts.push(`${f.speciesMode === 'hide' ? 'Hiding species' : 'Species'}: ${f.species.map((k) => byKey.get(k) ?? k).join(', ')}`);
  }
  if (f.locations.length) parts.push(`Locations: ${f.locations.map((k) => locationLabel(model, k)).join(', ')}`);
  if (f.area.length) parts.push(`Map area: ${plural(areaLocations(model, f.area, separate), 'location')}`);
  const range = dateRange(f.dateFrom, f.dateTo);
  if (range) parts.push(`Dates: ${range}`);
  if (f.years.length) parts.push(`Years: ${[...f.years].sort().join(', ')}`);
  if (f.months.length) parts.push(`Months: ${[...f.months].sort((a, b) => a - b).map((m) => MONTHS[m - 1]).join(', ')}`);
  if (f.hours) parts.push(`Hours: ${pad(f.hours[0])}:00–${pad(f.hours[1])}:59`);
  if (f.elevation) parts.push(`Elevation: ${value(model, f, 'elevation', unit, separate)}`);
  if (f.ranges.length) parts.push(`Mountain range: ${[...f.ranges].sort().join(', ')}`);
  return parts.length ? parts.join(' · ') : 'No filters: all photos';
}

/**
 * What the effort strip and the Activity column draw inside their bars: the
 * photos a species filter keeps, or the Photos view's tag switch while it
 * shows. "Bobcat +1", "Without Bobcat", "Tagged"; null when neither is on.
 */
export function matchLegend(model: Model, f: FilterState, tagShown: boolean): string | null {
  const parts: string[] = [];
  if (f.species.length) {
    const names = value(model, f, 'species', 'm', false);
    parts.push(f.speciesMode === 'hide' ? `Without ${names}` : names);
  }
  if (tagShown && f.photoTag !== 'all') parts.push(f.photoTag === 'tagged' ? 'Tagged' : 'Untagged');
  return parts.length ? parts.join(', ') : null;
}

/** "7,235 photos" or "2,104 of 7,235 photos". */
export function photoCountLabel(inView: number, total: number, filtered: boolean): string {
  const noun = total === 1 ? 'photo' : 'photos';
  return filtered ? `${fmtN(inView)} of ${fmtN(total)} ${noun}` : `${fmtN(total)} ${noun}`;
}
