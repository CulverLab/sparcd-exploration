// What each filter button says: its name when inactive, its value when active
// ("Species: Bobcat, Coyote"), so the bar stays one line with no chip row.

import {
  activeFilters,
  elevationIn,
  listKeys,
  locationKeyOf,
  photoSites,
  type ElevationUnit,
  type FilterDimension,
  type FilterState,
  type ListDimension,
  type Model,
} from '@/data';
import { fmtN, monthName, plural } from './format';
import { areaLocations } from './mapData';

export type FilterButton = { dim: FilterDimension; name: string; label: string; active: boolean };

const NAMES: Record<FilterDimension, string> = {
  collections: 'Collections',
  species: 'Species',
  locations: 'Locations',
  area: 'Area',
  files: 'Files',
  dates: 'Dates',
  elevation: 'Elevation',
  ranges: 'Mountain range',
};

/** What "No … selected" calls each list's items. */
export const LIST_NOUNS: Record<ListDimension, string> = {
  collections: 'collections',
  species: 'species',
  locations: 'locations',
  ranges: 'mountain ranges',
};

type Item = { label: string; ticked: boolean };

/**
 * A list filter in words, or null when every item is ticked: the ticked items
 * when there are one or two ("Bobcat, Coyote"), else the unticked ones when
 * there are one or two ("all but Ghost"), else a count ("7 of 13"). `names`
 * says the words list what is ticked.
 */
function listValue(items: Item[]): { text: string; names: boolean } | null {
  const on = items.filter((i) => i.ticked).map((i) => i.label);
  const off = items.filter((i) => !i.ticked).map((i) => i.label);
  if (!off.length) return null;
  if (!on.length) return { text: 'none', names: false };
  if (on.length <= 2) return { text: on.join(', '), names: true };
  if (off.length <= 2) return { text: `all but ${off.join(', ')}`, names: false };
  return { text: `${on.length} of ${items.length}`, names: false };
}

/** Locations as the picker lists them: by location ID, or by site with IDs shown separately. */
function locationItems(model: Model, f: FilterState, separate: boolean): Item[] {
  const hidden = new Set(f.locations.hidden);
  const items = new Map<string, Item>();
  for (const s of photoSites(model)) {
    const key = locationKeyOf(s, separate);
    const item = items.get(key) ?? { label: s.noLocation ? 'No location set' : s.locationId, ticked: false };
    item.ticked ||= !hidden.has(s.key);
    items.set(key, item);
  }
  return [...items.values()];
}

function listItems(model: Model, f: FilterState, dim: ListDimension, separate: boolean): Item[] {
  if (dim === 'locations') return locationItems(model, f, separate);
  const hidden = new Set(f[dim].hidden);
  const label =
    dim === 'species'
      ? (key: string) => model.species.find((s) => s.key === key)!.name
      : dim === 'collections'
        ? (key: string) => model.collections.find((c) => c.key === key)!.name
        : (key: string) => key;
  return listKeys(model, dim).map((key) => ({ label: label(key), ticked: !hidden.has(key) }));
}

/**
 * A list filter's value. "Untagged photos" counts as a species only when it
 * is all that is unticked ("no untagged"), or all that is ticked.
 */
function listFilterValue(model: Model, f: FilterState, dim: ListDimension, separate: boolean): string | null {
  const value = listValue(listItems(model, f, dim, separate));
  if (dim !== 'species') return value?.text ?? null;
  const untagged = !f.species.hideUntagged;
  if (!value) return untagged ? null : 'no untagged';
  if (value.text === 'none' && untagged) return 'untagged only';
  return value.text;
}

/** The species filter in full for a report: what it says of untagged photos too. */
function speciesWords(model: Model, f: FilterState): string | null {
  const value = listValue(listItems(model, f, 'species', false));
  const untagged = !f.species.hideUntagged;
  if (!value) return untagged ? null : 'no untagged photos';
  if (value.text === 'none') return untagged ? 'untagged photos only' : 'none';
  if (value.names) return untagged ? `${value.text}, untagged photos` : value.text;
  return untagged ? value.text : `${value.text}, no untagged photos`;
}

