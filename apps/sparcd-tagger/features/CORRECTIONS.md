# Corrections found by making the as-built features executable

DRAFT — for review alongside `NOTES.md`. The eleven `.feature` files were
written by reading `apps/sparcd-tagger/src`. Running them against the real app
(Playwright + playwright-bdd, all storage traffic mocked — see
`features/steps/support/s3mock.ts`) proved 121 of 122 scenarios and turned up
five places where the file claimed something the app does not do, plus one
scenario that cannot be driven headlessly at all.

Nothing under `src/` was changed. Every entry below is a change to the
`.feature` file, not to the app.

## How to re-run

```sh
pnpm --filter sparcd-tagger test:bdd     # bddgen && playwright test
```

The suite starts its own Vite dev server on port 5312, points the app's S3
endpoint at that same origin, and answers ListBuckets / ListObjectsV2 / GET /
HEAD / PUT from an in-process mock seeded with a two-collection fixture
(`features/steps/support/data.ts`). No real bucket is touched.

---

## 1. Fullscreen: a backdrop click does not dismiss it

**File** `H1-examine-images-closely.feature` — *Fullscreen gives a larger canvas
and a deeper zoom*

- **Claimed:** "pressing Escape, using the close control, **or clicking outside
  the image** returns to the workspace".
- **Actual:** Escape and the close control dismiss it. A click on the dimmed
  area does not. `Lightbox` puts its dismiss handler on the pane wrapper and
  guards it with `e.target === e.currentTarget`, but `TransformComponent` is
  rendered with `!w-full !h-full`, so the zoom surface covers the entire pane
  and every backdrop click lands on it instead.
- **Corrected to:** "pressing Escape or using the close control returns to the
  workspace". The step definition additionally asserts that a backdrop click
  leaves it open, so the deviation stays pinned.
- **Worth a decision:** the species loupe (`SpeciesLoupe`) *does* close on a
  backdrop click. Two overlays in the same tool behave differently.

## 2. "Untagged" is a list-view label only

**File** `H3-review-existing-identifications.feature` — *Existing identifications
are shown on the images that carry them*

- **Claimed:** "an image with no species is labelled `untagged`".
- **Actual:** only `ListCell` writes the word "untagged". A `GridCell` with no
  species shows its **file name** in that slot instead. The grid is the default
  Overview, so most users never see the word.
- **Corrected to:** "...is labelled `untagged` **in the list view**", with a
  comment recording the grid behaviour; the step checks both.

## 3. The species panel's disabled state is unreachable

**File** `H2-assign-species-to-images.feature` — was *The species panel is inert
when no image is in view*

- **Claimed:** "Given no image is focused / Then the species rows are disabled /
  And they explain that an image must be focused first".
- **Actual:** that state cannot be reached. `SpeciesPanel`'s `disabled` prop is
  `!current`, and `current = list[focus]`; focus defaults to 0 and every path
  that moves it clamps into range (`focusMove`, `gotoImage`, `jumpToMatch`, the
  sort re-map). An upload whose `media.csv` yields no taggable rows returns
  early with "This upload has no taggable images." and never renders the panel
  at all. So `disabled` is dead UI.
- **Corrected to:** a new scenario, *An upload with nothing to tag offers no
  species panel at all*, which is the reachable behaviour and is now tested
  against an empty `media.csv`.

## 4. A refused sync still leaves a snapshot behind

**File** `sync-identifications-to-the-collection.feature` — *A store that cannot
guarantee safe replacement is refused*

- **Claimed:** "Then the sync is refused with an explanation / And **nothing is
  written**".
- **Actual:** `commitWrites` writes the whole pre-change snapshot set (three
  bodies + `manifest.json`, via `writeImmutable`/`IfNoneMatch`) *before* it
  attempts the first `replaceIfUnchanged`. A backend that answers 501 to the
  conditional replace therefore leaves a complete, recoverable snapshot in the
  bucket. The canonical files are untouched, which is the guarantee that
  matters — but "nothing is written" was wrong.
- **Corrected to:** "And the stored files are left untouched", with the step
  asserting both that the canonical bytes are unchanged *and* that a snapshot
  was written.

## 5. A restore does not conflict on a change made after its preview

**File** `restore-a-previous-snapshot.feature` — was *A restore never overwrites
a change it did not see*

- **Claimed:** "Given the stored files changed since the restore was previewed /
  When the restore is run / Then a conflict is reported and nothing is written".
- **Actual:** the restore completes and overwrites the other change. Unlike
  `runSync`, `runRestore` has **no grounded-base check**: it calls
  `io.loadCanonical()` at run time and takes its `IfMatch` against that fresh
  read. A change that lands between the preview and the run is simply re-read
  and replaced. Only a change arriving *during* the write sequence is refused.
  (The overwritten state is captured in the pre-restore snapshot, so it is
  recoverable — but it is not refused.)
- **Corrected to:** *A restore writes against the files it re-reads, not the
  previewed ones*, asserting the overwrite, that every replacement still carries
  an `IfMatch`, and that the third party's bytes survive in the new snapshot.
- **Worth a decision:** should a restore ground on the state the user previewed,
  the way a sync grounds on the state the workspace loaded? Today the preview's
  file list can be stale by the time the button is pressed.

---

## Not automatable

One scenario is tagged `@manual`:

- `H1-examine-images-closely.feature` — *A thumbnail that cannot be fetched is
  reported rather than left blank*. The "download link" is a presigned URL
  produced by local SigV4 signing (`presignedGet`); it never touches the
  network, so no route mock, offline mode or seeded storage can make it fail.
  `Thumb`'s `isError` branch is only reachable by corrupting the in-memory
  config, which no user action does. Verify by code reading, or by temporarily
  forcing `presignImage` to throw.

## Things the run confirmed that the reading only inferred

- The interrupted-sync resume path (`NOTES.md` listed it as "not reachable by
  normal use") **is** exercisable: seeding a `syncJournals` row in IndexedDB
  makes the next sync finish the outstanding writes, skip the already-written
  file, and take no fresh snapshot.
- The unsupported-backend path is exercisable by answering 501 to a conditional
  `PUT`.
- The cross-tab adopt/disconnect relay works between two real tabs of one
  browser context.
- All seven sync-state pills (local-only, unsynced, syncing, synced, conflict,
  dry-run, error) are reachable and are driven in one scenario.

## Behaviour that is correct but timing-sensitive

Two claims are true but only settle asynchronously, and a naive assertion reads
the wrong value:

- **Re-sorting keeps focus and selection on the same images.** The re-map runs
  in an effect *after* the re-ordered strip commits, so for one frame the
  selection still points at the old positions.
- **The Browse "Sync" column.** `useUploadDraftStates` has a 5s stale time, so a
  row can read `local-only` for up to five seconds after an edit, and only
  refreshes when Browse is re-entered. The step polls by re-entering Browse.

Neither is a defect, but both are worth knowing before someone reads a stale
pill as a bug.
