import { create } from 'zustand';
import { clearSharedConnection, loadSessionConnection, saveSharedConnection } from '@sparcd/auth-ui';
import type { CollectionRef } from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';
import {
  DEFAULT_PRECISION,
  NO_FILTERS,
  accountKey,
  buildModel,
  carryFilters,
  clearFilter,
  isFiltered,
  resetFilters,
  type FilterDimension,
  type FilterState,
  type LoadedCollection,
  type Model,
  type Registries,
} from '@/data';
import type { Display } from '@/lib/format';
import { readStored, writeStored } from '@/lib/storage';

export type View = 'locations' | 'species' | 'photos' | 'charts';
export type TableView = Exclude<View, 'charts'>;
/** A table's sort: its column and direction, as the table's header sets it. */
export type Sorting = { id: string; desc: boolean }[];
export type MapMode = 'hexes' | 'sites';
export type PhotoLayout = 'grid' | 'list';
export type { Registries };

/** Who started an open, and which open it was. Only the latest open for the signed-in account may land. */
export type OpenStamp = { account: string; generation: number };

type Toast = { id: number; message: string; undo?: () => void };

/** Everything a reset or a data-check shortcut can change, so Undo can put it back. */
type Snapshot = { filters: FilterState; separate: boolean; view: View };

type State = {
  config: S3Config | null;
  account: string;
  screen: 'chooser' | 'workspace';
  /** Collection keys ticked in the chooser. */
  picks: string[];
  refs: CollectionRef[];
  loaded: LoadedCollection[];
  registries: Registries;
  model: Model | null;
  checking: boolean;
  checkedAt: number | null;
  checkError: string | null;
  /** Photo files media.csv lists that storage lacks, as `bucket/key`, from the last listing. */
  missingFiles: ReadonlySet<string>;
  /** The listing behind `missingFiles` is running. */
  checkingFiles: boolean;
  /** Photo files a thumbnail read found gone this session, as `bucket/key`: never requested again. */
  gone: ReadonlySet<string>;
  filters: FilterState;
  /** "Show each location ID separately", in Data checks. */
  separate: boolean;
  view: View;
  photoLayout: PhotoLayout;
  /** Each table's sort, which its downloads and the report follow too. */
  sorting: Record<TableView, Sorting>;
  display: Display;
  toast: Toast | null;
  /** Bumped by every open, cancel and account change. */
  openGeneration: number;
  mapMode: MapMode;
  /** Sites of the Locations row under the pointer or focus, lit on the map. */
  highlight: number[] | null;

  signIn: (config: S3Config, remember: boolean) => void;
  adoptSession: (config: S3Config | null) => void;
  signOut: () => void;
  showChooser: () => void;
  setPicks: (picks: string[]) => void;
  beginOpen: () => OpenStamp;
  cancelOpen: () => void;
  /** Back to the open workspace when `refs` is what it already shows. */
  resumeWorkspace: (refs: CollectionRef[]) => boolean;
  /** Show what an open read. Returns false, changing nothing, when a newer open or another account replaced it. */
  enterWorkspace: (stamp: OpenStamp, refs: CollectionRef[], loaded: LoadedCollection[], registries: Registries) => boolean;
  applyRefresh: (loaded: LoadedCollection[], registries: Registries) => void;
  setChecking: (checking: boolean, error?: string | null) => void;
  setCheckingFiles: (checking: boolean) => void;
  /** Rebuild with these photo files missing, unless they are the ones already applied. */
  applyMissing: (missing: ReadonlySet<string>) => void;
  markGone: (key: string) => void;
  setFilters: (change: (f: FilterState) => FilterState) => void;
  clearFilter: (dim: FilterDimension) => void;
  /** Apply a change to filters and view state with an Undo toast. */
  withUndo: (message: string, change: (s: Snapshot) => Snapshot) => void;
  resetFilters: () => void;
  setSeparate: (separate: boolean) => void;
  setView: (view: View) => void;
  setPhotoLayout: (layout: PhotoLayout) => void;
  setSorting: (view: TableView, sorting: Sorting) => void;
  setDisplay: (display: Partial<Display>) => void;
  setMapMode: (mode: MapMode) => void;
  setHighlight: (sites: number[] | null) => void;
  showToast: (message: string, undo?: () => void) => void;
  hideToast: () => void;
};

