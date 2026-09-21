export type Entry = Record<string, unknown>;

export type ListKind = 'Species' | 'Locations';

export const NUMERIC_LOCATION_FIELDS = ['latProperty', 'lngProperty', 'elevationProperty'] as const;

const numberRules: Record<string, { label: string; example: string; min?: number; max?: number }> = {
  latProperty: { label: 'Latitude', example: '32.158', min: -90, max: 90 },
  lngProperty: { label: 'Longitude', example: '-109.4478', min: -180, max: 180 },
  elevationProperty: { label: 'Elevation', example: '1415' },
};

/**
 * Numbers arrive as raw text so typing is never fought with. `Number()` turns
 * both "31.2q" and a box holding only spaces into values that look saveable
 * (NaN and 0), so the text is checked before it is ever converted.
 */
// Number() also swallows 0x20, 0b10 and 1e3 and writes back something the
// administrator never typed, so the text has to look like a plain decimal
// before it is converted at all.
const decimal = /^-?\d+(\.\d+)?$/;

export function numberFieldError(field: string, raw: unknown): string | null {
  const rule = numberRules[field];
  const text = String(raw ?? '').trim();
  if (text === '') return `${rule.label} needs a number.`;
  if (!decimal.test(text)) return `${rule.label} must be a number, like ${rule.example}.`;
  const value = Number(text);
  if (rule.min !== undefined && (value < rule.min || value > rule.max!))
    return `${rule.label} must be between ${rule.min} and ${rule.max}.`;
  return null;
}

/** Turn the raw text of every valid number box back into a number for storage. */
export function normalizeNumbers(kind: ListKind, items: Entry[]): Entry[] {
  if (kind === 'Species') return items;
  return items.map((item) => {
    const next = { ...item };
    for (const field of NUMERIC_LOCATION_FIELDS) {
      const text = String(next[field] ?? '').trim();
      if (decimal.test(text)) next[field] = Number(text);
    }
    return next;
  });
}

const text = (entry: Entry | undefined, field: string) => String(entry?.[field] ?? '').trim();

const conflicts = (items: Entry[], index: number, field: string, value: string) =>
  items.some(
    (entry, other) =>
      other !== index &&
      entry.retired !== true &&
      text(entry, field).toLocaleLowerCase() === value.toLocaleLowerCase(),
  );

// Legacy data already holds repeated IDs and scientific names. Re-checking them
// on every save would lock the administrator out of records they never touched,
// so a conflict only blocks a record that is new or whose own ID just changed.
const newOrChanged = (before: Entry | undefined, field: string, value: string) =>
  before === undefined || text(before, field) !== value;

// A record coming back into use has to face the same check: while it was
// retired another record was free to take its ID.
const broughtBack = (before: Entry | undefined, item: Entry) =>
  before?.retired === true && item.retired !== true;

export function validationError(
  kind: ListKind,
  items: Entry[],
  index: number,
  initial: unknown[] = [],
): string | null {
  const item = items[index] ?? {};
  const before = initial[index] as Entry | undefined;
  if (kind === 'Species') {
    const scientificName = text(item, 'scientificName');
    if (!text(item, 'name') || !scientificName) return 'Common name and scientific name are required.';
    if ((newOrChanged(before, 'scientificName', scientificName) || broughtBack(before, item)) && conflicts(items, index, 'scientificName', scientificName))
      return 'Scientific name is already used by another species.';
    return null;
  }
  if (!text(item, 'nameProperty') || !text(item, 'idProperty'))
    return 'Name and location ID are required.';
  for (const field of NUMERIC_LOCATION_FIELDS) {
    const error = numberFieldError(field, item[field]);
    if (error) return error;
  }
  const locationId = text(item, 'idProperty');
  if ((newOrChanged(before, 'idProperty', locationId) || broughtBack(before, item)) && conflicts(items, index, 'idProperty', locationId))
    return 'Location ID is already used by another location.';
  return null;
}

/**
 * Validate records that this editor would write. Existing legacy records are
 * deliberately skipped unless the administrator has changed them.
 */
export function changedRecordsValidationError(
  kind: ListKind,
  items: Entry[],
  initial: unknown[],
): string | null {
  for (let index = 0; index < items.length; index += 1) {
    if (JSON.stringify(items[index]) === JSON.stringify(initial[index])) continue
    const error = validationError(kind, items, index, initial)
    if (error) {
      const item = items[index]
      const name = kind === 'Species'
        ? (String(item.name ?? '').trim() || String(item.scientificName ?? '').trim())
        : (String(item.nameProperty ?? '').trim() || String(item.idProperty ?? '').trim())
      const fallback = `${kind === 'Species' ? 'Species' : 'Location'} ${index + 1}`
      return `${kind === 'Species' ? 'Species' : 'Location'} “${name || fallback}”: ${error}`
    }
  }
  return null
}
