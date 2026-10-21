import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';
import {
  applyFilters,
  dataChecks,
  loadJob,
  onlyLocations,
  onlySpecies,
  photoSites,
  type LoadedCollection,
  type Registries,
  type ThumbIo,
} from '../../src/data';
import { DEFAULT_SORTING, GONE_BATCH_MS, readLast, useStore } from '../../src/store';
import { collection, collectionRef, deployment, fileNames, media, observation } from '../support/fixtures';

vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    },
  });
});

const account = (accessKey: string): S3Config => ({
  endpoint: 'https://server.example.org',
  region: 'us-east-1',
  accessKey,
  secretKey: 'secret',
  forcePathStyle: true,
});

const NONE: Registries = { species: [], registry: [] };

function loaded(name: string, uuid: string, site: string) {
  const ref = collectionRef(name, uuid);
  const built = collection(name, uuid)
    .upload('u1', {
      deployments: [deployment(site, 'Ridge', 12.5, -100.25)],
      media: [media('u1', 'a.jpg', site, '2024-01-01T10:00:00')],
      observations: [observation('u1', 'a.jpg', site, '', { common: 'Bobcat', scientific: 'Lynx rufus' })],
    })
    .build();
  return { ref, loaded: built };
}

const alpha = loaded('Alpha', 'aaa', 'AA01');
const bravo = loaded('Bravo', 'bbb', 'BB01');
const charlie = loaded('Charlie', 'ccc', 'CC01');

function open(...parts: (typeof alpha)[]) {
  const s = useStore.getState();
  return s.enterWorkspace(
    s.beginOpen(),
    parts.map((p) => p.ref),
    parts.map((p) => p.loaded),
    NONE,
  );
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().adoptSession(null);
  useStore.getState().adoptSession(account('alice'));
});

describe('opening collections', () => {
  it("never lands an open started under one account after another signs in", () => {
    const s = useStore.getState();
    const stamp = s.beginOpen();
    s.adoptSession(account('bob'));
    expect(useStore.getState().enterWorkspace(stamp, [alpha.ref], [alpha.loaded], NONE)).toBe(false);
    expect(useStore.getState()).toMatchObject({ screen: 'chooser', model: null, refs: [] });
    expect(readLast(useStore.getState().account)).toEqual([]);
  });

  it('lets only the latest open land', () => {
    const s = useStore.getState();
    const first = s.beginOpen();
    const second = s.beginOpen();
    expect(s.enterWorkspace(first, [alpha.ref], [alpha.loaded], NONE)).toBe(false);
    expect(s.enterWorkspace(second, [bravo.ref], [bravo.loaded], NONE)).toBe(true);
    expect(useStore.getState().model?.collections.map((c) => c.name)).toEqual(['Bravo']);
  });

  it('drops an open that was cancelled', () => {
    const s = useStore.getState();
    const stamp = s.beginOpen();
    s.cancelOpen();
    expect(s.enterWorkspace(stamp, [alpha.ref], [alpha.loaded], NONE)).toBe(false);
    expect(useStore.getState().model).toBeNull();
  });

  it('remembers the combination for the account that opened it', () => {
    open(alpha, bravo);
    expect(readLast(useStore.getState().account)).toEqual([alpha.ref.key, bravo.ref.key]);
  });
});