/** The list filter, if any, with nothing at all ticked, so nothing can match. */
export function noneTicked(model: Model, f: FilterState, separate = false): ListDimension | null {
  const lists: ListDimension[] = ['collections', 'species', 'locations', 'ranges'];
  return lists.find((dim) => activeFilters(f).includes(dim) && listFilterValue(model, f, dim, separate) === 'none') ?? null;
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

function value(model: Model, f: FilterState, dim: FilterDimension, unit: ElevationUnit, separate: boolean): string | null {
  switch (dim) {
    case 'collections':
    case 'species':
    case 'locations':
    case 'ranges':
      return listFilterValue(model, f, dim, separate);
    case 'area':
      return plural(areaLocations(model, f.area, separate), 'location');
    case 'files':
      return 'not on the server';
    case 'dates': {
      const parts: string[] = [];
      const range = dateRange(f.dateFrom, f.dateTo);
      if (range) parts.push(range);
      const years = [...f.years].sort();
      if (years.length) parts.push(years.length <= 2 ? years.join(', ') : `${years.length} years`);
      if (f.months.length) parts.push(`${f.months.length} month${f.months.length === 1 ? '' : 's'}`);
      if (f.hours) parts.push(`hours ${pad(f.hours[0])}:00–${pad(f.hours[1])}:59`);
      return parts.length > 1 ? `${parts[0]} +${parts.length - 1}` : parts[0];
    }
    case 'elevation': {
      const [lo, hi] = f.elevation!;
      return `${fmtN(elevationIn(lo, unit))}–${fmtN(elevationIn(hi, unit))} ${unit}`;
    }
  }
}

/**
 * The bar's buttons in order. Collections shows only with several collections
 * open, and Area only while a map area is selected.
 */
export function filterButtons(model: Model, f: FilterState, unit: ElevationUnit, separate = false): FilterButton[] {
  const active = new Set(activeFilters(f));
  const dims: FilterDimension[] = ['collections', 'species', 'locations', 'area', 'files', 'dates', 'elevation', 'ranges'];
  return dims
    .filter((dim) => (dim === 'collections' ? model.collections.length > 1 : dim === 'area' || dim === 'files' ? active.has(dim) : true))
    .map((dim) => {
      const v = active.has(dim) ? value(model, f, dim, unit, separate) : null;
      return { dim, name: NAMES[dim], label: v ? `${NAMES[dim]}: ${v}` : NAMES[dim], active: active.has(dim) };
    });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Every filter in force, in full and in plain words, for a report:
 * "Species: Bobcat, Mountain lion · Dates: Sep 2023 – Sep 2025", or
 * "No filters: all photos". The Photos view's tag switch counts while that
 * view shows (`tagShown`).
 */
export function filterWords(model: Model, f: FilterState, unit: ElevationUnit, separate = false, tagShown = false): string {
  const parts: string[] = [];
  const list = (dim: ListDimension) => (model.collections.length > 1 || dim !== 'collections') && listFilterValue(model, f, dim, separate);
  const collections = list('collections');
  if (collections) parts.push(`Collections: ${collections}`);
  const species = speciesWords(model, f);
  if (species) parts.push(`Species: ${species}`);
  const locations = list('locations');
  if (locations) parts.push(`Locations: ${locations}`);
  if (f.area.length) parts.push(`Map area: ${plural(areaLocations(model, f.area, separate), 'location')}`);
  if (f.missing === 'only') parts.push('Only photos whose files are missing');
  const range = dateRange(f.dateFrom, f.dateTo);
  if (range) parts.push(`Dates: ${range}`);
  if (f.years.length) parts.push(`Years: ${[...f.years].sort().join(', ')}`);
  if (f.months.length) parts.push(`Months: ${[...f.months].sort((a, b) => a - b).map((m) => MONTHS[m - 1]).join(', ')}`);
  if (f.hours) parts.push(`Hours: ${pad(f.hours[0])}:00–${pad(f.hours[1])}:59`);
  if (f.elevation) parts.push(`Elevation: ${value(model, f, 'elevation', unit, separate)}`);
  const ranges = list('ranges');
  if (ranges) parts.push(`Mountain range: ${ranges}`);
  if (tagShown && f.photoTag !== 'all') parts.push(f.photoTag === 'tagged' ? 'Tagged photos only' : 'Untagged photos only');
  const words = parts.length ? parts.join(' · ') : 'No filters: all photos';
  return f.missing === 'show' ? `${words} · Including photos whose files are missing` : words;
}

/**
 * What the effort strip and the Activity column draw inside their bars: the
 * photos a species filter keeps, or the Photos view's tag switch while it
 * shows. "Bobcat, Coyote", "All but Ghost", "Tagged"; null when neither is on.
 */
export function matchLegend(model: Model, f: FilterState, tagShown: boolean): string | null {
  const parts: string[] = [];
  const species = listFilterValue(model, f, 'species', false);
  if (species) parts.push(species[0].toUpperCase() + species.slice(1));
  if (tagShown && f.photoTag !== 'all') parts.push(f.photoTag === 'tagged' ? 'Tagged' : 'Untagged');
  return parts.length ? parts.join(', ') : null;
}

/** "7,235 photos" or "2,104 of 7,235 photos". */
export function photoCountLabel(inView: number, total: number, filtered: boolean): string {
  const noun = total === 1 ? 'photo' : 'photos';
  return filtered ? `${fmtN(inView)} of ${fmtN(total)} ${noun}` : `${fmtN(total)} ${noun}`;
}
