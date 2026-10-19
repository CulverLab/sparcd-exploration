import { describe, expect, it } from 'vitest';
import { DEFAULT_SPECIES, SpeciesShapeError, fetchSpecies, parseSpecies, speciesNamer } from '../src/data';
import { FakeS3 } from './support/fakeS3';
import { species } from './support/fixtures';

const speciesJson = (common: string, scientific: string) =>
  JSON.stringify([{ name: common, scientificName: scientific, speciesIconURL: '', keyBinding: null }]);
const COLLECTION = { bucket: 'sparcd-abc', uuid: 'abc' };

describe('parseSpecies', () => {
  it('keeps valid entries sorted by common name and skips bad or repeated ones', () => {
    const { species: list, skipped } = parseSpecies(
      JSON.stringify([
        { name: 'Zorilla', scientificName: 'Genus zeta', speciesIconURL: '', keyBinding: 'Z' },
        { name: 'Aardwolf', scientificName: 'Genus alpha' },
        { name: 'Again', scientificName: 'Genus alpha' },
        { name: '', scientificName: 'Genus empty' },
        42,
      ]),
    );
    expect(list.map((s) => s.commonName)).toEqual(['Aardwolf', 'Zorilla']);
    expect(list[1].keyBinding).toBe('Z');
    expect(skipped.map((s) => s.reason)).toEqual(['duplicate scientificName', 'name is missing or empty', 'not an object']);
  });

  it('refuses a document that is not an array', () => {
    expect(() => parseSpecies('{"a":1}')).toThrow(SpeciesShapeError);
    expect(() => parseSpecies('nope')).toThrow(SpeciesShapeError);
  });

  it('ships a bundled list', () => {
    expect(DEFAULT_SPECIES.length).toBeGreaterThan(10);
  });
});

describe('fetchSpecies', () => {
  it('reads the collection list first', async () => {
    const s3 = new FakeS3().put('sparcd-abc', 'Collections/abc/species.json', speciesJson('Here', 'Genus here'));
    const result = await fetchSpecies(s3, COLLECTION);
    expect(result.species[0].commonName).toBe('Here');
    expect(result).toMatchObject({ settingsBucket: null, sourceKey: 'Collections/abc/species.json' });
  });

  it('falls back to Settings/species.json when the collection list is missing or empty', async () => {
    const s3 = new FakeS3()
      .put('sparcd-abc', 'Collections/abc/species.json', '[]')
      .put('sparcd-settings-1', 'Settings/species.json', speciesJson('Settled', 'Genus settled'));
    const result = await fetchSpecies(s3, COLLECTION);
    expect(result.species[0].commonName).toBe('Settled');
    expect(result).toMatchObject({ settingsBucket: 'sparcd-settings-1' });

    s3.remove('sparcd-abc', 'Collections/abc/species.json');
    expect((await fetchSpecies(s3, COLLECTION)).species[0].commonName).toBe('Settled');
  });

  it('falls back to the bundled list when no settings bucket can be read', async () => {
    const s3 = new FakeS3().put('sparcd-abc', 'Collections/abc/collection.json', '{}');
    const result = await fetchSpecies(s3, COLLECTION);
    expect(result).toMatchObject({ source: 'default' });
    expect(result.species).toBe(DEFAULT_SPECIES);
  });

  it('surfaces a collection read failure instead of switching to global data', async () => {
    const s3 = new FakeS3().put('sparcd-settings-1', 'Settings/species.json', speciesJson('Settled', 'Genus settled'));
    s3.failures.set(
      'sparcd-abc/Collections/abc/species.json',
      Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }),
    );
    await expect(fetchSpecies(s3, COLLECTION)).rejects.toThrow(/Access denied/);
  });
});

describe('speciesNamer', () => {
  const name = speciesNamer([species('Bobcat', 'Lynx rufus'), species('Mule deer', 'Odocoileus hemionus')]);

  it('names a species from the species list first', () => {
    expect(name('Lynx rufus', 'Wildcat')).toEqual({
      key: 'Lynx rufus',
      scientificName: 'Lynx rufus',
      commonName: 'Bobcat',
      name: 'Bobcat',
    });
  });

  it('then from the [COMMONNAME:…] marker', () => {
    expect(name('Genus unlisted', 'Mystery cat')).toMatchObject({ key: 'Genus unlisted', name: 'Mystery cat' });
  });

  it('then from the scientific name', () => {
    expect(name('Genus unlisted', null)).toMatchObject({ key: 'Genus unlisted', name: 'Genus unlisted' });
  });

  it('joins a common-name-only row to the listed species of that name', () => {
    expect(name('', 'mule deer')).toMatchObject({ key: 'Odocoileus hemionus', name: 'Mule deer' });
    expect(name('', 'Unlisted thing')).toMatchObject({ key: 'Unlisted thing', scientificName: '', name: 'Unlisted thing' });
  });

  it('gives a placeholder row no species', () => {
    expect(name('', null)).toBeNull();
    expect(name('  ', '')).toBeNull();
  });

  it('lets the first list win when lists are merged', () => {
    const merged = speciesNamer([species('First', 'Genus x')], [species('Second', 'Genus x')]);
    expect(merged('Genus x', null)?.name).toBe('First');
  });
});