describe('changing collections', () => {
  it('returns to the same selection untouched', () => {
    open(alpha);
    const s = useStore.getState();
    s.setFilters((f) => ({ ...f, species: { hidden: [], hideUntagged: true }, photoTag: 'untagged' }));
    s.setSeparate(true);
    const { model, filters } = useStore.getState();
    s.showChooser();
    expect(useStore.getState().resumeWorkspace([alpha.ref])).toBe(true);
    expect(useStore.getState()).toMatchObject({ screen: 'workspace', model, filters, separate: true });
    expect(useStore.getState().toast).toBeNull();
  });

  it('keeps the filters that still apply and says when some no longer do, with Undo', () => {
    open(alpha, bravo);
    const s = useStore.getState();
    const two = useStore.getState().model!;
    s.setFilters((f) => ({
      ...f,
      species: { hidden: [], hideUntagged: true },
      locations: onlyLocations(two, ['id:AA01']),
      area: [two.sites[0].key],
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      elevation: [500, 1500],
      photoTag: 'tagged',
    }));
    s.setSeparate(true);
    const before = useStore.getState().filters;
    s.showChooser();
    expect(open(alpha)).toBe(true);
    const after = useStore.getState();
    // AA01 was the one location ticked, and it is all there is now.
    expect(after.filters).toEqual({ ...before, locations: { hidden: [] } });
    expect(after.separate).toBe(true);
    expect(after.toast).toBeNull();

    s.showChooser();
    expect(open(bravo)).toBe(true);
    expect(useStore.getState().filters.area).toEqual([]);
    expect(useStore.getState().filters.species).toEqual({ hidden: [], hideUntagged: true });
    expect(useStore.getState().toast?.message).toBe('Some filters no longer apply');
    useStore.getState().toast!.undo!();
    expect(useStore.getState().filters.area).toEqual(before.area);
  });

  it('puts back what no longer applies onto the model shown when Undo is pressed, after a refresh', () => {
    open(alpha, bravo);
    const two = useStore.getState().model!;
    useStore.getState().setFilters((f) => ({ ...f, locations: onlyLocations(two, ['id:AA01']) }));
    useStore.getState().showChooser();
    open(bravo);
    expect(useStore.getState().toast?.message).toBe('Some filters no longer apply');
    // A refresh brings Bravo a new location before Undo.
    const grown = collection('Bravo', 'bbb')
      .upload('u1', { deployments: [deployment('BB01', 'Ridge', 12.5, -100.25)], media: [media('u1', 'a.jpg', 'BB01', '2024-01-01T10:00:00')] })
      .upload('u2', { deployments: [deployment('BB02', 'Wash', 13.5, -101.25)], media: [media('u2', 'c.jpg', 'BB02', '2024-02-01T10:00:00')] })
      .build();
    useStore.getState().applyRefresh([grown], NONE);
    useStore.getState().toast!.undo!();
    const { model, filters } = useStore.getState();
    // "Only AA01", which nothing here matches: BB02 stays out too.
    expect(filters.locations.hidden.sort()).toEqual(photoSites(model!).map((s) => s.key).sort());
    expect(applyFilters(model!, filters).photos).toEqual([]);
  });

  it('says nothing when every filter still applies', () => {
    open(alpha);
    useStore.getState().setFilters((f) => ({ ...f, species: { hidden: [], hideUntagged: true } }));
    useStore.getState().showChooser();
    open(alpha, bravo);
    expect(useStore.getState().toast).toBeNull();
    expect(useStore.getState().filters.species).toEqual({ hidden: [], hideUntagged: true });
  });

  it('keeps "only these" on a location when another collection brings new ones', () => {
    open(alpha, bravo);
    const two = useStore.getState().model!;
    useStore.getState().setFilters((f) => ({ ...f, locations: onlyLocations(two, ['id:AA01']) }));
    useStore.getState().showChooser();
    open(alpha, bravo, charlie);
    const { model, filters } = useStore.getState();
    expect(filters.locations.hidden.map((k) => model!.sites.find((s) => s.key === k)!.locationId).sort()).toEqual(['BB01', 'CC01']);
  });

  it('never stores filters, so no filter shape from an older build can come back', () => {
    const written: string[] = [];
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => void written.push(`${k}=${v}`));
    open(alpha, bravo);
    const two = useStore.getState().model!;
    useStore.getState().setFilters((f) => ({ ...f, locations: onlyLocations(two, ['id:AA01']), years: [2024] }));
    useStore.getState().resetFilters();
    useStore.getState().toast!.undo!();
    setItem.mockRestore();
    expect(written.join('\n')).not.toMatch(/"hidden"|"years"|speciesMode/);
  });
});

describe('Undo', () => {
  const herd = (coyote: boolean): LoadedCollection => {
    const c = collection('Herd', 'hhh').upload('u1', {
      deployments: [deployment('HH01', 'Ridge', 12.5, -100.25)],
      media: [media('u1', 'a.jpg', 'HH01', '2024-01-01T10:00:00'), media('u1', 'b.jpg', 'HH01', '2024-01-02T10:00:00')],
      observations: [
        observation('u1', 'a.jpg', 'HH01', '', { common: 'Bobcat', scientific: 'Lynx rufus' }),
        observation('u1', 'b.jpg', 'HH01', '', { common: 'Deer', scientific: 'Odocoileus hemionus' }),
      ],
    });
    if (coyote) {
      c.upload('u2', {
        deployments: [deployment('HH01', 'Ridge', 12.5, -100.25)],
        media: [media('u2', 'c.jpg', 'HH01', '2024-02-01T10:00:00')],
        observations: [observation('u2', 'c.jpg', 'HH01', '', { common: 'Coyote', scientific: 'Canis latrans' })],
      });
    }
    return c.build();
  };

  it('puts back "only Bobcat" after a refresh adds a species, which stays out', () => {
    const s = useStore.getState();
    s.enterWorkspace(s.beginOpen(), [collectionRef('Herd', 'hhh')], [herd(false)], NONE);
    s.setFilters((f) => ({ ...f, species: onlySpecies(useStore.getState().model!, ['Lynx rufus']) }));
    s.resetFilters();
    s.applyRefresh([herd(true)], NONE);
    useStore.getState().toast!.undo!();
    const { model, filters } = useStore.getState();
    expect(fileNames(model!, applyFilters(model!, filters).photos)).toEqual(['a.jpg']);
  });
});

