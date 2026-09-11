import { describe, expect, it } from 'vitest';
import { EMPTY_IMAGE_FILTER, matchesImageFilter } from '../src/lib/imageFilter';
import type { FilterableImage } from '../src/lib/imageFilter';

const image: FilterableImage = {
  fileName: 'IMG_JAVELINA_001.JPG',
  timestamp: '2024-01-15T10:32:00',
  observations: [
    {
      commonName: 'Javelina',
      scientificName: 'Pecari tajacu',
      count: 1,
      requestedSpecies: '',
      freeTags: '',
    },
  ],
};

describe('matchesImageFilter', () => {
  it('matches partial filename, common name, scientific name, and timestamp text', () => {
    for (const text of ['javel', 'pecari', '2024-01-15', '10:32'])
      expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, text })).toBe(true);
  });

  it('honors restricted scopes and tag status', () => {
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, text: 'pecari', scope: 'filename' })).toBe(false);
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, tagged: 'untagged' })).toBe(false);
    expect(matchesImageFilter({ ...image, observations: [] }, { ...EMPTY_IMAGE_FILTER, tagged: 'untagged' })).toBe(true);
  });

  it('combines populated date components', () => {
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, year: '2024', month: '01', day: '15', hour: '10', minute: '32' })).toBe(true);
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, year: '2024', day: '16' })).toBe(false);
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, month: '1', hour: '10' })).toBe(true);
  });
});
