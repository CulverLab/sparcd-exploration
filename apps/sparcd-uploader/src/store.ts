import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { S3Config } from '@sparcd/types';
import {
  loadPersistedConnection,
  saveSharedConnection,
  clearSharedConnection,
  subscribeSharedConnection,
} from '@sparcd/auth-ui';
import type { ScannedFile } from './lib/scanFiles';
import type { ProcessResponse } from './lib/processPool';
import type { FileAccessMode } from './lib/db';
import { validateBatch, validateFile, type FileValidation } from './lib/validation';
import { clearClientCache } from './lib/s3';
import { localTimeZone, type NaiveDateTime } from './lib/exifTime';
import type { ElevationUnit } from './lib/coords';

export type { ElevationUnit };
export type Section = 'new' | 'history' | 'settings';
export type WizardStep = 'drop' | 'inspect' | 'assign' | 'upload';
export type Theme = 'light' | 'dark';
export type ProcessState = 'queued' | 'processing' | 'ready' | 'error';

/** A scanned file plus the results of P1 worker processing. */
export type FileEntry = ScannedFile & {
  processState: ProcessState;
  sha256?: string;
  exifNaive?: NaiveDateTime; // naive wall-clock components, no zone
  manualNaive?: NaiveDateTime; // user-entered wall-clock for files with no EXIF/container time
  exifCamera?: string;
  gps?: { lat: number; lon: number };
  width?: number;
  height?: number;
  thumbnail?: Blob;
  mimeType?: string; // worker-authoritative media type
  processError?: string;
};

type UploaderState = {
  s3Config: S3Config | null;
  connectionId: number; // increments on connect/disconnect to scope client-side caches
  section: Section;
  theme: Theme;
  elevationUnit: ElevationUnit; // display pref for location elevation (persisted)
  step: WizardStep;
  files: FileEntry[];
  validations: Record<string, FileValidation>;
  scanning: boolean;
  processing: boolean;
  batchToken: number; // bumps each new batch; identifies a processing run
  // A durable folder handle when the browser granted one (Chromium); drives the
  // resume access mode so a closed tab can re-read the same bytes.
  dirHandle: FileSystemDirectoryHandle | null;
  fileAccessMode: FileAccessMode;
  uploaderUser: string; // free-text identity, normalized into a slug for keys
  selectedLocationKey: string | null; // chosen deployment location key (Assign)
  selectedBucket: string | null; // selected collection key `${bucket}::${uuid}` (Assign)
  uploadDescription: string; // free-text description for UploadMeta
  uploadTimeZone: string; // IANA zone EXIF naive times are interpreted in; default = browser zone
  dryRun: boolean; // on by default; logs PUTs and writes nothing
  uploadConcurrency: number; // parallel blob lanes, 4–16

  connect: (config: S3Config) => void;
  disconnect: () => void;
  setSection: (section: Section) => void;
  toggleTheme: () => void;
  setElevationUnit: (unit: ElevationUnit) => void;
  setStep: (step: WizardStep) => void;
  setScanning: (scanning: boolean) => void;
  setProcessing: (processing: boolean) => void;
  setFiles: (files: ScannedFile[], dirHandle?: FileSystemDirectoryHandle | null) => void;
  applyProgress: (started: string[], results: ProcessResponse[]) => void;
  revalidate: () => void;
  setThumbnail: (id: string, thumbnail: Blob) => void;
  removeFile: (id: string) => void;
  setManualNaive: (id: string, naive: NaiveDateTime | null) => void;
  resetBatch: () => void;
  setUploaderUser: (value: string) => void;
  setSelectedLocationKey: (key: string | null) => void;
  setSelectedBucket: (bucket: string | null) => void;
  setUploadDescription: (value: string) => void;
  setUploadTimeZone: (value: string) => void;
  setDryRun: (value: boolean) => void;
  setUploadConcurrency: (value: number) => void;
  nextBatch: () => void;
};

const toEntry = (f: ScannedFile): FileEntry => ({ ...f, processState: 'queued' });

// id -> index cache for `files`, so the high-frequency per-flush updates
// (applyProgress/setThumbnail, called every ~200ms and once per finished video
// poster during Inspect) can touch just the entries that changed instead of
// walking/rebuilding the whole array. Valid as long as the SET and ORDER of
// files hasn't changed — every call site that adds/removes/reorders files
// invalidates it; applyProgress/setThumbnail only overwrite existing slots, so
// they never need to.
let fileIndexById: Map<string, number> | null = null;

