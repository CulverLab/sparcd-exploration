import { describe, expect, it } from 'vitest';
import { EMPTY_IMAGE_FILTER, matchesImageFilter } from '../src/lib/imageFilter';
import type { FilterableImage } from '../src/lib/imageFilter';

const image: FilterableImage = {
  fileName: 'IMG_JAVELINA_001.JPG',
  timestamp: '2024-01-15T10:32:00',
  questionable: false,
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

  it('matches questionable and not-questionable status independently of tag status', () => {
    const questionableImage = { ...image, questionable: true };
    expect(matchesImageFilter(questionableImage, { ...EMPTY_IMAGE_FILTER, tagged: 'questionable' })).toBe(true);
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, tagged: 'questionable' })).toBe(false);
    expect(matchesImageFilter(questionableImage, { ...EMPTY_IMAGE_FILTER, tagged: 'not-questionable' })).toBe(false);
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, tagged: 'not-questionable' })).toBe(true);
    // An untagged image can still be questionable: the two statuses are independent.
    expect(
      matchesImageFilter({ ...questionableImage, observations: [] }, { ...EMPTY_IMAGE_FILTER, tagged: 'questionable' }),
    ).toBe(true);
  });

  it('treats an explicit no-species classification as tagged and composes status with other criteria', () => {
    const ghostImage: FilterableImage = {
      ...image,
      fileName: 'IMG_GHOST.JPG',
      observations: [{
        scientificName: 'Casper',
        commonName: 'Ghost',
        count: 1,
        requestedSpecies: '',
        freeTags: '',
      }],
    };
    expect(matchesImageFilter(ghostImage, { ...EMPTY_IMAGE_FILTER, tagged: 'tagged' })).toBe(true);
    expect(matchesImageFilter(ghostImage, { ...EMPTY_IMAGE_FILTER, tagged: 'untagged' })).toBe(false);
    expect(matchesImageFilter(
      { ...ghostImage, questionable: true },
      { ...EMPTY_IMAGE_FILTER, tagged: 'questionable', text: 'ghost', scope: 'filename', year: '2024' },
    )).toBe(true);
    expect(matchesImageFilter(
      { ...ghostImage, questionable: true },
      { ...EMPTY_IMAGE_FILTER, tagged: 'questionable', text: 'ghost', scope: 'filename', year: '2023' },
    )).toBe(false);
  });

  it('combines populated date components', () => {
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, year: '2024', month: '01', day: '15', hour: '10', minute: '32' })).toBe(true);
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, year: '2024', day: '16' })).toBe(false);
    expect(matchesImageFilter(image, { ...EMPTY_IMAGE_FILTER, month: '1', hour: '10' })).toBe(true);
  });
});
