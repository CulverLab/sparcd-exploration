import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';
import { onlyLocations, type Registries } from '../../src/data';
import { DEFAULT_SORTING, readLast, useStore } from '../../src/store';
import { collection, collectionRef, deployment, media, observation } from '../support/fixtures';

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
