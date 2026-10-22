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
  type FileCheck,
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

/** Where a row or data-check action came from, for Back: the view, filters and page scroll, and the model they were for. */
export type Back = Snapshot & { scroll: number; model: Model | null };

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
  /** Uploads whose folder the last listing couldn't list. */
  filesUnchecked: number;
  /** How far the server's clock is ahead of this computer's, in ms, once the explorer has had to adjust for it. */
  clockOffset: number;
  /**
   * Photo files a read found gone this session, as `bucket/key`: left out like
   * `missingFiles` and never requested again, until a listing finds them.
   */
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
  /** Set by a row or data-check action; the filter bar or Reset lets it go. */
  back: Back | null;

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
  /** Take in a listing's answer, rebuilding when the photo files left out change. */
  applyFiles: (check: FileCheck) => void;
  /** A read found this photo file gone (404 or NoSuchKey). */
  markGone: (key: string) => void;
  setFilters: (change: (f: FilterState) => FilterState) => void;
  /** A filter button's ×, and the other clears of one dimension. With `undo`, says so in a toast whose Undo puts the filter back. */
  clearFilter: (dim: FilterDimension, undo?: string) => void;
  /** The Tagged switch over the photos, which keeps Back: it looks at what a drill-down showed. */
  setPhotoTag: (photoTag: FilterState['photoTag']) => void;
  /** Apply a change to filters and view state with an Undo toast. */
  withUndo: (message: string, change: (s: Snapshot) => Snapshot) => void;
  /** A row or data-check action: `withUndo`, and Back to where it came from, `scroll` included. One level; a new one replaces it. */
  drillDown: (message: string, change: (s: Snapshot) => Snapshot, scroll: number) => void;
  /** Back to where the last drill-down came from. */
  goBack: () => void;
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

/** The photo files left out: those the listing lacks and those reads found gone. */
const leftOut = (s: Pick<State, 'missingFiles' | 'gone'>): ReadonlySet<string> =>
  s.gone.size ? new Set([...s.missingFiles, ...s.gone]) : s.missingFiles;

/** How long reads finding files gone are gathered, so a burst (a folder emptied since its listing) rebuilds once. */
export const GONE_BATCH_MS = 100;
let goneTimer: ReturnType<typeof setTimeout> | undefined;

/** Rebuild with the photo files left out now. The filters carry over. */
function rebuildFiles(): void {
  clearTimeout(goneTimer);
  goneTimer = undefined;
  const s = useStore.getState();
  if (!s.model) return;
  const next = model(s.loaded, s.registries, leftOut(s));
  useStore.setState({ model: next, filters: carryFilters(s.model, next, s.filters, { separate: s.separate }).state });
}

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
  filesUnchecked: 0,
  clockOffset: 0,
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
  back: null,

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
      filesUnchecked: 0,
      clockOffset: 0,
      gone: NONE,
      filters: NO_FILTERS,
      separate: false,
      sorting: DEFAULT_SORTING,
      toast: null,
      back: null,
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
    const next = model(loaded, registries, leftOut(get()));
    // Another set of collections keeps the filters that still apply.
    const carried = before ? carryFilters(before, next, previous, { separate }) : { state: NO_FILTERS, dropped: false };
    set({
      screen: 'workspace',
      refs,
      loaded,
      registries,
      model: next,
      highlight: null,
      checkedAt: Math.min(...loaded.map((c) => c.checkedAt)),
      checkError: null,
      filesUnchecked: 0,
      filters: carried.state,
      separate: before ? separate : false,
      toast: null,
      back: null,
    });
    if (carried.dropped) {
      // Onto the model shown when Undo is pressed: a refresh since may have changed it.
      get().showToast('Some filters no longer apply', () => {
        set({ filters: carryFilters(before!, get().model!, previous, { separate, strict: true }).state });
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
    const next = model(loaded, registries, leftOut(get()));
    const { model: before, filters, separate } = get();
    set({
      loaded,
      registries,
      checkedAt: Date.now(),
      checkError: null,
      model: next,
      filters: before ? carryFilters(before, next, filters, { separate }).state : filters,
      highlight: null,
    });
  },

  setChecking: (checking, error = null) => set({ checking, ...(error !== null ? { checkError: error } : {}) }),
  setCheckingFiles: (checkingFiles) => set({ checkingFiles }),

  applyFiles: ({ missing, listed, failed }) => {
    const was = get();
    // A file a read found gone that a listing finds again is back.
    const back = new Set([...was.gone].filter((k) => !missing.has(k) && listed.some((folder) => k.startsWith(folder))));
    const gone = back.size ? new Set([...was.gone].filter((k) => !back.has(k))) : was.gone;
    set({ missingFiles: missing, gone, filesUnchecked: failed });
    if (!sameSet(leftOut(get()), leftOut(was))) rebuildFiles();
  },
  markGone: (key) => {
    const { gone } = get();
    if (gone.has(key)) return;
    // The tile says so at once; the counts follow with the next rebuild.
    set({ gone: new Set([...gone, key]) });
    goneTimer ??= setTimeout(rebuildFiles, GONE_BATCH_MS);
  },

  setFilters: (change) => set({ filters: change(get().filters), back: null }),
  clearFilter: (dim, undo) => {
    if (!undo) return set({ filters: clearFilter(get().filters, dim), back: null });
    set({ back: null });
    get().withUndo(undo, (s) => ({ ...s, filters: clearFilter(s.filters, dim) }));
  },
  setPhotoTag: (photoTag) => set({ filters: { ...get().filters, photoTag } }),

  withUndo: (message, change) => {
    const { filters, separate, view, model: made } = get();
    const before: Snapshot = { filters, separate, view };
    const after = change(before);
    get().setView(after.view);
    set({ filters: after.filters, separate: after.separate });
    get().showToast(message, () => {
      // A refresh since may have added items: the filters go back as their buttons named them.
      const now = get().model;
      const restored =
        made && now && now !== made ? carryFilters(made, now, before.filters, { separate: before.separate, strict: true }).state : before.filters;
      get().setView(before.view);
      set({ filters: restored, separate: before.separate, back: null });
      get().showToast('Filters restored');
    });
  },

  drillDown: (message, change, scroll) => {
    const { filters, separate, view, model: made } = get();
    get().withUndo(message, change);
    set({ back: { filters, separate, view, scroll, model: made } });
  },

  goBack: () => {
    const { back, model: now } = get();
    if (!back) return;
    // A refresh since may have added items: the filters go back as their buttons named them.
    const filters =
      back.model && now && now !== back.model
        ? carryFilters(back.model, now, back.filters, { separate: back.separate, strict: true }).state
        : back.filters;
    get().setView(back.view);
    set({ filters, separate: back.separate, back: null, toast: null });
  },

  resetFilters: () => {
    if (!isFiltered(get().filters)) return;
    set({ back: null });
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
