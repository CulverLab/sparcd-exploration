// What each filter button says: its name when inactive, its value when active
// ("Species: Bobcat +1"), so the bar stays one line with no chip row.

import { activeFilters, elevationIn, type ElevationUnit, type FilterDimension, type FilterState, type Model } from '@/data';
import { fmtN, monthName } from './format';

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

function value(model: Model, f: FilterState, dim: FilterDimension, unit: ElevationUnit): string {
  switch (dim) {
    case 'collections':
      return first(model.collections.filter((c) => f.collections.includes(c.key)).map((c) => c.name));
    case 'species': {
      const byKey = new Map(model.species.map((s) => [s.key, s.name]));
      return first(f.species.map((k) => byKey.get(k) ?? k));
    }
    case 'locations':
      return first(f.locations.map((k) => locationLabel(model, k)));
    case 'area': {
      const { hexes, boxes } = f.area;
      return [hexes.length && `${hexes.length} hex${hexes.length === 1 ? '' : 'es'}`, boxes.length && `${boxes.length} box${boxes.length === 1 ? '' : 'es'}`]
        .filter(Boolean)
        .join(' + ');
    }
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
export function filterButtons(model: Model, f: FilterState, unit: ElevationUnit): FilterButton[] {
  const active = new Set(activeFilters(f));
  const dims: FilterDimension[] = ['collections', 'species', 'locations', 'area', 'dates', 'elevation', 'ranges'];
  return dims
    .filter((dim) => (dim === 'collections' ? model.collections.length > 1 : dim === 'area' ? active.has('area') : true))
    .map((dim) => {
      const on = active.has(dim);
      const name = dim === 'species' && f.speciesMode === 'hide' ? 'Hiding' : NAMES[dim];
      return { dim, name: NAMES[dim], label: on ? `${name}: ${value(model, f, dim, unit)}` : NAMES[dim], active: on };
    });
}

/** "7,235 photos" or "2,104 of 7,235 photos". */
export function photoCountLabel(inView: number, total: number, filtered: boolean): string {
  const noun = total === 1 ? 'photo' : 'photos';
  return filtered ? `${fmtN(inView)} of ${fmtN(total)} ${noun}` : `${fmtN(total)} ${noun}`;
}