describe('Back, after a row or data-check action', () => {
  const showPhotosOf = (id: string, scroll: number) =>
    useStore.getState().drillDown(
      `Showing photos from ${id}`,
      (s) => ({
        ...s,
        filters: { ...s.filters, locations: onlyLocations(useStore.getState().model!, [`id:${id}`]), photoTag: 'all' },
        view: 'photos',
      }),
      scroll,
    );

  beforeEach(() => {
    open(alpha, bravo);
    useStore.getState().setView('locations');
    useStore.getState().setFilters((f) => ({ ...f, species: onlySpecies(useStore.getState().model!, ['Lynx rufus']) }));
  });

  it('goes back to the view, the exact filters and the scroll it came from', () => {
    const before = useStore.getState().filters;
    showPhotosOf('AA01', 420);
    expect(useStore.getState().view).toBe('photos');
    expect(useStore.getState().back).toMatchObject({ view: 'locations', filters: before, scroll: 420 });
    useStore.getState().goBack();
    const s = useStore.getState();
    expect([s.view, s.filters, s.back]).toEqual(['locations', before, null]);
  });

  it('is one level: a new drill-down replaces it', () => {
    showPhotosOf('AA01', 420);
    useStore.getState().setView('species');
    showPhotosOf('BB01', 90);
    expect(useStore.getState().back).toMatchObject({ view: 'species', scroll: 90 });
  });

  it('goes once the filter bar or Reset is used, and stays through the Tagged switch', () => {
    showPhotosOf('AA01', 0);
    useStore.getState().setPhotoTag('tagged');
    expect(useStore.getState().back).not.toBeNull();
    useStore.getState().setFilters((f) => ({ ...f, years: [2024] }));
    expect(useStore.getState().back).toBeNull();
    showPhotosOf('AA01', 0);
    useStore.getState().clearFilter('species');
    expect(useStore.getState().back).toBeNull();
    showPhotosOf('AA01', 0);
    useStore.getState().resetFilters();
    expect(useStore.getState().back).toBeNull();
  });

  it("goes with the drill-down's own Undo, which puts back the same place", () => {
    const before = useStore.getState().filters;
    showPhotosOf('AA01', 0);
    useStore.getState().toast!.undo!();
    const s = useStore.getState();
    expect([s.view, s.filters, s.back]).toEqual(['locations', before, null]);
  });

  it('goes when other collections open', () => {
    showPhotosOf('AA01', 0);
    open(alpha);
    expect(useStore.getState().back).toBeNull();
  });
});

describe('refresh', () => {
  it('rebuilds after every finished check, so new read problems and corrected names show', () => {
    open(alpha);
    const before = useStore.getState().model!;
    const problem = { folder: 'Collections/aaa/Uploads/u1/', file: 'media.csv' as const, message: 'Access denied' };
    useStore.getState().applyRefresh([{ ...alpha.loaded, changed: false, problems: [problem] }], {
      species: [[{ key: 'Lynx rufus', commonName: 'Bobcat (renamed)', scientificName: 'Lynx rufus', iconUrl: '', keyBinding: null }]],
      registry: [],
    });
    const after = useStore.getState().model!;
    expect(after).not.toBe(before);
    expect(after.problems).toHaveLength(1);
    expect(after.species[0].name).toBe('Bobcat (renamed)');
  });

  it('carries the filters onto the rebuilt model', () => {
    open(alpha);
    const site = useStore.getState().model!.sites[0].key;
    useStore.getState().setFilters((f) => ({ ...f, area: [site, 'sparcd-gone::gone|ZZ99||'] }));
    useStore.getState().applyRefresh([alpha.loaded], NONE);
    expect(useStore.getState().filters.area).toEqual([site]);
  });
});

