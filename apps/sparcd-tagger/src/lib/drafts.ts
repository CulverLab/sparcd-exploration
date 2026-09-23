// Local draft edit state. The in-memory map is the hot path the UI reads and
// writes optimistically; Dexie is the durable mirror written debounced and off
// the keystroke path (plan: "Dexie writes are debounced and off the hot path").
//
// One record per image, keyed by media path. Mutations replace the top-level
// `drafts` object but preserve unchanged record references, so a per-row
// `s.drafts[path]` selector only re-renders the row that actually changed —
// editing one image never re-renders the whole strip.

import { create } from 'zustand';
import { shiftTimestamp, type Deployment } from '@sparcd/camtrap';
import {
  db,
  draftId,
  loadDraftsForUpload,
  discardUploadDrafts,
  uploadId,
  getUpload,
  setUploadTimeOffset,
  setUploadPendingLocation,
  type DraftRecord,
  type DraftObservation,
  type TimeOffsetRecord,
} from './db';

export type { DraftObservation };

/** The built-in non-animal label. Encoded as a species row (`Casper`, count ≥1)
 *  so it counts as species-present exactly like Java treats it (P0 decision).
 *  Ghost is mutually exclusive with real species. */
export const GHOST = { label: 'Casper', commonName: 'Ghost' } as const;

const isGhost = (o: DraftObservation): boolean => o.scientificName === GHOST.label;

export type UploadCtx = { bucket: string; uploadPrefix: string };

/** The canonical base observation set for an image, used to seed a brand-new
 *  draft. Seeding from the FULL base set is the core of the multi-species fix:
 *  editing one species of a multi-species image preserves every other. */
export type BaseSeed = { observations: DraftObservation[] };

/** One image a batch operation targets: its media path + deployment, plus the
 *  optional canonical base set. The base seeds a *freshly created* draft so a
 *  partial edit (e.g. toggling questionable, adding one species) never drops the
 *  image's existing species — a draft is the image's full intended state. */
export type TagTarget = { mediaPath: string; deploymentId: string; base?: BaseSeed };

/** A target for a selection-scoped bulk time offset. `currentCorrected` is the
 *  image's currently-displayed corrected timestamp (upload offset + any existing
 *  per-image override already applied); the bulk delta is added on top of it and
 *  frozen into the image's absolute `timeOverride`, so the whole correction stays
 *  expressed through the canonical override slot — no new resolution input. */
export type BulkTimeTarget = TagTarget & { currentCorrected: string };

/** The species a UI action applies to an image (add-only; one species). */
export type AppliedTag = {
  scientificName: string; // a real species or `Casper`; '' is invalid (use detag)
  commonName: string;
  count: number; // floored to ≥1
  requestedSpecies?: string;
  freeTags?: string;
};

// --- Pure array transforms (exported for unit tests) -----------------------

/** Add-only: applying a species already present is a NO-OP (no dup, no count
 *  change). Mutual exclusivity: applying Ghost replaces the whole set; applying
 *  a real species first clears any Ghost. Order is preserved (append last). */
export function addObservation(obs: DraftObservation[], tag: AppliedTag): DraftObservation[] {
  const next: DraftObservation = {
    scientificName: tag.scientificName,
    commonName: tag.commonName,
    count: Math.max(1, tag.count),
    requestedSpecies: tag.requestedSpecies ?? '',
    freeTags: tag.freeTags ?? '',
  };
  if (isGhost(next)) return [next]; // Ghost replaces all real species
  const withoutGhost = obs.filter((o) => !isGhost(o)); // a real species clears Ghost
  if (withoutGhost.some((o) => o.scientificName === next.scientificName)) return withoutGhost; // NO-OP
  return [...withoutGhost, next];
}

/**
 * Adds species at count 1 if absent; increments its count by 1 if already
 * present. Used by keypress paths so repeated presses accumulate. Ghost is
 * handled defensively through addObservation so it remains exclusive and one.
 */
export function incrementObservation(obs: DraftObservation[], tag: AppliedTag): DraftObservation[] {
  if (tag.scientificName === GHOST.label) return addObservation(obs, { ...tag, count: 1 });
  const withoutGhost = obs.filter((o) => !isGhost(o));
  const existing = withoutGhost.find((o) => o.scientificName === tag.scientificName);
  if (existing) {
    return withoutGhost.map((o) =>
      o.scientificName === tag.scientificName ? { ...o, count: o.count + 1 } : o,
    );
  }
  return addObservation(withoutGhost, { ...tag, count: 1 });
}

