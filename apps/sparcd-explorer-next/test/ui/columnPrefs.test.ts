import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultPrefs,
  loadPrefs,
  mergePrefs,
  moveColumn,
  savePrefs,
  shownColumns,
  toggleColumn,
  type ColumnInfo,
} from '../../src/lib/columnPrefs';

const DEFS: ColumnInfo[] = [
  { id: 'name', def: true },
  { id: 'coll', def: true, multi: true },
  { id: 'photos', def: true },
  { id: 'lat', def: false },
];

describe('column preferences', () => {
  it('start from the defaults', () => {
    expect(defaultPrefs(DEFS)).toEqual({ order: ['name', 'coll', 'photos', 'lat'], visible: ['name', 'coll', 'photos'] });
  });

  it('show and hide a column', () => {
    const p = toggleColumn(toggleColumn(defaultPrefs(DEFS), 'lat'), 'photos');
    expect(p.visible).toEqual(['name', 'coll', 'lat']);
  });

  it('move a column past the ones the editor does not list', () => {
    const singleCollection = (id: string) => id !== 'coll';
    expect(moveColumn(defaultPrefs(DEFS), 'photos', -1, singleCollection).order).toEqual(['photos', 'name', 'coll', 'lat']);
    expect(moveColumn(defaultPrefs(DEFS), 'name', -1, singleCollection).order).toEqual(['name', 'coll', 'photos', 'lat']);
    expect(moveColumn(defaultPrefs(DEFS), 'lat', 1, () => true).order).toEqual(['name', 'coll', 'photos', 'lat']);
  });

  it('show the Collection column only with several collections open', () => {
    expect(shownColumns(defaultPrefs(DEFS), DEFS, false)).toEqual(['name', 'photos']);
    expect(shownColumns(defaultPrefs(DEFS), DEFS, true)).toEqual(['name', 'coll', 'photos']);
  });

  it('drop columns that no longer exist and add new ones at their default place', () => {
    const saved = { order: ['photos', 'gone', 'name'], visible: ['photos', 'gone'] };
    expect(mergePrefs(saved, DEFS)).toEqual({ order: ['photos', 'coll', 'name', 'lat'], visible: ['photos', 'coll'] });
  });
});

describe('saved per view', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips through localStorage, and reset forgets the choice', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const hidden = toggleColumn(defaultPrefs(DEFS), 'name');
    savePrefs('locations', hidden);
    expect(loadPrefs('locations', DEFS)).toEqual(hidden);
    expect(loadPrefs('species', DEFS)).toEqual(defaultPrefs(DEFS));
    savePrefs('locations', null);
    expect(loadPrefs('locations', DEFS)).toEqual(defaultPrefs(DEFS));
  });

  it('falls back to the defaults when storage is unavailable or holds junk', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => savePrefs('locations', defaultPrefs(DEFS))).not.toThrow();
    expect(loadPrefs('locations', DEFS)).toEqual(defaultPrefs(DEFS));
    vi.stubGlobal('localStorage', { getItem: () => '{"order": 3}' });
    expect(loadPrefs('locations', DEFS)).toEqual(defaultPrefs(DEFS));
  });
});
