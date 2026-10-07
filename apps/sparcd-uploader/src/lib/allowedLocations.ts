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

/**
 * Resolve a persisted picker value only when it is still current. The picker
 * stores `Location.key` because ids repeat across distinct coordinates; a bare
 * id (saved before that) resolves only when exactly one location has it.
 */
export function findAllowedLocation(locations: Location[], selectedId: string | null): Location | null {
  if (!selectedId) return null;
  const byKey = locations.find((location) => location.key === selectedId);
  if (byKey) return byKey;
  const byId = locations.filter((location) => location.id === selectedId);
  return byId.length === 1 ? byId[0] : null;
}
