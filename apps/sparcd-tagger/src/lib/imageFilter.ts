import type { DraftObservation } from './db';

export type ImageFilterScope = 'all' | 'filename' | 'species' | 'date';
export type TaggedFilter = 'all' | 'tagged' | 'untagged';

export type ImageFilter = {
  text: string;
  scope: ImageFilterScope;
  tagged: TaggedFilter;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

export const EMPTY_IMAGE_FILTER: ImageFilter = {
  text: '',
  scope: 'all',
  tagged: 'all',
  year: '',
  month: '',
  day: '',
  hour: '',
  minute: '',
};

export type FilterableImage = {
  fileName: string;
  timestamp: string;
  observations: DraftObservation[];
};

const lower = (value: string) => value.toLocaleLowerCase();

function dateParts(timestamp: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  return {
    year: timestamp.slice(0, 4),
    month: timestamp.slice(5, 7),
    day: timestamp.slice(8, 10),
    hour: timestamp.slice(11, 13),
    minute: timestamp.slice(14, 16),
  };
}

function normalizeDatePart(part: 'year' | 'month' | 'day' | 'hour' | 'minute', value: string): string {
  return !value || part === 'year' ? value : value.padStart(2, '0');
}

export function matchesImageFilter(image: FilterableImage, filter: ImageFilter): boolean {
  const tagged = image.observations.length > 0;
  if (filter.tagged === 'tagged' && !tagged) return false;
  if (filter.tagged === 'untagged' && tagged) return false;

  const date = dateParts(image.timestamp);
  const requestedDateParts = {
    year: normalizeDatePart('year', filter.year),
    month: normalizeDatePart('month', filter.month),
    day: normalizeDatePart('day', filter.day),
    hour: normalizeDatePart('hour', filter.hour),
    minute: normalizeDatePart('minute', filter.minute),
  };
  if (
    Object.entries(requestedDateParts).some(
      ([part, value]) => value && date[part as keyof typeof date] !== value,
    )
  ) {
    return false;
  }

  const query = lower(filter.text.trim());
  if (!query) return true;
  const filename = lower(image.fileName);
  const species = lower(
    image.observations.map((o) => `${o.commonName} ${o.scientificName}`).join(' '),
  );
  const timestamp = lower(image.timestamp);
  const haystack = {
    all: `${filename} ${species} ${timestamp}`,
    filename,
    species,
    date: timestamp,
  }[filter.scope];
  return haystack.includes(query);
}