describe('photo files missing from storage', () => {
  const keyOf = () => `${alpha.ref.bucket}/${useStore.getState().model!.photos[0].key}`;
  /** The folder a listing of the photo's file covers. */
  const folderOf = () => keyOf().replace(/[^/]+$/, '');
  const counted = () => applyFilters(useStore.getState().model!, useStore.getState().filters).total;
  const io = (err: unknown): ThumbIo => ({
    readHead: () => Promise.reject(err),
    extract: async () => undefined,
    presign: async (key) => `https://server.example.org/${key}?signed`,
    preload: async () => {},
    preloadVideo: async () => ({}) as HTMLVideoElement,
    releaseVideo: () => {},
    objectUrl: () => 'blob:thumb',
    now: () => 0,
  });
  const read = (err: unknown) =>
    loadJob(io(err), keyOf(), new AbortController().signal, (key) => useStore.getState().markGone(key)).catch(() => {});

  it('rebuild the model with those photos flagged, and only when the set changes', () => {
    open(alpha);
    const key = keyOf();
    useStore.getState().applyFiles({ missing: new Set([key]), listed: [folderOf()], failed: 0 });
    const flagged = useStore.getState().model!;
    expect(flagged.photos[0].missing).toBe(true);
    useStore.getState().applyFiles({ missing: new Set([key]), listed: [folderOf()], failed: 0 });
    expect(useStore.getState().model).toBe(flagged);
  });

  it('say in Data checks how many uploads could not be listed, until a check lists them', () => {
    open(alpha);
    useStore.getState().applyFiles({ missing: new Set(), listed: [], failed: 1 });
    const unchecked = () => dataChecks(useStore.getState().model!, useStore.getState().filesUnchecked).filter((c) => c.kind === 'unchecked-files');
    expect(unchecked()).toEqual([{ kind: 'unchecked-files', uploads: 1 }]);
    useStore.getState().applyFiles({ missing: new Set(), listed: [folderOf()], failed: 0 });
    expect(unchecked()).toEqual([]);
  });

  it('found gone by a read (404) are left out of the counts like missing ones, once a burst settles', async () => {
    vi.useFakeTimers();
    try {
      open(alpha);
      expect(counted()).toBe(1);
      await read(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }));
      expect(useStore.getState().gone.has(keyOf())).toBe(true);
      expect(counted()).toBe(1);
      vi.advanceTimersByTime(GONE_BATCH_MS);
      expect(useStore.getState().model!.photos[0].missing).toBe(true);
      expect(counted()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never count a file gone on a refusal (403) or a network error', async () => {
    vi.useFakeTimers();
    try {
      open(alpha);
      await read(Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
      await read(new TypeError('Failed to fetch'));
      vi.advanceTimersByTime(GONE_BATCH_MS);
      expect(useStore.getState().gone.size).toBe(0);
      expect(counted()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('found gone come back when a listing finds them, as after Refresh', () => {
    vi.useFakeTimers();
    try {
      open(alpha);
      useStore.getState().markGone(keyOf());
      vi.advanceTimersByTime(GONE_BATCH_MS);
      expect(counted()).toBe(0);
      // A listing of another folder says nothing about it.
      useStore.getState().applyFiles({ missing: new Set(), listed: [`${alpha.ref.bucket}/Collections/aaa/Uploads/u9/`], failed: 0 });
      expect(useStore.getState().gone.size).toBe(1);
      useStore.getState().applyFiles({ missing: new Set(), listed: [folderOf()], failed: 0 });
      expect(useStore.getState().gone.size).toBe(0);
      expect(useStore.getState().model!.photos[0].missing).toBe(false);
      expect(counted()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('found gone while browsing are remembered for the session, and forgotten for another account', () => {
    useStore.getState().markGone('sparcd-aaa/x.jpg');
    expect(useStore.getState().gone.has('sparcd-aaa/x.jpg')).toBe(true);
    useStore.getState().adoptSession(account('bob'));
    expect(useStore.getState().gone.size).toBe(0);
  });
});

describe('table sorts', () => {
  it('are kept per table in the store, where the downloads and the report read them', () => {
    open(alpha);
    useStore.getState().setSorting('photos', [{ id: 'time', desc: false }]);
    useStore.getState().setSorting('locations', [{ id: 'photos', desc: true }]);
    expect(useStore.getState().sorting).toEqual({
      locations: [{ id: 'photos', desc: true }],
      species: DEFAULT_SORTING.species,
      photos: [{ id: 'time', desc: false }],
    });
  });

  it('go back to the defaults for another account', () => {
    useStore.getState().setSorting('photos', [{ id: 'time', desc: false }]);
    useStore.getState().adoptSession(account('bob'));
    expect(useStore.getState().sorting).toBe(DEFAULT_SORTING);
  });
});