/** Remove exactly the named species, keeping every other (and its order). */
export function removeObservation(
  obs: DraftObservation[],
  scientificName: string,
): DraftObservation[] {
  return obs.filter((o) => o.scientificName !== scientificName);
}

/** Set one species' count (floored to ≥1), leaving the others untouched. */
export function setObservationCount(
  obs: DraftObservation[],
  scientificName: string,
  count: number,
): DraftObservation[] {
  return obs.map((o) =>
    o.scientificName === scientificName ? { ...o, count: Math.max(1, count) } : o,
  );
}

type DraftState = {
  loadedKey: string | null; // `${bucket}::${uploadPrefix}` currently hydrated
  loading: boolean;
  drafts: Record<string, DraftRecord>; // by mediaPath
  timeOffset: TimeOffsetRecord | null; // upload-level signed Δ for the loaded upload
  pendingLocation: Deployment | null; // upload-level location correction for the loaded upload

  loadUpload: (ctx: UploadCtx) => Promise<void>;

  /** Add-only species apply to one focused image OR every target in a selection. */
  addSpecies: (ctx: UploadCtx, targets: TagTarget[], tag: AppliedTag) => void;
  /** Keypress path: add at count 1 if absent, increment count by 1 if present. */
  incrementSpecies: (ctx: UploadCtx, targets: TagTarget[], tag: AppliedTag) => void;
  /** Remove ONE species from ONE image (chip ✕). */
  removeSpecies: (
    ctx: UploadCtx,
    mediaPath: string,
    deploymentId: string,
    base: BaseSeed | undefined,
    scientificName: string,
  ) => void;
  /** Set per-species count on ONE image (chip count editor). */
  setSpeciesCount: (
    ctx: UploadCtx,
    mediaPath: string,
    deploymentId: string,
    base: BaseSeed | undefined,
    scientificName: string,
    count: number,
  ) => void;
  /** Detag = clear ALL species on one focused image OR every target in a selection. */
  detag: (ctx: UploadCtx, targets: TagTarget[]) => void;

  /** Set (or clear with null) the upload-level offset applied to every image.
   *  Persists to the `uploads` record so the next sync writes corrected times. */
  setTimeOffset: (ctx: UploadCtx, offset: TimeOffsetRecord | null) => void;
  /** Set (or clear with null) the upload-level pending location correction.
   *  Persists to the `uploads` record so the next sync rewrites deployments.csv
   *  and every media/observation row's deployment id. */
  setPendingLocation: (ctx: UploadCtx, location: Deployment | null) => Promise<void>;
  /** Set (or clear with null) one image's per-image corrected timestamp, on top
   *  of the upload offset. Seeds a fresh draft from base so time-only edits never
   *  drop existing canonical species rows. */
  setTimeOverride: (
    ctx: UploadCtx,
    mediaPath: string,
    deploymentId: string,
    base: BaseSeed | undefined,
    iso: string | null,
  ) => void;

  // Batch variants for whole-burst / multi-select: one state update + one Dexie
  // write per target, so applying to a 2,000-image burst is a single re-render
  // of the changed rows, not 2,000 sequential store mutations.
  setQuestionableMany: (ctx: UploadCtx, targets: TagTarget[], value: boolean) => void;

  /** Apply a signed time delta to a selection by freezing, per image, the new
   *  absolute corrected timestamp into its per-image `timeOverride`. The bulk op
   *  is just a fast way to set many overrides at once; resolution and sync stay
   *  byte-identical to a hand-edited per-image override. */
  applyTimeOffsetToSelection: (
    ctx: UploadCtx,
    targets: BulkTimeTarget[],
    delta: TimeOffsetRecord,
  ) => void;

  /** Flush every pending debounced Dexie write now (manual Cmd/Ctrl+S confirm). */
  flushSaves: () => Promise<void>;
  discardUpload: (ctx: UploadCtx) => Promise<void>;
  /** Clear `dirty` on the drafts that were just synced (they now match the new
   *  base). Drafts not in the sync — e.g. a questionable-only flag, which has no
   *  canonical target — are left dirty so they stay surfaced as unsaved. */
  markUploadSynced: (ctx: UploadCtx, mediaPaths: string[]) => Promise<void>;
};

// Per-record debounce so a burst of keystrokes coalesces into one Dexie write.
const SAVE_DEBOUNCE_MS = 200;
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const activeDiscards = new Map<string, Promise<void>>();

