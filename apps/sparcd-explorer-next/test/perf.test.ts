// applyFilters must stay under 100 ms for 200k images. On a slow CI runner,
// raise the budget with PERF_FACTOR (e.g. PERF_FACTOR=3).

import { describe, expect, it } from 'vitest';
import type { Media, NullableDeployment, Observation } from '@sparcd/camtrap';
import {
  NO_FILTERS,
  applyFilters,
  buildModel,
  checkPhotoFiles,
  listKeys,
  missingKeys,
  only,
  onlyLocations,
  onlySpecies,
  type FilterState,
  type LoadedCollection,
} from '../src/data';
import { collectionRef } from './support/fixtures';

const PHOTOS = 200_000;
const UPLOADS = 400;
const BUDGET_MS = 100 * Number(process.env.PERF_FACTOR ?? 1);
const SPECIES = ['Genus alpha', 'Genus beta', 'Genus gamma', 'Genus delta', 'Genus epsilon', 'Genus zeta'];

function syntheticCollection(): LoadedCollection {
  const perUpload = PHOTOS / UPLOADS;
  const uploads = Array.from({ length: UPLOADS }, (_, u) => {
    const site = `S${String(u % 120).padStart(3, '0')}`;
    const folder = `Collections/perf/Uploads/${u}/`;
    const deployments: NullableDeployment[] = [
      {
        deploymentId: `perf:${site}`,
        locationId: site,
        locationName: `Site ${site}`,
        latitude: 10 + (u % 120) * 0.05,
        longitude: -100 - (u % 120) * 0.05,
        elevation: 500 + (u % 120) * 20,
      },
    ];
    const media: Media[] = [];
    const observations: Observation[] = [];
    for (let i = 0; i < perUpload; i++) {
      const n = u * perUpload + i;
      const day = String(1 + (n % 28)).padStart(2, '0');
      const month = String(1 + (n % 12)).padStart(2, '0');
      const timestamp = `${2019 + (n % 6)}-${month}-${day}T${String(n % 24).padStart(2, '0')}:00:00`;
      const mediaPath = `${folder}IMG_${i}.JPG`;
      media.push({ mediaId: mediaPath, deploymentId: `perf:${site}`, mediaPath, fileName: `IMG_${i}.JPG`, timestamp, mimeType: 'image/jpeg' });
      const scientificName = n % 3 === 0 ? '' : SPECIES[n % SPECIES.length];
      observations.push({
        observationId: `${n}`,
        mediaId: mediaPath,
        deploymentId: `perf:${site}`,
        timestamp,
        observationType: scientificName ? 'animal' : 'blank',
        scientificName,
        count: scientificName ? 1 : 0,
        tags: '',
      });
    }
    return { folder, etags: {}, meta: null, deployments, media, observations };
  });
  return { ref: collectionRef('Perf', 'perf'), uploads, hiddenUploads: [], problems: [], changed: true, checkedAt: 0 };
}

function timed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('performance', () => {
  const model = buildModel([syntheticCollection()]);

  const states: [string, Partial<FilterState>][] = [
    ['no filter', {}],
    ['two species ticked', { species: onlySpecies(model, ['Genus alpha', 'Genus beta']) }],
    ['one species unticked', { species: { hidden: ['Genus alpha'], hideUntagged: false } }],
    ['untagged photos unticked', { species: { hidden: [], hideUntagged: true } }],
    [
      'everything at once',
      {
        species: onlySpecies(model, ['Genus gamma']),
        years: [2020, 2021, 2022],
        months: [3, 4, 5, 6],
        dateFrom: '2020-02-01',
        dateTo: '2023-11-30',
        hours: [20, 6],
        elevation: [600, 2200],
        ranges: only(listKeys(model, 'ranges'), ['S00', 'S01', 'S02', 'S05']),
        locations: onlyLocations(model, Array.from({ length: 60 }, (_, i) => `id:S${String(i).padStart(3, '0')}`)),
      },
    ],
  ];

  it('builds a 200k-image model', () => {
    expect(model.photos).toHaveLength(PHOTOS);
    expect(model.detections.length).toBeGreaterThan(PHOTOS / 2);
  });

  it.each(states)(`applyFilters runs under the budget for 200k images: %s`, (_, partial) => {
    const state = { ...NO_FILTERS, ...partial };
    applyFilters(model, state); // warm up
    const best = Math.min(...Array.from({ length: 5 }, () => timed(() => applyFilters(model, state))));
    expect(best).toBeLessThan(BUDGET_MS);
  });
});

describe('checking 70k photo files', () => {
  const FILES = 70_000;
  const folder = 'Collections/perf/Uploads/big/';
  const media = Array.from({ length: FILES }, (_, i) => ({ mediaPath: `${folder}IMG_${i}.JPG` }));
  // One in thirty never arrived.
  const keys = media.filter((_, i) => i % 30).map((m) => m.mediaPath);

  it('compares media.csv with the listing in one pass', () => {
    const listed = new Set(keys);
    const best = Math.min(...Array.from({ length: 5 }, () => timed(() => missingKeys(media, listed))));
    expect(missingKeys(media, listed)).toHaveLength(Math.ceil(FILES / 30));
    expect(best).toBeLessThan(BUDGET_MS / 2);
  });

  it('never holds the main thread for long while it lists, page by page', async () => {
    const client = {
      async *listObjects(_bucket: string, _prefix?: string, opts: { signal?: AbortSignal } = {}) {
        for (let i = 0; i < keys.length; i += 1000) {
          await new Promise((r) => setTimeout(r, 0));
          opts.signal?.throwIfAborted();
          for (const key of keys.slice(i, i + 1000)) yield { key, size: 1 };
        }
      },
    };
    const db = { files: { where: () => ({ equals: () => ({ toArray: async () => [] }) }), put: async () => undefined } };
    const loaded = [{ ref: collectionRef('Perf', 'perf'), uploads: [{ folder, etags: { 'media.csv': 'v1' }, media }] }];
    let longest = 0;
    let last = performance.now();
    const probe = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 1);
    const { missing } = await checkPhotoFiles({ client, db, account: 'perf' } as never, loaded as never);
    clearInterval(probe);
    expect(missing.size).toBe(Math.ceil(FILES / 30));
    expect(longest).toBeLessThan(BUDGET_MS / 2);
  });
});
