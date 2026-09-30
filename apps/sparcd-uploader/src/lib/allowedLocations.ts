import type { Location } from './locations';

/**
 * Keep historical deployments as an ordering hint only. The current
 * collection-scoped list is authoritative: a historical ID absent from it is
 * never reintroduced into the picker.
 */
export function orderAllowedLocations(locations: Location[], deployedIds: string[]): Location[] {
  const deployed = new Set(deployedIds);
  const used = locations.filter((location) => deployed.has(location.id));
  const unused = locations.filter((location) => !deployed.has(location.id));
  return [...used, ...unused];
}

/** Resolve a persisted picker value only when its unique ID is still current. */
export function findAllowedLocation(locations: Location[], selectedId: string | null): Location | null {
  if (!selectedId) return null;
  return locations.find((location) => location.id === selectedId) ?? null;
}
