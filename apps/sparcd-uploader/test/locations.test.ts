// The camera-location registry parser. Pins the id-is-not-unique data contract
// (same id + different coords are distinct locations) and ties the chosen
// location back to the shared `@sparcd/camtrap` deployment serializer.

import { describe, it, expect } from 'vitest';
import {
  parseLocations,
  locationToDeployment,
  LocationsShapeError,
  type RawLocation,
} from '../src/lib/locations';
import {
  serializeDeployments,
  parseDeployments,
  validateCoordinates,
} from '@sparcd/camtrap';
import { restampDeployment } from '../src/lib/publishedEdit';

const raw = (over: Partial<RawLocation>): RawLocation => ({
  nameProperty: 'San Pedro 15',
  idProperty: 'SAN15',
  latProperty: 31.5,
  lngProperty: -110.2,
  elevationProperty: 1200,
  ...over,
});

const doc = (entries: unknown[]): string => JSON.stringify(entries);

describe('parseLocations shape errors', () => {
  it('throws on non-JSON', () => {
    expect(() => parseLocations('not json')).toThrow(LocationsShapeError);
  });

  it('throws when the document is not an array', () => {
    expect(() => parseLocations('{"a":1}')).toThrow(LocationsShapeError);
  });
});

describe('parseLocations entry validity', () => {
  it('skips malformed and out-of-range entries with a reason, keeps valid ones', () => {
    const { locations, skipped } = parseLocations(
      doc([
        raw({}),
        { nameProperty: 'X' }, // missing numeric fields
        raw({ idProperty: 'BAD', latProperty: 999 }), // lat out of range
        raw({ idProperty: 'UNSET', elevationProperty: -20000 }), // sentinel
      ]),
    );
    expect(locations).toHaveLength(1);
    expect(locations[0].id).toBe('SAN15');
    expect(skipped.map((s) => s.reason)).toEqual([
      'idProperty is not a string',
      'latitude 999 out of [-85, 85]',
      'elevation unset',
    ]);
  });
});

describe('id-is-not-unique contract', () => {
  it('keeps same-id / different-coords as distinct locations', () => {
    const { locations } = parseLocations(
      doc([
        raw({ idProperty: 'DUP', latProperty: 31.5, lngProperty: -110.2 }),
        raw({ idProperty: 'DUP', nameProperty: 'DUP *DO NOT USE*', latProperty: 32.0, lngProperty: -111.0 }),
      ]),
    );
    expect(locations).toHaveLength(2);
    expect(locations.every((l) => l.id === 'DUP')).toBe(true);
  });

  it('keeps a coordinate-redacted location selectable by id', () => {
    const { locations, skipped } = parseLocations(doc([raw({ latProperty: null, lngProperty: null })]));
    expect(skipped).toHaveLength(0);
    expect(locations[0]).toMatchObject({ id: 'SAN15', latitude: null, longitude: null });
    expect(locationToDeployment(locations[0], '8dbd9c43-5c3d-411d-8778-617d4693c69b').latitude).toBeNull();
  });

  it('collapses exact duplicates (same id AND coordinates)', () => {
    const { locations, skipped } = parseLocations(
      doc([raw({ idProperty: 'DUP' }), raw({ idProperty: 'DUP' })]),
    );
    expect(locations).toHaveLength(1);
    expect(skipped[0].reason).toBe('duplicate (same id and coordinates)');
  });
});

describe('locationToDeployment → shared camtrap serializer', () => {
  it('round-trips through deployments.csv with the camtrap reader', () => {
    const { locations } = parseLocations(doc([raw({})]));
    const dep = locationToDeployment(locations[0], '8dbd9c43-5c3d-411d-8778-617d4693c69b');
    expect(dep.deploymentId).toBe('8dbd9c43-5c3d-411d-8778-617d4693c69b:SAN15');

    const [back] = parseDeployments(serializeDeployments([dep]));
    expect(back.locationId).toBe('SAN15');
    expect(back.longitude).not.toBeNull();
    expect(back.latitude).not.toBeNull();
    expect(back.longitude!).toBeCloseTo(-110.2, 5);
    expect(back.latitude!).toBeCloseTo(31.5, 5);
    expect(validateCoordinates(back.latitude!, back.longitude!)).toBeNull();
  });

  it('restampDeployment builds toDeploymentId via locationToDeployment and round-trips', () => {
    const uuid = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
    const { locations } = parseLocations(doc([raw({ idProperty: 'SAN20', nameProperty: 'San Pedro 20' })]));
    const target = locationToDeployment(locations[0], uuid);
    expect(target.deploymentId).toBe(`${uuid}:SAN20`);

    const next = restampDeployment(
      { deployments: serializeDeployments([locationToDeployment(raw15(uuid), uuid)]), media: '', observations: '' },
      { fromDeploymentId: `${uuid}:SAN15`, toDeploymentId: target.deploymentId, location: target },
    );
    const [back] = parseDeployments(next.deployments);
    expect(back.deploymentId).toBe(`${uuid}:SAN20`);
    expect(back.locationId).toBe('SAN20');
  });
});

// A SAN15 location parsed to a Deployment, for the restamp source row.
function raw15(_uuid: string) {
  const { locations } = parseLocations(JSON.stringify([raw({})]));
  return locations[0];
}
