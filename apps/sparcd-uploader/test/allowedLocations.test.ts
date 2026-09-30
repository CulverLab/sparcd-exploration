import { describe, expect, it } from 'vitest';
import type { Location } from '../src/lib/locations';
import { findAllowedLocation, orderAllowedLocations } from '../src/lib/allowedLocations';

const location = (id: string, name = id): Location => ({
  key: `${id}|1,2`,
  id,
  name,
  latitude: 1,
  longitude: 2,
  elevation: 3,
});

describe('collection-scoped assignment locations', () => {
  it('orders current allowed locations by historical use without reintroducing removed IDs', () => {
    const current = [location('BEAR1'), location('COY2')];
    expect(orderAllowedLocations(current, ['REMOVED', 'COY2']).map((entry) => entry.id)).toEqual([
      'COY2',
      'BEAR1',
    ]);
  });

  it('rejects a persisted selection when the collection changes its allowed list', () => {
    const oldLocation = location('BEAR1');
    expect(findAllowedLocation([oldLocation], oldLocation.id)).toBe(oldLocation);
    expect(findAllowedLocation([location('COY2')], oldLocation.id)).toBeNull();
  });
});
