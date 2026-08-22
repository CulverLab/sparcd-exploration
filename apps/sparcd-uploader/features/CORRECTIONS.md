# Corrections — what running the feature files against the app changed

The nine feature files in this directory were written by reading `src/`. This
file records everything that changed once they were made executable against the
running app (`pnpm test:bdd`), plus the scenarios that could not be automated.

Nothing under `src/` or `test/` was modified. Where the app and the file
disagreed, the file was corrected.

## Gherkin corrections

### 1. Publishing now works after Inspect has already finished

*File:* `upload-run.feature` (Background comment) and the shared batch helpers
used by publish-reaching scenarios.

**Previously:** a real upload transferred every file, but a batch that finished
Inspect *before* Start was pressed could sit in "uploading" forever and never
write metadata. The suite worked around that by adding one deliberately slow
160 MiB MP4 to every publish-reaching batch, then starting the run while that
file was still being examined.

**Now:** PR #26 fixed the app bug in `Upload.tsx` by closing the upload queue
when a fully inspected batch starts. A normal publish-reaching scenario uses
`publishableBatch()`: three small JPEGs plus one small MP4 with real metadata.
The 160 MiB `slowVideo()` fixture is reserved for scenarios whose claim is
specifically about background examination continuing while the user works or
while upload starts.

Scenarios that need to observe or interrupt an in-flight upload no longer rely
on the slow Inspect race. They use the in-process S3 mock instead: either
`putDelayMs` for short visible latency, or a mock hold that records one media
PUT and withholds the S3 response until the scenario has cancelled/asserted the
running state. That keeps the run partial or observable for a deterministic
reason and keeps the ordinary publish path small enough for CI.

### 2. "Select a target collection first" is unreachable

*File:* `assign-collection-and-deployment.feature` — scenario renamed to
"A target collection is always in force, and one is chosen automatically".

**Claimed:** the Continue gate blocks until a target collection is chosen.

**Actually:** `Assign.tsx` pre-selects the first readable collection and offers
no way to clear it, and when no collection is readable the deployment picker is
never rendered — so the gate always stops at the deployment message first. The
"Select a target collection first" title in the code cannot be produced.

### 3. The collection list does not show identifiers

*File:* `assign-collection-and-deployment.feature` — "The collections offered
are the ones the connection can actually read".

**Claimed:** each collection is shown with its name, organization or contact,
*and its identifier*.

**Actually:** each row shows name, `organization · contact`, and description.
The uuid appears once, underneath the picker, for the selected collection only.

### 4. A real upload logs no successful blob writes

*File:* `upload-run.feature` — "Progress is reported per file and for the batch
as a whole".

**Claimed:** the activity log records each write, retry and warning.

**Actually:** `upload.ts` logs on retry, on warning, on skip, and on each of the
five metadata writes. A blob that uploads and verifies first time logs nothing.
The per-object `PUT …` listing exists only in a dry run.

### 5. A typed uploader identity never survives to meet the guard

*File:* `connect-and-session.feature` — "The uploader identity starts from the
connected access key".

**Claimed:** an identity the user has already typed is never overwritten by
connecting.

**Actually:** `connect()` does keep an existing `uploaderUser` (`s.uploaderUser
|| config.accessKey`), but both disconnect paths blank it first — the header
Disconnect sets it to `''`, and the Settings disconnect wipes local state and
reloads. What the guard actually protects is the identity seeded on a fresh page
load from the *previous connection's remembered access key*, which is what the
corrected scenario now asserts.

### 6. A verification mismatch dies on the append-only guard, not on retries

*File:* `upload-run.feature` — trailing comment on "Each stored object is
verified after it is written".

A size/digest mismatch after a write is treated as a transient failure and
retried. The retry re-PUTs a key the first attempt already stored, so
`IfNoneMatch: "*"` rejects it with a 412 and the run stops there instead of
working through its five attempts. The file is never counted as done either way,
which is what the scenario asserts.

## Scenarios that could not be automated

### `choose-folder.feature` — "Picking a folder through the dialog allows a later resume without re-picking" → `@manual`

The claim is specifically about a *durable* `FileSystemDirectoryHandle` surviving
into IndexedDB and being re-granted on a later resume. A stubbed
`showDirectoryPicker` cannot demonstrate it: the object it returns is not the
browser-owned handle, so what IndexedDB stores back is inert data with no
`queryPermission`/`values` to call. Only a real OS folder dialog on Chromium can
exercise this, which is not automatable headlessly.

That is the only `@manual` scenario. Everything else runs, including the rest of
the resume flow — `showDirectoryPicker` is stubbed to hand back the same folder
the test dropped, so the desktop reselect path is exercised end to end.

## Incidental findings (no scenario claims them, worth recording)

### Resume-by-reselect cannot re-attach anything without the File System Access API

`History.tsx` handles the `<input webkitdirectory>` fallback as:

```jsx
onChange={(e) => { void onReselectInput(e.target.files); e.target.value = ''; }}
```

`onReselectInput` is async, and `e.target.value = ''` runs before it gets past
its first `await`. Clearing the value empties the *live* `FileList` the handler
is still holding, so `scanFileList` sees zero files and every recorded file comes
back as "not in the selected folder". The resume then refuses to start. This is
the only reselect path on browsers without `showDirectoryPicker` (Firefox,
Safari), so resume is broken there. Found while automating
`resume-and-retry.feature`; the scenarios now drive the picker path instead.

### The session ledger can clobber per-file state it just recorded

`runStreamingUpload` fires `openSession(batch, initialRecords)` without awaiting
it, then immediately starts transferring. `openSession` deletes and re-writes
every file row for the session, so a file that finishes (or fails) before that
transaction lands has its `done`/`failed` state overwritten with `pending`.
History then under-reports how much of an interrupted upload actually completed,
and a later resume re-uploads objects it could have skipped (it recovers, via the
412-then-verify path, but does the transfer again). The steps here give storage a
150 ms write delay so the ledger settles first and the counts are deterministic.

### The Settings disconnect also forgets the connection itself

"Ready for the next person" is stronger than the file implied: `disconnect()`
clears the persisted non-secret connection too, so the next person sees an
entirely empty Connect form — no endpoint, no access key. Asserted as such.

## How the app is driven

- **Storage** is an in-memory, path-style S3 served through `page.route`
  (`features/steps/s3mock.ts`), including multipart uploads. The app signs every
  request, so the `authorization` header is what separates an S3 call from a Vite
  asset request on the same origin; anything unsigned falls through.
- **Folders** are dropped with a synthetic `DataTransfer` of
  `webkitGetAsEntry()` entries, and the same tree is exposed through a stubbed
  `showDirectoryPicker`.
- **Media** is a real 64×48 EXIF JPEG (inlined as base64) plus a hand-built
  fast-start MP4, varied per scenario — so EXIF parsing, hashing, decoding and
  thumbnailing all do real work.
- The dev server runs with `VITE_SPARCD_S3_ENDPOINT=''` so the dev-only endpoint
  prefill does not mask the "remembered from the previous connection" prefill.

Two files outside `features/` changed, neither of them app behaviour:
`package.json` gains a `test:bdd` script, and `vite.config.ts` gains a
`test.exclude` for `features/.features-gen/**` so Vitest does not try to collect
the generated Playwright specs (they match its default `*.spec.js` glob). The
unit suite is unchanged: 112 tests, all passing.
