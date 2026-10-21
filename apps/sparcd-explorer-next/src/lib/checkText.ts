// Each data check as one plain sentence with one action.

import { NO_LOCATION_KEY, type DataCheck, type Model } from '@/data';
import { fmtN, monthName } from './format';

/** Where an action takes the workspace: these locations, optionally split and in a view. */
export type CheckTarget = { locations: string[]; separate?: boolean; view?: 'locations' | 'photos'; message: string };

export type CheckAction = { label: string } & (
  | { kind: 'show'; target: CheckTarget }
  | { kind: 'retry' }
  | { kind: 'list' }
  | { kind: 'missing-files' }
  | { kind: 'retry-files' }
);

/** One check as one sentence and one action. `key` names it for a location's flag to open it. */
export type CheckLine = { text: string; action: CheckAction; details?: string[]; key?: string };

/** What names a check for the flags in the Locations table; null for checks no flag points at. */
export function checkKey(check: DataCheck): string | null {
  switch (check.kind) {
    case 'no-location':
      return 'no-location';
    case 'moved':
      return `moved:${check.locationId}`;
    case 'near-duplicate-ids':
      return `similar:${check.ids.join('|')}`;
    default:
      return null;
  }
}

export const andList = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const stamp = (folder: string) => folder.replace(/\/$/, '').split('/').pop() ?? folder;

const span = (first: string | null, last: string | null) =>
  first && last ? `${monthName(first)} to ${monthName(last)}` : 'no dated photos';

export function describeCheck(model: Model, check: DataCheck): CheckLine {
  const key = checkKey(check);
  const line = sentence(model, check);
  return key ? { ...line, key } : line;
}

function sentence(model: Model, check: DataCheck): CheckLine {
  switch (check.kind) {
    case 'no-location': {
      const years = check.years.length ? ` from ${andList(check.years.map(String))}` : '';
      const one = check.photos === 1;
      const untagged =
        check.untagged === 0
          ? ''
          : one
            ? ', and it is untagged'
            : `, and ${fmtN(check.untagged)} of them ${check.untagged === 1 ? 'is' : 'are'} untagged`;
      return {
        text: `${fmtN(check.photos)} ${one ? 'photo' : 'photos'}${years} ${one ? 'has' : 'have'} no location (ID 0000)${untagged}.`,
        action: {
          label: one ? 'Show this photo' : 'Show these photos',
          kind: 'show',
          target: { locations: [NO_LOCATION_KEY], view: 'photos', message: 'Showing photos with no location' },
        },
      };
    }
    case 'missing-files': {
      const one = check.photos === 1;
      return {
        text: `${fmtN(check.photos)} ${one ? 'photo is' : 'photos are'} listed in the upload data, but ${one ? "its file isn't" : "their files aren't"} on the server (${check.uploads === 1 ? '1 upload' : `${fmtN(check.uploads)} uploads`}).`,
        action: { label: one ? 'Show it' : 'Show them', kind: 'missing-files' },
      };
    }
    case 'unchecked-files':
      return {
        text: `Couldn't check whether the photo files in ${check.uploads === 1 ? '1 upload' : `${fmtN(check.uploads)} uploads`} are on the server.`,
        action: { label: 'Try again', kind: 'retry-files' },
      };
    case 'unreadable': {
      const where = `upload ${stamp(check.folder)} of ${model.collections[check.collection].name}`;
      const why = check.message.replace(/\.$/, '');
      return {
        text:
          check.file === 'listing'
            ? `The files of ${where} couldn't be listed (${why}).`
            : `${check.file} in ${where} couldn't be read, so its rows are missing (${why}).`,
        action: { label: 'Try again', kind: 'retry' },
      };
    }
    case 'hidden-uploads': {
      const n = check.folders.length;
      return {
        text: `${n === 1 ? '1 upload' : `${fmtN(n)} uploads`} in ${model.collections[check.collection].name} ${n === 1 ? 'is' : 'are'} incomplete and hidden.`,
        action: { label: n === 1 ? 'Show which' : 'List them', kind: 'list' },
        details: check.folders.map(stamp),
      };
    }
    case 'shared-location': {
      const id = check.ids.join(' / ');
      const n = check.spans.length;
      const spans = check.spans.map((s) => `${model.collections[s.collection].name} has ${span(s.first, s.last)}`);
      return {
        text: `${id} appears in ${n} collections: ${spans.join(', ')}.`,
        action: {
          label: n === 2 ? 'Show both' : `Show all ${n}`,
          kind: 'show',
          target: { locations: check.ids.map((i) => `id:${i}`), separate: true, view: 'locations', message: `Showing ${id}` },
        },
      };
    }
    case 'moved':
      return {
        text: `${check.locationId} sits at ${check.pairs} positions, so the camera probably moved.`,
        action: {
          label: 'Show each position',
          kind: 'show',
          target: { locations: [`id:${check.locationId}`], separate: true, view: 'locations', message: `Showing ${check.locationId}` },
        },
      };
    case 'near-duplicate-ids':
      return {
        text: `${andList(check.ids)} look like the same location.`,
        action: {
          label: check.ids.length === 2 ? 'Show both IDs' : `Show all ${check.ids.length} IDs`,
          kind: 'show',
          target: { locations: check.ids.map((i) => `id:${i}`), view: 'locations', message: `Showing ${andList(check.ids)}` },
        },
      };
    case 'no-coordinates': {
      const site = model.sites[check.site];
      return {
        text: `${site.locationId}${site.name ? ` (${site.name})` : ''} has no coordinates, so it can't be placed on the map.`,
        action: {
          label: 'Show it',
          kind: 'show',
          target: { locations: [site.key], view: 'locations', message: `Showing ${site.locationId}` },
        },
      };
    }
    case 'bad-timestamps': {
      const n = check.photos.length;
      const upload = model.uploads[check.upload];
      const sites = [...new Set(check.photos.map((p) => model.sites[model.photos[p].site].key))];
      return {
        text: `${n === 1 ? '1 photo' : `${fmtN(n)} photos`} in upload ${upload.stamp} ${n === 1 ? 'has a date' : 'have dates'} that can't be read, so ${n === 1 ? 'it is' : 'they are'} left out of dates and activity.`,
        action: {
          label: n === 1 ? 'Show its location' : 'Show their location',
          kind: 'show',
          target: { locations: sites, view: 'photos', message: `Showing upload ${upload.stamp}` },
        },
      };
    }
  }
}
