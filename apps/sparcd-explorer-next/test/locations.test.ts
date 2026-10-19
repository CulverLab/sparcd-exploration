import { describe, expect, it } from 'vitest';
import { LocationsShapeError, buildModel, fetchLocations, parseLocations, registryKey } from '../src/data';
import { FakeS3 } from './support/fakeS3';
import { collection, deployment, media } from './support/fixtures';

const entry = (id: string, name: string, lat: number, lng: number, elevation = 1500) => ({
  nameProperty: name,
  idProperty: id,
  latProperty: lat,
  lngProperty: lng,
  elevationProperty: elevation,
});

describe('parseLocations', () => {
  it('keys an entry by ID plus coordinates, never by ID alone', () => {
    const { locations, skipped } = parseLocations(
      JSON.stringify([entry('ZZ01', 'Ridge', 12.5, -100.25), entry('ZZ01', 'Ridge old', 12.75, -100.25), entry('ZZ01', 'Ridge', 12.5, -100.25)]),
    );
    expect(locations.map((l) => l.key)).toEqual([registryKey('ZZ01', 12.5, -100.25), registryKey('ZZ01', 12.75, -100.25)]);
    expect(skipped.map((s) => s.reason)).toEqual(['duplicate (same id and coordinates)']);
  });

  it('skips invalid entries with a reason', () => {
    const { skipped } = parseLocations(
      JSON.stringify([entry('A', '', 1, 1), entry('B', 'b', 95, 1), entry('C', 'c', 1, 1, -20000), { idProperty: 3 }]),
    );
    expect(skipped.map((s) => s.reason)).toEqual(['empty name', 'latitude 95 out of [-85, 85]', 'elevation unset', 'nameProperty is not a string']);
  });

  it('refuses a document that is not an array', () => {
    expect(() => parseLocations('{}')).toThrow(LocationsShapeError);
  });
});

describe('fetchLocations', () => {
  it('reads the collection registry before settings', async () => {
    const s3 = new FakeS3()
      .put('sparcd-abc', 'Collections/abc/locations.json', JSON.stringify([entry('ZZ01', 'Mine', 12.5, -100.25)]))
      .put('sparcd-settings-1', 'Settings/locations.json', JSON.stringify([entry('YY01', 'Global', 11, -101)]));
    expect((await fetchLocations(s3, { bucket: 'sparcd-abc', uuid: 'abc' })).locations[0].name).toBe('Mine');
    expect((await fetchLocations(s3, null)).locations[0].name).toBe('Global');
  });
});

describe('the registry in the model', () => {
  it('names a deployment with no name, and fills a blank elevation, by ID plus coordinates', () => {
    const { locations } = parseLocations(JSON.stringify([entry('ZZ01', 'Registry name', 12.5, -100.25, 1800)]));
    const c = collection().upload('u1', {
      deployments: [deployment('ZZ01', '', 12.5, -100.25, null)],
      media: [media('u1', 'a.jpg', 'ZZ01', '2024-01-01T10:00:00')],
    });
    const model = buildModel([c.build()], { registry: locations });
    expect(model.sites[0]).toMatchObject({ name: 'Registry name', elevation: 1800 });
  });

  it('does not borrow from an entry with the same ID at other coordinates', () => {
    const { locations } = parseLocations(JSON.stringify([entry('ZZ01', 'Elsewhere', 12.75, -100.25)]));
    const c = collection().upload('u1', {
      deployments: [deployment('ZZ01', '', 12.5, -100.25, null)],
      media: [media('u1', 'a.jpg', 'ZZ01', '2024-01-01T10:00:00')],
    });
    expect(buildModel([c.build()], { registry: locations }).sites[0]).toMatchObject({ name: '', elevation: null });
  });
});