const DISPLAY_KEY = 'sparcd-explorer-display';
const VIEW_KEY = 'sparcd-explorer-view';
const LAYOUT_KEY = 'sparcd-explorer-photo-layout';
const VIEWS: View[] = ['locations', 'species', 'photos', 'charts'];

export const DEFAULT_SORTING: Record<TableView, Sorting> = {
  locations: [{ id: 'id', desc: false }],
  species: [{ id: 'dets', desc: true }],
  photos: [{ id: 'time', desc: true }],
};

const DEFAULT_DISPLAY: Display = { coords: 'latlon', precision: DEFAULT_PRECISION, elevation: 'm' };
const isDisplay = (v: unknown): v is Display => {
  const d = v as Display;
  return (
    typeof d === 'object' &&
    d !== null &&
    (d.coords === 'latlon' || d.coords === 'utm') &&
    (d.elevation === 'm' || d.elevation === 'ft') &&
    (d.precision?.method === 'round' || d.precision?.method === 'truncate') &&
    (d.precision.digits === null || (Number.isInteger(d.precision.digits) && d.precision.digits >= 0 && d.precision.digits <= 5))
  );
};

/** The last combination opened by this account, for "Continue with …". */
export const lastKey = (account: string) => `sparcd-explorer-last:${account}`;
export const readLast = (account: string): string[] =>
  readStored<string[]>(lastKey(account), [], (v): v is string[] => Array.isArray(v) && v.every((k) => typeof k === 'string'));

const initial = loadSessionConnection();
let toastId = 0;

const NONE: ReadonlySet<string> = new Set();

