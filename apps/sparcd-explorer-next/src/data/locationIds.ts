// Location ID rules. `0000` is what uploads saved without a location carry.

export function isNoLocation(locationId: string): boolean {
  const id = locationId.trim();
  return id === '' || id === '0000';
}

/** Two IDs that only differ in case or punctuation (SR-07, sr07) normalize alike. */
export function normalizeLocationId(locationId: string): string {
  return locationId.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Today's rule, kept from the old explorer: the first three characters of the location ID. */
export function mountainRange(locationId: string): string {
  return isNoLocation(locationId) ? '' : locationId.trim().slice(0, 3);
}
