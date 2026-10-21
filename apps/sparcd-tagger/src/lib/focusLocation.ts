import type { Deployment } from '@sparcd/camtrap';

/** Focus needs both recorded fields; a partial deployment is not a location label. */
export function focusLocationLabel(deployment: Deployment | null | undefined): string | null {
  const name = deployment?.locationName.trim();
  const id = deployment?.locationId.trim();
  return name && id ? `${name} (${id})` : null;
}