function invalidateFileIndex(): void {
  fileIndexById = null;
}

function getFileIndex(files: FileEntry[]): Map<string, number> {
  if (!fileIndexById) {
    fileIndexById = new Map();
    files.forEach((f, i) => fileIndexById!.set(f.id, i));
  }
  return fileIndexById;
}

// Read once at module init for the initial uploaderUser default below (the
// access key is non-secret, so it's safe to have persisted).
const initialPersisted = loadPersistedConnection();

export const useStore = create<UploaderState>()(
  // The secret key is NEVER persisted to disk — only the non-secret fields
  // (endpoint/access key/region/etc.) live in localStorage, purely to pre-fill
  // the Connect form on reload. s3Config itself always starts null here; the
  // user re-enters the secret every time, UNLESS another tab in this browser
  // session is already connected, in which case `subscribeSharedConnection`'s
  // live (never-persisted) cross-tab relay picks it up within a message
  // round-trip of mount. Zustand's own persist here covers only cheap UI
  // prefs (theme, elevationUnit); the in-flight batch (files, handles,
  // validations) is excluded too.
  persist(
    (set) => ({
      s3Config: null,
      connectionId: 0,
      section: 'new',
      theme: 'light',
      elevationUnit: 'meters',
      step: 'drop',
      files: [],
      validations: {},
      scanning: false,
      processing: false,
      batchToken: 0,
      dirHandle: null,
      fileAccessMode: 'reselect-required',
      // Defaults to the connected access key (the closest thing to a "login
      // name" this app has) — but only ever as a fill-in for blank; a value the
      // user typed or already had is never overwritten.
      uploaderUser: initialPersisted?.accessKey ?? '',
      selectedLocationKey: null,
      selectedBucket: null,
      uploadDescription: '',
      uploadTimeZone: localTimeZone(),
      dryRun: true,
      uploadConcurrency: 8,

      connect: (config) => {
        clearClientCache();
        saveSharedConnection(config);
        set((s) => ({
          s3Config: config,
          connectionId: s.connectionId + 1,
          selectedLocationKey: null,
          selectedBucket: null,
          uploaderUser: s.uploaderUser || config.accessKey,
        }));
      },
      disconnect: () => {
        clearClientCache();
        clearSharedConnection();
        invalidateFileIndex();
        set((s) => ({
          s3Config: null,
          connectionId: s.connectionId + 1,
          section: 'new',
          step: 'drop',
          files: [],
          validations: {},
          dirHandle: null,
          fileAccessMode: 'reselect-required',
          selectedLocationKey: null,
          selectedBucket: null,
          uploaderUser: '',
          uploadTimeZone: localTimeZone(),
        }));
      },
      setSection: (section) => set({ section }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      setElevationUnit: (elevationUnit) => set({ elevationUnit }),
      setStep: (step) => set({ step }),
      setScanning: (scanning) => set({ scanning }),
      setProcessing: (processing) => set({ processing }),

      // De-dupe by relPath; a re-scan replaces the batch wholesale and bumps the
      // token so the processing controller starts a fresh run.
      setFiles: (scanned, dirHandle = null) => {
        const seen = new Set<string>();
        const entries = scanned
          .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
          .map(toEntry);
        invalidateFileIndex();
        set((s) => ({
          files: entries,
          validations: validateBatch(entries),
          step: entries.length > 0 ? 'inspect' : 'drop',
          batchToken: s.batchToken + 1,
          dirHandle,
          fileAccessMode: dirHandle ? 'persistent-handle' : 'reselect-required',
        }));
      },

      applyProgress: (started, results) => {
        if (started.length === 0 && results.length === 0) return;
        set((s) => {
          const index = getFileIndex(s.files);
          const files = s.files.slice();
          const validationUpdates: Record<string, FileValidation> = {};

          // Started-but-no-result-yet files just flip to "processing"; a file
          // that also has a result this same tick gets overwritten below with
          // its final state, so processing order here doesn't matter.
          for (const id of started) {
            const i = index.get(id);
            if (i === undefined) continue;
            const f = files[i];
            if (f.processState === 'queued') files[i] = { ...f, processState: 'processing' as const };
          }

          for (const result of results) {
            const i = index.get(result.id);
            if (i === undefined) continue;
            const f = files[i];
            const next: FileEntry = result.error
              ? { ...f, processState: 'error' as const, processError: result.error }
              : {
                  ...f,
                  processState: 'ready' as const,
                  sha256: result.sha256,
                  exifNaive: result.exifNaive,
                  exifCamera: result.exifCamera,
                  gps: result.gps,
                  width: result.width,
                  height: result.height,
                  thumbnail: result.thumbnail,
                  mimeType: result.mimeType,
                };
            files[i] = next;
            validationUpdates[result.id] = validateFile(next);
          }

          return { files, validations: { ...s.validations, ...validationUpdates } };
        });
      },

      revalidate: () => set((s) => ({ validations: validateBatch(s.files) })),

      // Attach a best-effort poster after the fact (video frames are captured on
      // the main thread, post-worker). No validation re-run: a poster never
      // changes a verdict.
      setThumbnail: (id, thumbnail) =>
        set((s) => {
          const i = getFileIndex(s.files).get(id);
          if (i === undefined) return {};
          const files = s.files.slice();
          files[i] = { ...files[i], thumbnail };
          return { files };
        }),

      removeFile: (id) =>
        set((s) => {
          const files = s.files.filter((f) => f.id !== id);
          invalidateFileIndex();
          return { files, validations: validateBatch(files) };
        }),

      // Manual capture time for a file with no EXIF/container time. Stored as raw
      // naive components (like exifNaive) so it's interpreted in the upload zone
      // at bundle build; null clears it and re-surfaces the file as unset.
      setManualNaive: (id, naive) =>
        set((s) => {
          const files = s.files.map((f) =>
            f.id === id ? { ...f, manualNaive: naive ?? undefined } : f,
          );
          return { files, validations: validateBatch(files) };
        }),

      resetBatch: () => {
        invalidateFileIndex();
        set((s) => ({
          files: [],
          validations: {},
          step: 'drop',
          batchToken: s.batchToken + 1,
          dirHandle: null,
          fileAccessMode: 'reselect-required',
        }));
      },

      // Stored raw; sanitizeUploaderUser derives the key-safe slug at point of use.
      setUploaderUser: (value) => set({ uploaderUser: value }),
      setSelectedLocationKey: (key) => set({ selectedLocationKey: key }),
      setSelectedBucket: (bucket) => set({ selectedBucket: bucket }),
      setUploadDescription: (value) => set({ uploadDescription: value }),
      setUploadTimeZone: (value) => set({ uploadTimeZone: value }),
      setDryRun: (value) => set({ dryRun: value }),
      setUploadConcurrency: (value) => set({ uploadConcurrency: value }),

      // Start a fresh batch after a completed upload, keeping the deployment,
      // uploader, target collection, and description so a researcher can chain
      // batches for the same site without re-entering everything.
      nextBatch: () => {
        invalidateFileIndex();
        set((s) => ({
          files: [],
          validations: {},
          step: 'drop',
          batchToken: s.batchToken + 1,
          dirHandle: null,
          fileAccessMode: 'reselect-required',
        }));
      },
    }),
    {
      name: 'sparcd-uploader-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ theme: s.theme, elevationUnit: s.elevationUnit }),
    },
  ),
);

// React to login/logout in OTHER tabs open right now, live (never persisted —
// see session.ts). Mirror the new connection into this store and bump
// connectionId so client-side caches scoped to a connection are invalidated.
// Also answers a sibling tab's own request with our current s3Config, if any.
subscribeSharedConnection((cfg) => {
  clearClientCache();
  if (!cfg) invalidateFileIndex();
  useStore.setState((s) => ({
    s3Config: cfg,
    connectionId: s.connectionId + 1,
    ...(cfg
      ? { uploaderUser: s.uploaderUser || cfg.accessKey }
      : {
          section: 'new' as const,
          step: 'drop' as const,
          files: [],
          validations: {},
          dirHandle: null,
          fileAccessMode: 'reselect-required' as const,
          selectedLocationKey: null,
          selectedBucket: null,
          uploaderUser: '',
        }),
  }));
}, () => useStore.getState().s3Config);