function model(loaded: LoadedCollection[], registries: Registries, missing: ReadonlySet<string>): Model {
  return buildModel(loaded, { species: registries.species, registry: registries.registry, missing });
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((k) => b.has(k));

export const useStore = create<State>((set, get) => ({
  config: initial,
  account: initial ? accountKey(initial) : '',
  screen: 'chooser',
  picks: [],
  refs: [],
  loaded: [],
  registries: { species: [], registry: [] },
  model: null,
  checking: false,
  checkedAt: null,
  checkError: null,
  missingFiles: NONE,
  checkingFiles: false,
  gone: NONE,
  filters: NO_FILTERS,
  separate: false,
  view: readStored<View>(VIEW_KEY, 'locations', (v): v is View => VIEWS.includes(v as View)),
  photoLayout: readStored<PhotoLayout>(LAYOUT_KEY, 'grid', (v): v is PhotoLayout => v === 'grid' || v === 'list'),
  sorting: DEFAULT_SORTING,
  display: readStored(DISPLAY_KEY, DEFAULT_DISPLAY, isDisplay),
  toast: null,
  openGeneration: 0,
  mapMode: 'hexes',
  highlight: null,

  signIn: (config, remember) => {
    saveSharedConnection(config, remember);
    get().adoptSession(config);
  },

  adoptSession: (config) => {
    const account = config ? accountKey(config) : '';
    if (config && account === get().account && get().config) {
      set({ config });
      return;
    }
    set({
      config,
      account,
      screen: 'chooser',
      picks: [],
      refs: [],
      loaded: [],
      model: null,
      missingFiles: NONE,
      gone: NONE,
      filters: NO_FILTERS,
      separate: false,
      sorting: DEFAULT_SORTING,
      toast: null,
      openGeneration: get().openGeneration + 1,
    });
  },

  signOut: () => {
    clearSharedConnection();
    get().adoptSession(null);
  },

  showChooser: () => set({ screen: 'chooser', picks: get().refs.map((r) => r.key), toast: null }),
  setPicks: (picks) => set({ picks }),

  beginOpen: () => {
    const generation = get().openGeneration + 1;
    set({ openGeneration: generation });
    return { account: get().account, generation };
  },
  cancelOpen: () => set({ openGeneration: get().openGeneration + 1 }),

  resumeWorkspace: (refs) => {
    const { model, refs: open } = get();
    const keys = (list: CollectionRef[]) => list.map((r) => r.key).sort().join('\n');
    if (!model || keys(refs) !== keys(open)) return false;
    set({ screen: 'workspace', openGeneration: get().openGeneration + 1 });
    return true;
  },

  enterWorkspace: (stamp, refs, loaded, registries) => {
    const { account, openGeneration, model: before, filters: previous, separate } = get();
    if (stamp.account !== account || stamp.generation !== openGeneration) return false;
    writeStored(lastKey(account), refs.map((r) => r.key));
    const next = model(loaded, registries, get().missingFiles);
    // Another set of collections keeps the filters that still apply.
    const carried = before ? carryFilters(before, next, previous) : { state: NO_FILTERS, dropped: false };
    set({
      screen: 'workspace',
      refs,
      loaded,
      registries,
      model: next,
      highlight: null,
      checkedAt: Math.min(...loaded.map((c) => c.checkedAt)),
      checkError: null,
      filters: carried.state,
      separate: before ? separate : false,
      toast: null,
    });
    if (carried.dropped) {
      get().showToast('Some filters no longer apply', () => {
        set({ filters: carryFilters(before!, next, previous, true).state });
        get().showToast('Filters restored');
      });
    }
    return true;
  },

  // Every finished check rebuilds: a new read problem or a corrected species
  // or location name changes what the model says even when no upload did.
  // The filters carry over, so a new species or location doesn't slip into a
  // filter that showed only a few.
  applyRefresh: (loaded, registries) => {
    const next = model(loaded, registries, get().missingFiles);
    const { model: before, filters } = get();
    set({
      loaded,
      registries,
      checkedAt: Date.now(),
      checkError: null,
      model: next,
      filters: before ? carryFilters(before, next, filters).state : filters,
      highlight: null,
    });
  },

  setChecking: (checking, error = null) => set({ checking, ...(error !== null ? { checkError: error } : {}) }),
  setCheckingFiles: (checkingFiles) => set({ checkingFiles }),

  applyMissing: (missing) => {
    const { model: before, loaded, registries, filters, missingFiles } = get();
    if (sameSet(missing, missingFiles)) return;
    if (!before) return set({ missingFiles: missing });
    const next = model(loaded, registries, missing);
    set({ missingFiles: missing, model: next, filters: carryFilters(before, next, filters).state });
  },
  markGone: (key) => set({ gone: new Set([...get().gone, key]) }),

  setFilters: (change) => set({ filters: change(get().filters) }),
  clearFilter: (dim) => set({ filters: clearFilter(get().filters, dim) }),

  withUndo: (message, change) => {
    const { filters, separate, view } = get();
    const before: Snapshot = { filters, separate, view };
    const after = change(before);
    get().setView(after.view);
    set({ filters: after.filters, separate: after.separate });
    get().showToast(message, () => {
      get().setView(before.view);
      set({ filters: before.filters, separate: before.separate });
      get().showToast('Filters restored');
    });
  },

  resetFilters: () => {
    if (!isFiltered(get().filters)) return;
    get().withUndo('Filters reset', (s) => ({ ...s, filters: resetFilters(s.filters).state }));
  },

  setSeparate: (separate) => set({ separate }),
  setView: (view) => {
    writeStored(VIEW_KEY, view);
    set({ view });
  },
  setPhotoLayout: (photoLayout) => {
    writeStored(LAYOUT_KEY, photoLayout);
    set({ photoLayout });
  },
  setSorting: (view, sorting) => set({ sorting: { ...get().sorting, [view]: sorting } }),
  setDisplay: (patch) => {
    const display = { ...get().display, ...patch };
    writeStored(DISPLAY_KEY, display);
    set({ display });
  },

  setMapMode: (mapMode) => set({ mapMode }),
  setHighlight: (highlight) => set({ highlight }),
  showToast: (message, undo) => set({ toast: { id: ++toastId, message, undo } }),
  hideToast: () => set({ toast: null }),
}));