function scheduleSave(record: DraftRecord): void {
  const existing = pending.get(record.id);
  if (existing) clearTimeout(existing);
  pending.set(
    record.id,
    setTimeout(async () => {
      pending.delete(record.id);
      const barrier = activeDiscards.get(uploadId(record.bucket, record.uploadPrefix));
      if (barrier) {
        try {
          await barrier;
        } catch {
          // A failed discard leaves its rows intact; this newer edit still
          // needs to persist after the failed operation settles.
        }
      }
      await db.drafts.put(record);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** A fresh draft for an image, seeded from its canonical base observation set
 *  when one is supplied so a partial edit preserves every existing species. */
export function blankDraft(
  ctx: UploadCtx,
  mediaPath: string,
  deploymentId: string,
  base?: BaseSeed,
): DraftRecord {
  return {
    id: draftId(ctx.bucket, ctx.uploadPrefix, mediaPath),
    bucket: ctx.bucket,
    uploadPrefix: ctx.uploadPrefix,
    mediaPath,
    deploymentId,
    observations: base ? base.observations.map((o) => ({ ...o })) : [],
    questionable: false,
    timeOverride: null,
    lastEdited: '',
    dirty: false,
  };
}

export const useDraftStore = create<DraftState>((set, get) => {
  /** Apply a patch — static, or a reducer of the previous record — to one or
   *  more images in a single state update, scheduling a debounced Dexie write
   *  per touched record. The reducer form lets add/remove/count read the current
   *  observation array (which a static `Partial` cannot). */
  const mutateMany = (
    ctx: UploadCtx,
    targets: TagTarget[],
    patch: Partial<DraftRecord> | ((prev: DraftRecord) => Partial<DraftRecord>),
  ): void => {
    if (!targets.length) return;
    const now = new Date().toISOString();
    const updates: Record<string, DraftRecord> = {};
    const cur = get().drafts;
    for (const { mediaPath, deploymentId, base } of targets) {
      const prev = cur[mediaPath] ?? blankDraft(ctx, mediaPath, deploymentId, base);
      const p = typeof patch === 'function' ? patch(prev) : patch;
      const next: DraftRecord = {
        ...prev,
        deploymentId: deploymentId || prev.deploymentId,
        ...p,
        lastEdited: now,
        dirty: true,
      };
      updates[mediaPath] = next;
      scheduleSave(next);
    }
    set((s) => ({ drafts: { ...s.drafts, ...updates } }));
  };

  return {
    loadedKey: null,
    loading: false,
    drafts: {},
    timeOffset: null,
    pendingLocation: null,

    loadUpload: async (ctx) => {
      const key = uploadId(ctx.bucket, ctx.uploadPrefix);
      if (get().loadedKey === key) return;
      set({ loading: true, loadedKey: key, drafts: {}, timeOffset: null, pendingLocation: null });
      const [rows, upload] = await Promise.all([
        loadDraftsForUpload(ctx.bucket, ctx.uploadPrefix),
        getUpload(ctx.bucket, ctx.uploadPrefix),
      ]);
      // Ignore a result that arrived after the user switched uploads.
      if (get().loadedKey !== key) return;
      const map: Record<string, DraftRecord> = {};
      for (const r of rows) map[r.mediaPath] = r;
      // The `uploads` record's base ETags/hashes are owned by the workspace
      // grounding step (`groundUpload`); the store only reads back the
      // upload-level `timeOffset` / `pendingLocation` it persists via
      // `setTimeOffset` / `setPendingLocation`.
      set({
        loading: false,
        drafts: map,
        timeOffset: upload?.timeOffset ?? null,
        pendingLocation: upload?.pendingLocation ?? null,
      });
    },

    addSpecies: (ctx, targets, tag) =>
      mutateMany(ctx, targets, (prev) => ({ observations: addObservation(prev.observations, tag) })),

    incrementSpecies: (ctx, targets, tag) =>
      mutateMany(ctx, targets, (prev) => ({ observations: incrementObservation(prev.observations, tag) })),

    removeSpecies: (ctx, mediaPath, deploymentId, base, sci) =>
      mutateMany(ctx, [{ mediaPath, deploymentId, base }], (prev) => ({
        observations: removeObservation(prev.observations, sci),
      })),

    setSpeciesCount: (ctx, mediaPath, deploymentId, base, sci, count) =>
      mutateMany(ctx, [{ mediaPath, deploymentId, base }], (prev) => ({
        observations: setObservationCount(prev.observations, sci, count),
      })),

    detag: (ctx, targets) => mutateMany(ctx, targets, { observations: [] }),

    setTimeOffset: (ctx, offset) => {
      // Optimistic Zustand update (hot path) + durable Dexie mirror. Unlike a
      // draft, the offset lives on the `uploads` record, so it never shows in
      // `dirtyCount` — the active-offset indicator (ClockChip) is its signal.
      set({ timeOffset: offset });
      void setUploadTimeOffset(ctx.bucket, ctx.uploadPrefix, offset);
    },

    setPendingLocation: async (ctx, location) => {
      set({ pendingLocation: location });
      await setUploadPendingLocation(ctx.bucket, ctx.uploadPrefix, location);
    },

    setTimeOverride: (ctx, mediaPath, deploymentId, base, iso) =>
      mutateMany(ctx, [{ mediaPath, deploymentId, base }], { timeOverride: iso }),

    setQuestionableMany: (ctx, targets, value) =>
      mutateMany(ctx, targets, { questionable: value }),

    applyTimeOffsetToSelection: (ctx, targets, delta) => {
      // Precompute the new absolute override per image (delta on top of the
      // already-corrected time), keyed by media path so the shared mutateMany
      // reducer — which only sees `prev` — can look each one up.
      const overrideByPath: Record<string, string> = {};
      for (const t of targets) {
        overrideByPath[t.mediaPath] = shiftTimestamp(t.currentCorrected, delta);
      }
      mutateMany(
        ctx,
        targets.map(({ mediaPath, deploymentId, base }) => ({ mediaPath, deploymentId, base })),
        (prev) => ({ timeOverride: overrideByPath[prev.mediaPath] }),
      );
    },

    flushSaves: async () => {
      const records: DraftRecord[] = [];
      for (const [id, timer] of pending) {
        clearTimeout(timer);
        const rec = Object.values(get().drafts).find((d) => d.id === id);
        if (rec) records.push(rec);
      }
      pending.clear();
      if (records.length) await db.drafts.bulkPut(records);
    },

    discardUpload: async (ctx) => {
      const key = uploadId(ctx.bucket, ctx.uploadPrefix);
      const existing = activeDiscards.get(key);
      if (existing) return existing;

      const operation = (async () => {
        const snapshot = new Map(
          Object.entries(get().drafts).filter(
            ([, rec]) => rec.bucket === ctx.bucket && rec.uploadPrefix === ctx.uploadPrefix,
          ),
        );
        for (const rec of snapshot.values()) {
          const timer = pending.get(rec.id);
          if (timer) clearTimeout(timer);
          pending.delete(rec.id);
        }

        try {
          await discardUploadDrafts(ctx.bucket, ctx.uploadPrefix);
        } catch (error) {
          // Timers for the snapshot were cancelled before deletion. If deletion
          // fails, requeue any snapshot record that is still the current version
          // so a very recent edit is not lost on reload.
          const current = get().drafts;
          for (const [path, discarded] of snapshot) {
            if (current[path] === discarded) scheduleSave(discarded);
          }
          throw error;
        }
        if (get().loadedKey !== key) return;
        set((state) => {
          const next = { ...state.drafts };
          for (const [path, discarded] of snapshot) {
            // A concurrent edit replaces the record object. Preserve it and let
            // its save (which waits on this operation) persist after deletion.
            if (next[path] === discarded) delete next[path];
          }
          return { drafts: next };
        });
      })();

      activeDiscards.set(key, operation);
      try {
        await operation;
      } finally {
        if (activeDiscards.get(key) === operation) activeDiscards.delete(key);
      }
    },

    markUploadSynced: async (ctx, mediaPaths) => {
      void ctx;
      if (!mediaPaths.length) return;
      const next = { ...get().drafts };
      const changed: DraftRecord[] = [];
      for (const path of mediaPaths) {
        const rec = next[path];
        if (!rec?.dirty) continue;
        // Drop any debounced write for this record — we rewrite it clean now.
        const timer = pending.get(rec.id);
        if (timer) {
          clearTimeout(timer);
          pending.delete(rec.id);
        }
        const clean = { ...rec, dirty: false };
        next[path] = clean;
        changed.push(clean);
      }
      if (changed.length) {
        set({ drafts: next });
        await db.drafts.bulkPut(changed);
      }
    },
  };
});

/** Count of dirty drafts in the loaded upload — drives the "N unsaved" readout. */
export function dirtyCount(drafts: Record<string, DraftRecord>): number {
  let n = 0;
  for (const id in drafts) if (drafts[id].dirty) n++;
  return n;
}
