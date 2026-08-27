# sparcd-uploader — implementation plan

> **Note:** this is the plan as written, with per-phase implementation
> reports appended; where they disagree, the reports and the code win.
> Known divergences from the plan text: MP4 video support shipped (the plan
> scopes it out); published uploads can be edited in place via `s3-safe`'s
> ETag-gated `replaceIfUnchanged` (the plan says "never modifies existing
> uploads"); the tagger replaces `observations.csv` canonically rather than
> writing per-user sidecars; and shadcn/ui, `@aws-sdk/lib-storage`, and
> `p-limit` were dropped during implementation. The
> [README](./README.md) describes what actually ships.

A static, browser-based upload tool for SPARC'd camera-trap image batches.
Takes a local folder of JPEGs, extracts EXIF, lets the user assign a
deployment (camera location), generates the Camtrap-DP CSV trio plus
`UploadMeta.json`, uploads image blobs to S3, and publishes the completed
bundle metadata under a fresh upload prefix in an S3-compatible bucket.

Sits alongside SPARC'd; produces upload bundles whose layout matches the
existing Java and Next.js readers under
`Collections/<uuid>/Uploads/<timestamp>_<user>/` once the bundle is
complete. Tagging is deferred to
[sparcd-tagger](../sparcd-tagger/plan.md) — initial uploads always carry an
empty `observations.csv` so downstream tools have a stable canonical base
file to hash.

## Design references

The Claude Design bundle is the source of truth for layout, copy, and
component behavior; this plan is the source of truth for data, safety, and
persistence contracts. Read both side-by-side.

- **Latest Claude Design bundle** (Uploader, post rev-4 — simplified login):
  <https://api.anthropic.com/v1/design/h/UIxTk3s58j290-DB649lmw?open_file=SPARCd+Uploader.html>
  Each iteration produces a new URL; update this entry when a newer build
  supersedes it. The Connection screen is **shared** with the Tagger; both
  bundles include the same Connection component.
- [`../../docs/design-system-field-notebook.md`](../../docs/design-system-field-notebook.md)
  — locked Field Notebook v2 tokens, typography, controls, and the walnut
  dark variant.

## Goal

A researcher can drag a folder of camera-trap images into the browser,
confirm the deployment and EXIF timestamps look right, and upload a
complete Camtrap-DP-shaped bundle to S3 — without a desktop install, with
visible per-file progress, and with resume-on-failure so a flaky connection
doesn't lose work. After a closed tab, the app resumes automatically when
the browser grants persistent file handles; otherwise it asks the user to
reselect the same folder and reconciles by relative path, size, and hash.

## Static BYO-S3 security contract

This uploader is a **static browser app**. It has no backend service, no
trusted server session, and no server-side environment variables available at
runtime. Any security review must treat the browser bundle as untrusted client
code.

**Decision.** Users bring their own S3-compatible endpoint, credentials,
settings bucket, and collection bucket. Official SPARC'd deployments use the
same model: official credentials are scoped by IAM/provider policy and CORS,
not by bucket names compiled into the app.

**Enforceable controls.**

- **IAM / provider policy** limits which buckets, prefixes, and S3 actions the
  supplied credentials can use.
- **Bucket CORS** limits which hosted app origins can make browser S3 calls.
- **`@sparcd/s3-safe`** is the only S3 client boundary in the app. It exposes
  read methods and immutable append-only writers. It exposes no delete, copy,
  or overwrite API.
- **Upload protocol controls** include dry-run-by-default, conditional writes,
  portable `HEAD` size/hash verification, upload ordering, and
  `UploadComplete.json`.

**Non-controls.**

- Build-time `VITE_*` bucket allowlists are not used for authorization. They
  would not be enforceable in a static app and would break BYO-S3 users.
- Client-side bucket discovery is not authorization. It only finds buckets that
  the supplied credentials and CORS policy already expose.
- UI warnings and dry-run defaults guide operators, but they do not replace IAM
  policy or CORS.

## Stack

Same shape as the tagger; additions reflect the upload-specific work.

- **Vite + React 18 + TypeScript** — static SPA, same build target
- **Tailwind + shadcn/ui** — UI primitives
- **TanStack Query** — S3 fetch cache (deployment/location reads)
- **TanStack Virtual** — virtualized file list for big batches
- **Zustand** — upload-session state
- **Dexie.js** — IndexedDB for resumable upload state
- **`@aws-sdk/client-s3`** + **`@aws-sdk/lib-storage`** — `lib-storage`'s
  `Upload` class wraps the client and handles single-PUT vs multipart
  automatically per file; portable across MinIO / AWS S3 / Cloudflare R2.
- **`exifr`** — EXIF parsing (timestamps, camera model, optional GPS)
- **Web Workers + Streams API** — EXIF parsing, SHA-256 hashing, and the
  upload itself all happen off the main thread. Files stream through
  workers chunk-by-chunk rather than loading into memory, so a 5,000-file
  batch never spikes RAM (industry standard for browser bulk upload).
- **`p-limit`** — bounded concurrency for parallel uploads.

## Shared packages

Reuses everything the tagger established:

- **`@sparcd/s3-safe`** — same wrapper. The `writeImmutable` semantics
  (atomic `PutObject` with `IfNoneMatch: "*"`, no fallback) fit upload
  PUTs exactly: every object lands at a deterministic new key, so the
  conditional check prevents accidental collision with an in-flight or
  prior upload.
- **`@sparcd/camtrap`** — the reader becomes a writer-of-record here. The
  uploader builds `Deployment`, `Media`, and (empty) `Observation`
  collections in memory and serializes via the same round-trip-stable
  encoder the tagger reads.
- **`@sparcd/types`** — `Collection`, `Species`, `UserSession`, etc.
- **`@sparcd/auth-ui`** — the shared credentials/connection screen, the
  same component the tagger uses; parameterized only by the tool name in
  the chrome. Produces the `S3Config` consumed by `@sparcd/s3-safe`.

No new package introduced by this tool. If a third app later needs EXIF
parsing, lift `exifr`-driven extraction into a `@sparcd/exif` package at
that point — not now.

### Wrapper changes needed in `@sparcd/s3-safe`

Add one method that the uploader uses for every file:

- `writeImmutableStream(bucket, key, stream, {sha256, onProgress})` —
  wraps `@aws-sdk/lib-storage`'s `Upload` class. Configured with
  `leavePartsOnError: true` (see Multipart hygiene). Single-PUT under the
  multipart threshold (default 5 MB), multipart above it. The goal is the
  same `IfNoneMatch: "*"` precondition on both paths — applied at the
  single PUT, or at the `CompleteMultipartUpload` step for the multipart
  path — with no destructive fallback if the backend doesn't enforce it
  (throws `ConditionalPutUnsupported`).

  **Two things to prove before this method is allowed to claim the
  guarantee:**
  1. **`lib-storage` can attach `IfNoneMatch` to `CompleteMultipartUpload`.**
     The library may or may not expose a hook for that completion-step
     header at the `Upload` level. If it doesn't, options are: (a) drop
     down to manual `CreateMultipartUpload` / `UploadPart` /
     `CompleteMultipartUpload` orchestration inside `writeImmutableStream`
     to retain the conditional complete; or (b) defer multipart out of
     v0, ceiling files at the single-PUT size with a clear error. This is
     a P4 spike, not an implementation assumption.
  2. **Backend enforcement.** AWS supports conditional `PutObject`
     (Aug 2024) and conditional `CompleteMultipartUpload` separately;
     MinIO and R2 behavior with `lib-storage` + checksum headers needs
     proof. The wrapper's safety contract is "verified on the backends
     listed in `packages/s3-safe/README.md`," not a blanket promise.

The existing read methods + `writeImmutable` (small atomic objects like
`UploadComplete.json`) are unchanged.

## Architecture

### Data flow

```
Local folder ─drop─►  File list                                            ─┐
                          │                                                  │
                          ▼                                                  │
                  Web Worker pool                                            │
                   ├─ EXIF parse  (timestamps, model, GPS)                  │
                   └─ SHA-256 hash pass (streamed; digest cached per file)  │
                          │                                                  │
                          ▼                                                  │
Settings/locations.json ─►  Deployment picker  ─►  Bundle builder            │
                                                       │                     │
                                                       ▼                     │
                                            Camtrap-DP CSVs + completion    │
                                                       │                     │
                                                       ▼                     │
                                            Upload queue (p-limit, Dexie)   │
                                                       │                     │
                                                       ▼                     ▼
    writeImmutableStream() → uploadPrefix images, then writeImmutable() → uploadPrefix CSVs + manifest
```

### Layout

Four-step linear flow rather than a three-pane editor; the upload task is
naturally sequential.

1. **Drop** — drag-and-drop or "Choose folder" picker. Recursive scan.
2. **Inspect** — virtualized file list with thumbnail, filename, EXIF
   timestamp, dimensions, file size, hash, and validation state. Rows
   that fail validation surface inline reasons; bulk "drop invalid" or
   "fix manually" actions.
3. **Assign** — deployment picker (combobox over
   `Settings/locations.json`, path/shape validated in P2), uploader-user
   field, upload description,
   target collection (bucket). Preview the five metadata files
   (`UploadMeta.json`, `UploadComplete.json`, `deployments.csv`,
   `media.csv`, `observations.csv`) inline before commit.
4. **Upload** — progress per file + aggregate. Dry-run toggle on by
   default for the first session. After completion: summary, links, and
   a "Next batch" button that keeps the deployment and uploader fields.

### Login screen

The shared `@sparcd/auth-ui` connection screen — the same component the
tagger uses, parameterized only by the tool name in the chrome
("SPARC'd · Uploader"). **Three fields — endpoint, access key, secret
key** — with secure/region/path-style inferred from the endpoint (rare
overrides behind an "Advanced" disclosure); identity + dry-run default live
in Settings. Same `.env`-during-dev-only-non-secret-prefill rule. Both apps
consume it from day one; it is not duplicated per tool.

### Persistence — local

Dexie tracks every upload-session state needed for resume.

- **Dexie schema** v1:
  - `batches` table:
    `{ id (sessionId), targetBucket, uploadPrefix, blobPrefix,
    deploymentId, uploaderUser, description, startedAt, completedAt,
    totalFiles, totalBytes, fileAccessMode }`
    where `fileAccessMode` is `persistent-handle` when a durable
    `FileSystemDirectoryHandle` is stored, or `reselect-required` when the
    user must reselect the folder before resume.
  - `files` table:
    `{ id (sessionId+localPath), sessionId, localPath, fileName,
    relPathInBundle, sanitizedObjectName, size, sha256, exifTimestamp,
    exifCamera, state (pending|uploading|done|failed), remoteKey,
    remoteETag, attempt, lastError }`
  - `bundles` table:
    `{ sessionId, uploadMetaJson, deploymentsCsv, mediaCsv,
    observationsCsv, uploadCompleteJson, csvHashes }`
- **File access contract.** Browser paths are not durable capabilities. On
  Chromium, the app stores the chosen `FileSystemDirectoryHandle` in
  IndexedDB when permission is granted and revalidates permission before
  resuming. On browsers without durable handles, or when permission is
  revoked, resume shows a "Reselect folder" step and reconciles files by
  relative path, size, and SHA-256 before queuing remaining work. The app
  never claims it can upload bytes after a browser restart from `localPath`
  alone.
- **Resume contract.** On reopen, any `batches` row without
  `completedAt` is offered as a resumable session. Files in state
  `done` are skipped after a `statObject` size/hash metadata sanity check;
  `pending` / `failed` are queued once local file access is restored.
- **Schema versioning.** Same rule as the tagger: Dexie's versioning API
  with forward-carrying `upgrade` callbacks; no ad-hoc store mutations.
- **Discard local state.** Per-batch button to drop the session row plus
  its files. Never touches remote state.

### Persistence — S3 sync (i.e. the upload itself)

- **Prefix choice.** The new upload prefix is
  `Collections/<uuid>/Uploads/<ISO>_<uploaderUser>/`. Collision risk is
  near-zero with second-resolution timestamps. If any final-prefix
  metadata write returns 412, the uploader abandons that prefix, bumps the
  timestamp by one second, and retries with a fresh upload prefix.
  `UploadComplete.json` is the source of truth for whether a prefix is
  publishable.
- **Blob placement (revised in P3 — was "UploadBlobs staging").** Image bytes
  upload **under the upload prefix**, at
  `Collections/<uuid>/Uploads/<stamp>_<slug>/<relpath>`, and `media.csv`'s
  `media_path` points there. P3 verified the existing SPARC'd reader **lists
  objects under the upload prefix and ignores `media_path`** (it presigns the
  listed key), so the original `UploadBlobs/<sessionId>/<sha>.<ext>` staging —
  meant to avoid exposing a half-populated directory — would have made every
  image invisible to the existing app. The half-populated-directory concern is
  instead handled by ordering: image bytes and CSVs first, then
  `UploadMeta.json` last (upstream's completion marker), then our additive
  `UploadComplete.json`.
- **Upload mechanics (informed by industry patterns).** Big-company web
  uploaders (Google Drive, Dropbox, Uppy + Tus) converge on a small set of
  techniques; the S3-native equivalent (which we use since we have no Tus
  server) is:
  - **`@aws-sdk/lib-storage`'s `Upload`** per file. Small files PUT in one
    request; large files multipart automatically. Resume scope for v0:
    **completed file blobs are skipped, interrupted files restart from
    scratch.** `lib-storage`'s `Upload` manages multipart *within* a
    session, not across browser restarts; "mid-file multipart resume" is
    a separate feature that requires persisting `UploadId`, part size,
    completed-part ETags / checksums in Dexie, then recovering state via
    `ListMultipartUploads` + `ListParts`. Worth building if real
    researcher uploads routinely cross sessions on huge files — keep the
    hooks in Dexie but treat true mid-file resume as P5+/follow-on, not
    a v0 guarantee.
  - **Two-pass per file, both streamed in a Web Worker.**
    1. **Hash pass.** Stream the file chunk-by-chunk through SHA-256 to
       produce the digest.
    2. **Upload pass.** Stream the file chunk-by-chunk into `Upload`,
       attaching the precomputed SHA-256 as object metadata and (where
       supported) as the `x-amz-checksum-sha256` header.

    Two reads cost local disk I/O, but never RAM — memory stays flat
    regardless of batch size (thousands of files are fine). Pre-hashing
    is required by S3 semantics: object metadata and checksum headers
    must be known *before* the PUT or `CreateMultipartUpload` starts.
  - **Bounded concurrency, default 8.** Uppy/Tus default 20 but report 5–10
    as the practical sweet spot; AWS SDK examples lean 4–8. 8 is the
    "fast on modern endpoints, well-behaved on hotel Wi-Fi" balance.
    Adaptive based on observed throughput is a P5+ enhancement.
  - **Exponential backoff with jitter** on transient failures (network
    blips, 5xx). Same pattern as Uppy/Tus.
- **Why not OPFS staging by default?** OPFS (the browser's private
  filesystem) is great for *durable resume that survives losing the source
  folder*, but it doubles disk usage (every file is copied into the browser
  sandbox before upload) and adds a long "ingest" wait on drop. For the
  common camera-trap workflow — researcher uploads from an SD card or
  folder they keep around for the session — the `FileSystemDirectoryHandle`
  + reselect-folder model is lighter and faster. OPFS stays a future option
  if researcher workflows show frequent source-disappearance, but it's
  **explicitly not in v0** because it adds complexity without enough
  payoff to justify the volunteer-facing friction. Keep things simple.
- **Why not Tus / a resumable-session protocol?** Tus is excellent and is
  what Uppy uses, but it needs a Tus server in front. We deploy against
  raw S3-compatible storage with no extra service, so we use the S3-native
  equivalent (multipart with `lib-storage`) instead.
- **Order of operations** (revised in P3 — blobs now under the upload prefix).
  1. Stream image uploads under `uploadPrefix` (at
     `<uploadPrefix>/<relpath>`) in parallel via `writeImmutableStream` (which
     uses `lib-storage`'s `Upload` — single-PUT for small files, multipart for
     large; both conditional). Bounded concurrency via `p-limit` — **default 8,
     slider 4–16** (industry sweet spot per Uppy/Tus practice; 4 is too
     conservative for modern S3/R2 endpoints, 20+ saturates without gaining
     throughput). Exponential backoff with jitter on transient failures.
  2. Generate the final bundle metadata from successfully uploaded images.
  3. Write `deployments.csv`, `media.csv`, and the always-empty
     `observations.csv` under `uploadPrefix`.
  4. Write `UploadMeta.json` under `uploadPrefix` — this is **upstream
     SPARC'd's completion marker**, so it must land after the images and CSVs.
  5. Write `UploadComplete.json` last under `uploadPrefix`; this is the
     additional integrity sentinel for new SPARC'd tools (richer than
     `UploadMeta.json` — carries the per-file hash manifest).
- **Partial-publish rule.** S3 has no atomic directory publish, and this
  wrapper intentionally exposes no `copy` or overwrite APIs. Therefore P4
  may write final-prefix CSV/metadata files only in test buckets. Before
  production-bucket writes, every reader this project controls must ignore
  upload prefixes that lack `UploadComplete.json`, and existing Java/Next
  reader behavior must be verified or updated. The completed layout still
  matches the existing upload shape, but the visibility contract is
  sentinel-based for safety.
- **Final CSV timing.** The three CSVs are written after the blobs because
  they reference media paths from step 1, so deferring them lets us record
  actual sizes and `remoteETag` values in `media.csv` if the schema needs
  it.
- **Hash sanity.** SHA-256 is the app's integrity digest. For each blob
  PUT, send the SHA-256 as `x-amz-meta-sha256` object metadata and, where
  the backend supports it, also as the native `x-amz-checksum-sha256`
  header. **Verification path (portable, mandatory):** after upload,
  `HEAD` the object and confirm `Content-Length` matches the recorded
  size and `x-amz-meta-sha256` matches the recorded digest. This works on
  every S3-compatible backend without exception. **Stronger verification
  (optional, when supported):** AWS's `GetObjectAttributes` returns the
  native checksum if it was stored; MinIO and R2 support is uneven.
  The wrapper attempts `GetObjectAttributes` only on backends listed as
  supporting it in `packages/s3-safe/README.md`; everywhere else, the
  HEAD-metadata path is the contract. ETag is stored for diagnostics
  only; it is not treated as a portable content hash across S3-compatible
  backends.
- **Multipart hygiene (mandatory deployment requirement).** Multipart
  uploads that don't complete leave *billable orphan parts* — invisible
  objects until aborted. Two policy knobs handle this together:
  1. **`@aws-sdk/lib-storage` is configured with `leavePartsOnError: true`
     explicitly.** The library's default is to call
     `AbortMultipartUpload` on failure, which our IAM denies — relying on
     the default would produce confusing AccessDenied errors on every
     transient failure. Setting it explicitly to `true` matches the
     wrapper's "no destructive APIs" stance: orphan parts simply remain.
  2. **Every bucket the uploader writes to MUST have a lifecycle rule
     that aborts incomplete multipart uploads after N days** (recommend
     7). This is a deployment checklist item, not optional, and is the
     only mechanism cleaning orphan parts in v0.

  No narrowly-scoped wrapper abort method in v0 — the lifecycle rule is
  the contract, and the wrapper's "no destructive APIs" invariant stays
  whole. A future scoped abort (targeting only the uploader's own
  `UploadId`s) is noted as a deliberate exception that would need its
  own review.
- **No deletes, ever** (object level). A partial upload leaves orphan
  objects in the blob prefix or an incomplete final prefix; recovery is
  to re-run the same session (skips verified `done` files, completes the
  rest) or abandon and start a new prefix. Cleanup is an explicit future
  admin operation, not
  part of this tool.
- **The existing canonical upload tree stays read-only** in this tool —
  the uploader creates new prefixes, never modifies existing ones.

## Safety design

Higher bar than the tagger because every byte written is a canonical
data byte, not an append-only sidecar. Four layers, same redundancy
shape as the tagger:

1. **IAM policy** — separate access key whose policy permits, on the test
   buckets only (with prefix conditions where the backend supports them:
   `Collections/*/UploadBlobs/*` and `Collections/*/Uploads/*` for writes,
   `Settings/locations.json` for reads):
   - `s3:ListBucket`, `s3:GetObject`, `s3:PutObject` (read + simple write)
   - `s3:ListBucketMultipartUploads`, `s3:ListMultipartUploadParts` (so
     `lib-storage` can complete in-flight multipart uploads and so the
     P5+ resume path can discover them)
   - `s3:GetObjectAttributes` (optional — used for the stronger native
     checksum verification on backends that support it; the portable
     mandatory verification path uses `HEAD` + `x-amz-meta-sha256` and
     does not require this permission)
   - `s3:AbortMultipartUpload` — **only** if/when we implement the
     narrowly-scoped wrapper abort method (see Multipart hygiene). Until
     then this stays *out* of the IAM policy and orphan parts are
     handled by the bucket lifecycle rule.
   **No `s3:DeleteObject`** at the policy level, ever.

   **CORS** — the bucket CORS policy must allow the static app origin to
   call: `GET`, `HEAD`, `PUT`, `POST` only — **no `DELETE`**, matching
   `leavePartsOnError: true` + no IAM abort. Plus expose `ETag` and
   `x-amz-checksum-*` response headers, and accept the request headers
   `Content-Type`, `Content-MD5`, `If-None-Match`, `x-amz-checksum-*`,
   and the `x-amz-meta-*` keys we write. **P4 includes an explicit
   multipart-write CORS preflight** (separate from P2's read CORS
   preflight) before the first multipart upload is attempted.
2. **`@sparcd/s3-safe` wrapper** — same single boundary. Same lint rule.
3. **Runtime permissions, not build-time bucket gates** — this is a static
   BYO-S3 app, so bucket names are never compiled into the bundle as a
   security boundary. The connected credentials' IAM policy and bucket CORS
   decide what the browser can read or write. The app discovers readable
   settings/collection buckets by probing for SPARC'd marker objects, keeps
   dry-run on by default, and uses only the append-only wrapper APIs.
4. **Completion sentinel** — `UploadComplete.json` is the final
   coordinating object. If two researchers race for the same timestamp,
   any 412 on a final-prefix metadata object makes the loser abandon that
   prefix, re-stamp, and retry on a fresh prefix.

Plus a **dry-run toggle** on the upload action, on by default for the
first session. Dry-run logs every PUT the run would issue (bucket, key,
size, hash) and writes nothing.

## Validation rules

Per file, before the file can be queued:

- File type is JPEG. Other types are rejected in v0 (see Out of scope).
- **No app-level hard file-size limit** for normal camera-trap JPEGs:
  `Upload` switches to multipart automatically above 5 MB and the S3
  multipart ceiling (~5 TB) is far above any realistic camera-trap file.
  Practical limits are runtime, not policy, and the inspect step surfaces
  them as live validation rather than rejecting at queue time:
  - **Browser/OS** — single-tab heap, available disk for the two-pass
    hash, OPFS / IndexedDB quotas.
  - **Network** — per-file expected duration at observed throughput; very
    large files on a slow link warn the user up front.
  - **Backend** — endpoint-specific per-object limits (rarely binding).

  A soft warning fires above 100 MiB ("unusual for camera-trap"), but the
  upload is allowed.
- EXIF parses successfully; `DateTimeOriginal` (or fallback) is present
  and yields a parseable timestamp. Files without timestamps go into a
  "needs attention" bucket with a manual-entry affordance.
- File is unique within the session (SHA-256 dedup). Duplicates show as
  warnings, not errors — researcher can choose to keep or drop.

Per batch, before upload can start:

- A deployment is selected.
- All files in the batch are valid (or explicitly accepted as
  warnings).
- `uploaderUser` is non-empty and normalized to a safe slug:
  lowercase ASCII letters, digits, `_`, and `-`; no slashes, whitespace,
  control characters, or path traversal-looking segments.
- Each bundle-relative filename is normalized before it becomes an object
  key: Unicode normalized, path separators collapsed to `/`, `.` / `..`
  segments rejected, control characters removed, and collisions resolved
  deterministically with a short hash suffix.

## Camtrap-DP CSV generation

`deployments.csv` — one row, sourced from the chosen deployment in
`Settings/locations.json`. `deployment_id` is
`<collection-uuid>:<location-id>` to match the existing convention seen
in the Educational Test collection.

`media.csv` — one row per file. `media_path` is the full S3 object key for the
uploaded image under `Collections/<uuid>/Uploads/<stamp>_<slug>/<relpath>`
(P3-verified: under the upload prefix, **not** a separate `UploadBlobs` key).
**`media.csv` is byte-shape-exact with the existing SPARC'd schema** — the
verified **v016 11-column** layout, every field quoted, LF-terminated — because
the existing Python readers parse no-header CSVs by fixed position. The full key
is repeated in the `media_id` / `sequence_id` / `file_path` positions (cols
0/2/5), matching the canonical writer. The **uploader is the writer-of-record for
capture time**: timestamp column (4) carries the DST-corrected naive wall-clock
(interpreted in the upload timezone), sourced from EXIF / video-container
metadata or — for files that have neither — a manual entry in the Assign step.
Publish is gated so col 4 is never empty for a published batch. (This is the
contract enforced by `packages/camtrap/test/contracts.test.ts` and
`serializeMedia`; it supersedes earlier drafts that left col 4 empty.) Blob
content hashes live in the `files` manifest inside `UploadComplete.json` (below),
not in a `media.csv` column.
`file_name` (col 6) is the local filename, `deployment_id` matches the single
row in `deployments.csv`, and `file_media_type` (col 7) is `image/jpeg`.

`observations.csv` — always written as an empty file in v0. Observations
are written later by sparcd-tagger as append-only versions under
`<uploadPrefix>/observations/<userId>/`. Always writing the empty canonical
file gives the tagger a stable base hash and avoids reader-specific
absence behavior.

`UploadMeta.json` — matches the shape we already verified from the
Educational Test bucket:

```json
{
  "uploadUser": "<uploaderUser>",
  "uploadDate": { "date": {...}, "time": {...} },
  "imagesWithSpecies": 0,
  "imageCount": <n>,
  "editComments": [],
  "bucket": "<targetBucket>",
  "uploadPath": "Collections/<uuid>/Uploads/<ISO>_<uploaderUser>",
  "description": "<userDescription>"
}
```

`UploadComplete.json` — final sentinel written last:

```json
{
  "schemaVersion": 1,
  "uploadPath": "Collections/<uuid>/Uploads/<stamp>_<uploaderUser>",
  "fileCount": <n>,
  "metadataBundleSha256": "<hash of UploadMeta + CSV payloads>",
  "files": [
    { "media_path": "Collections/<uuid>/Uploads/<stamp>_<uploaderUser>/<relpath>",
      "size": <bytes>, "sha256": "<hex>" }
    // ... one entry per image
  ],
  "completedAt": "<ISO timestamp>"
}
```

(P3 dropped the `blobPrefix` field — images live under `uploadPath`, so there is
no separate blob prefix to record.)

`metadataBundleSha256` covers **the metadata files only** (the manifest +
the three CSVs), not the image blobs — it commits the bundle's *index*.
`files` commits the bundle's *contents*: one entry per uploaded blob with
its S3 key, size, and SHA-256. Together they let a verifier confirm both
"the manifest I'm reading wasn't tampered with" and "every blob the
manifest claims exists and matches the recorded hash." Sentinel-aware
readers consume `files`; pre-sentinel readers (which never reach this
file in the first place — see the partial-publish rule) are unaffected,
so this stays additive.

`metadataBundleSha256` is deterministic: concatenate, in this exact order, the
UTF-8 bytes of `UploadMeta.json` **as written** (the 2-space-pretty form), then
the UTF-8 bytes of `deployments.csv`, `media.csv`, and `observations.csv`;
compute SHA-256 over that byte stream. (P3 implements it over the exact written
bytes — deterministic given the inputs — rather than a separate canonical-JSON
re-encoding, so the hash commits precisely what lands in the object.)

## Keyboard shortcuts (initial set)

Smaller than the tagger; this tool is mouse-friendly by nature.

| Key | Action |
|---|---|
| `Enter` | Advance to next step |
| `Esc` | Cancel current step / close modal |
| `J` / `K` | Next / previous file in the inspect list |
| `D` | Drop selected file from the batch |
| `?` | Toggle cheatsheet modal |

## Phased delivery

| Phase | Scope | S3 writes |
|---|---|---|
| **P0** | Scaffold app, reuse the four shared packages (`s3-safe`, `camtrap`, `types`, `auth-ui`); shared Connection screen; drag-drop folder, virtualized file list (no S3 reads/writes) | None |
| **P1** | EXIF parse + SHA-256 hash in Web Workers; thumbnail generation; validation rules; safe user/file key normalization | None |
| **P2** | Deployment picker reading `Settings/locations.json`; validate exact path, JSON shape, and browser CORS read behavior | Reads only |
| **P3** | In-memory Camtrap-DP CSV generation; preview `UploadMeta.json`, `UploadComplete.json`, and the three CSVs inline; verify completed shape against an existing Educational Test upload; **verify the existing Java/Next readers actually follow `media.csv`'s `media_path` to a key under `UploadBlobs/` outside the upload prefix** — not just that the CSV shape matches. The marimo explorer presigns whatever `media_path` says, but the Java app may have a hardcoded assumption that image bytes live under the upload prefix; if so, the blob-staging layout needs a coordinated reader update before P4 production-bucket lift. | Reads only |
| **P4** | Append-only streaming uploads (`writeImmutableStream` — single-PUT or multipart per file; the spike resolved to **manual multipart orchestration**, not `lib-storage`, to keep the conditional complete) to test bucket; blobs **under the upload prefix** (no `UploadBlobs` staging — removed in P3); final-prefix CSVs; `UploadComplete.json` written last — **only after manual review of `@sparcd/s3-safe` + the upload sequence** and **bucket lifecycle rule for incomplete multipart uploads is verified live**; dry-run on by default | First writes, to test bucket |
| **P5** | Resume on failure: Dexie-tracked file state + persistent handles or reselect-folder reconciliation; **completed-blob skip + interrupted-file restart-from-scratch** (mid-file multipart resume via persisted `UploadId` + `ListParts` is a follow-on, not P5 baseline); size/SHA-256 sanity check | Same as P4 |
| **P6** | Runtime bucket discovery + BYO-S3 portability; remove build-time bucket gates | Same scope as P5 |

### P0 — done (2026-06-01)

Scaffolded the app and established all four shared packages (this is the
first app in the workspace to be built, so `packages/` started empty).

- **`@sparcd/types`** — `S3Config`, `Collection`, `Species`, `UserSession`,
  plus the pure `detectBackendDefaults(endpoint)` inference. Placement note:
  detection lives here, not in `s3-safe`, because it is pure string logic
  shared by `auth-ui`, which must not pull in the AWS SDK; `s3-safe`
  re-exports it.
- **`@sparcd/s3-safe`** — the blessed boundary: `SafeS3Client` with a
  construction-time + per-call bucket allowlist, the read methods
  (`listObjects` / `getObject` / `statObject` / `presignedGet`), and
  `writeImmutable` (conditional `IfNoneMatch: "*"`, throwing
  `PreconditionFailedError` / `ConditionalPutUnsupportedError`, no fallback).
  `writeImmutableStream` remains a P4 addition. Not imported by the app yet
  (P0 does no S3), so the SDK stays out of the P0 bundle.
- **`@sparcd/auth-ui`** — the shared three-field Connection screen with the
  endpoint-inferred region / path-style / secure behind "Advanced",
  parameterized only by tool name.
- **`@sparcd/camtrap`** — Camtrap-DP type surface
  (`Deployment`/`Media`/`Observation`/`CamtrapBundle`); reader/writer land in
  P3.

App (`apps/sparcd-uploader`): Vite + React 18 + TS, Tailwind with the Field
Notebook v2 tokens driven by CSS variables (light + first-pass walnut-dark
swap, toggle in the chrome). Connection gate → tool chrome (section tabs
New upload · History · Settings, upload-state pill). Four-step indicator with
**Drop** and **Inspect** live: drag-and-drop or "Choose folder" with a
recursive JPEG scan (entries API + `webkitdirectory`), and a virtualized file
list (`@tanstack/react-virtual`) showing filename + size with `J`/`K` to move
and `D` to drop the active row. Zustand holds the session; no Dexie yet
(resume is P5). No S3 reads or writes. `tsc --noEmit` and `vite build` both
pass; dev server boots and serves. Steps 3–4 and the other sections render
honest "coming in P*" placeholders.

Workspace plumbing: packages are consumed as TS source (no `dist/`) via Vite
aliases + tsconfig paths. Decisions taken without blocking: used Tailwind
directly rather than wiring shadcn/ui (the components are bespoke — sharp
corners, hairline rules); `uploaderUser` provenance (open question 1) is not
needed until P1/P2 and stays open.

### P1 — done (2026-06-02)

EXIF, hashing, thumbnails, and validation now run off the main thread, and
the key-normalization rules live in one pure module. Still no S3 — entirely
local.

- **Worker (`src/workers/fileProcessor.worker.ts`)** — one file per message,
  three results: streamed SHA-256 (`hash-wasm`'s incremental `createSHA256`
  over `file.stream()`, so memory stays flat across thousands of files), EXIF
  via `exifr` (`DateTimeOriginal` → `CreateDate` → `ModifyDate` fallback, plus
  Make/Model and a separate `exifr.gps()` call for decimal coords), and a
  ≤64-px JPEG thumbnail via `createImageBitmap` + `OffscreenCanvas`. Hash is
  mandatory (failure → file error); EXIF and thumbnail are best-effort.
- **Pool (`src/lib/processPool.ts` + `src/lib/processing.ts`)** — bounded pool
  of `min(cores-1, 6)` workers, refilled as results land. The controller lives
  in module scope (not a component), keyed on `batchToken`, so processing keeps
  running across section switches and only restarts when a new batch is
  scanned. Vite splits the worker (exifr + hash-wasm, ~94 kB) into its own
  chunk — the main bundle stays lean.
- **Validation (`src/lib/validation.ts`)** — pure `validateBatch` over the
  whole batch (SHA-256 dedup is cross-file). `error` blocks the Continue gate
  (missing EXIF timestamp → "needs attention", unsafe filename, process
  failure); `warning` is allowed once surfaced (>100 MiB soft ceiling,
  in-batch duplicate). `summarize` drives the inspect-step counts and gate.
- **Normalization (`src/lib/normalize.ts`)** — `sanitizeUploaderUser` (slug:
  lowercase ASCII `[a-z0-9_-]`, runs of disallowed chars → single hyphen),
  `sanitizeRelPath` (NFC, control chars stripped, separators collapsed, `.`/
  `..` rejected), and `resolveCollisions` (deterministic short-hash suffix
  from a content-hash seed). Filename safety is wired into validation now;
  `sanitizeUploaderUser` has a live home in the Settings identity field;
  `resolveCollisions` is the forward hook P3 uses for object keys.
- **UI** — the inspect file list gained thumbnail, camera/hash subline, EXIF
  timestamp, pixel dimensions, and a per-row status dot (OK / warning / needs
  attention, issues on hover). Continue is gated on `summary.ready` (nothing
  pending, no blocking errors) and advances to the P2 Assign placeholder.
  `J`/`K`/`D` unchanged. Settings now holds the free-text uploader identity
  with a live key-safe slug preview (open question 1's lean: free text).

Deferred without blocking: the manual-timestamp-entry editor for
"needs attention" files is surfaced as a clear reason here but the editing
affordance lands with the Assign step (P2), where per-file metadata editing
naturally lives. No Dexie yet (resume is P5); thumbnails are kept in memory as
Blobs and object URLs are created/revoked per visible row.

### P2 — done (2026-06-02)

The deployment picker reads the camera-location registry from S3 and the Assign
step is live. First phase to touch S3 — reads only.

- **Registry location (verified live, user-authorized read).**
  `Settings/locations.json` lives in a **settings bucket**, not the per-collection
  bucket: prefer `sparcd-settings-*`, fall back to legacy `sparcd`. This
  deployment uses legacy `sparcd` (no `sparcd-settings-*` exists). The
  Educational Test collection bucket holds only `Collections/`, so the picker
  reads a different bucket than uploads target.
- **Shape + validity (`src/lib/locations.ts`, pure).** A JSON array of
  `{ nameProperty, idProperty, latProperty, lngProperty, elevationProperty }`,
  validated per upstream `Location.java`: name/id non-empty, lat ∈ [-85, 85],
  lng ∈ [-180, 180], elevation ≠ -20000. The document being non-array or
  non-JSON throws `LocationsShapeError`; individual malformed/invalid entries
  are partitioned into `skipped` with a reason so one bad row never sinks the
  picker. Verified against the live 250-entry file and crafted edge cases.
- **`idProperty` is NOT unique — important data contract.** 15 ids repeat with
  *different* coordinates/names (e.g. `SAN19` carries both `Mansfield-3` and
  `*DO NOT USE* Mansfield-3`); upstream keys records by (id, lat, lng).
  Locations are therefore keyed by a composite `id|lat,lng` and **only exact
  duplicates collapse** — dedup-by-id alone would silently hide ~16 legitimate,
  selectable locations. Live result: 250 raw → 249 distinct + 1 exact-dup
  skipped. `deployment_id` is still `<collection-uuid>:<location-id>` (P3).
- **S3 wiring.** `src/lib/s3.ts` constructs one cached `SafeS3Client` per
  connection and discovers the settings bucket by probing visible buckets for
  `Settings/locations.json`. Added `listBuckets()` to `@sparcd/s3-safe` as the
  discovery primitive — read-only, returns names only, intentionally not
  allowlist-gated (it cannot read or write object data). TanStack Query
  (`useLocations`) caches the read across section switches / Assign revisits,
  keyed on the endpoint and access key.
- **CORS read behavior.** Read errors are translated into actionable messages:
  404 → "not found", 403 → "access denied", and a status-less browser fetch
  failure → an explicit "endpoint unreachable or the bucket CORS policy needs
  to allow GET/HEAD from this origin" hint. The SDK read is verified
  server-side; a live in-browser CORS preflight against the endpoint still
  needs confirming when the app runs in a browser (and the bucket CORS policy
  may need this origin added — the P4 multipart preflight is separate).
- **UI (`src/sections/Assign.tsx` + `components/DeploymentPicker.tsx`).** The
  Assign step replaces the P2 placeholder: a bespoke searchable combobox over
  the locations (filter by name/id, arrow/Enter/Esc keys, shows id + coords +
  elevation), the uploader-identity field (prefilled, slug preview, shared with
  Settings), and the upload-description textarea. Continue is gated on a
  selected deployment + a non-empty uploader slug, and advances to the P4
  upload placeholder. Target-collection selection and the five-file metadata
  preview are honestly marked as landing in P3.

Deferred without blocking: target-collection (bucket) selection and the
metadata preview move to P3, where the in-memory Camtrap-DP bundle is built;
the manual-timestamp editor for "needs attention" files (noted in P1) was not
added here and can land alongside per-file metadata editing. The AWS SDK now
ships in the main bundle (~460 kB), expected for the first read phase. Open
question 2 (first test bucket) is still unanswered — it gates P4 writes, not
P2 reads.

### P3 — done (2026-06-02)

In-memory Camtrap-DP bundle generation plus an inline preview of all five
metadata files, with the completed shape verified byte-for-byte against a live
Educational Test upload and the upstream reader behavior confirmed. Reads only.

- **Writer (`@sparcd/camtrap`).** `serializeDeployments` / `serializeMedia` /
  `serializeObservations` emit the verified **v016 fixed-position** shapes
  (deployments **23 cols**, media **11 cols**, observations **20 cols**),
  every field quoted (QUOTE_ALL), LF-terminated with a trailing newline — a
  byte-exact match to the live `2022.07.12.10.39.29_smalusa` upload (confirmed
  by diffing generated rows against the real `deployments.csv`/`media.csv`
  bytes). Plus `buildUploadMeta` + `serializeUploadMeta` (2-space pretty, LF, no
  trailing newline; nested `uploadDate.{date,time}` with `nano`), `uploadStamp`
  (`YYYY.MM.DD.HH.MM.SS` prefix), and `serializeUploadComplete`. `Deployment`
  gained `elevation` (→ v016 `camera_height`, six decimals); `Observation`
  gained `timestamp` (v016 col 4). The observations writer exists for the
  tagger but v0 always writes an empty file.
- **Bundle builder (`src/lib/bundle.ts`).** Assembles the five payloads from
  the chosen deployment, identity slug, target collection, and processed files;
  computes `metadataBundleSha256` over the exact bytes of `UploadMeta.json` +
  the three CSVs via Web Crypto; resolves bundle-relative object names
  (`sanitizeRelPath` + `resolveCollisions` seeded by the content hash) and keys
  each `media_path` to the upload prefix.
- **Target collection + preview UI.** Assign discovers collection markers under
  `Collections/<uuid>/collection.json`, lazily reads the selected
  `collection.json` for a display name, and renders a tabbed inline preview of
  all five files (`observations.csv` shown as the empty-file case). Continue is
  gated on a deployment + target collection + uploader slug.

- **CRITICAL verification finding — blob layout pivoted to upstream-compatible.**
  P3's required check was whether the existing reader follows `media.csv`'s
  `media_path`. **It does not.** Upstream (`server/s3/s3_access_helpers.py:
  get_s3_images`, Python — not Java) **lists objects under the upload prefix and
  presigns the listed key**, using `media.csv` only to *decorate* already-listed
  images with timestamps/species (matched on the full key). Live data confirms:
  images sit at `…/Uploads/<stamp>_<user>/<relpath>` and `media_path` points
  there. The plan's original `UploadBlobs/<sessionId>/<sha>.<ext>` staging would
  make every uploaded image **invisible** to the existing SPARC'd app. With the
  user's decision, the layout is now **upstream-compatible**: image bytes live
  **under the upload prefix**, and `media_path` =
  `Collections/<uuid>/Uploads/<stamp>_<slug>/<relpath>`. The S3-sync section,
  the `media.csv` notes, and the `UploadComplete.json` schema below are updated
  to match; **`UploadBlobs` is removed from v0.**
- **Sentinel finding.** Upstream has no `UploadComplete.json` reader — it treats
  presence of **`UploadMeta.json`** as the completion marker
  (`__check_upload_complete`). So for upstream compatibility, P4 must write
  `UploadMeta.json` **last among upstream-visible objects**; our additive
  `UploadComplete.json` is a richer integrity sentinel our own tools read.

**P4 must revisit (now that `UploadBlobs` is gone):** the IAM `UploadBlobs/*`
write condition (→ images now write under `Uploads/*`), the Dexie `blobPrefix`
field, the half-populated-directory concern (handled by writing `UploadMeta.json`
last, not by a hidden blob prefix), and the upload order of operations.

P0–P3 are fully usable as a local-only "prepare an upload bundle" tool
with no S3 writes. P4 is the first write phase; P6 is the only phase
that may touch non-test buckets.

### P4 — done (2026-06-02)

The full publish sequence is implemented end-to-end and runnable today in
**dry-run** (the default and, until the live gates below clear, the only
enabled path). Wet writes are code-complete but fenced behind an explicit
write allowlist and the live-verification checklist.

- **Spike settled — multipart conditional-complete via manual orchestration.**
  The question was whether `@aws-sdk/lib-storage`'s `Upload` can attach
  `IfNoneMatch` to the multipart **completion** step. It cannot — `Upload`
  applies caller params to `CreateMultipartUpload` only, and a precondition on
  *create* does not prevent a colliding *complete*, so routing large files
  through `Upload` would silently drop the immutability guarantee. So
  `writeImmutableStream` orchestrates multipart itself. Verified against the
  resolved `@aws-sdk/client-s3` (3.1058.0): `CompleteMultipartUploadRequest`
  exposes `IfNoneMatch`, so the conditional complete is reachable. lib-storage
  is **not** a dependency.
- **`@sparcd/s3-safe` — `writeImmutableStream` + a second (write) allowlist.**
  Single conditional `PutObject` for bodies ≤ `partSize` (8 MiB); manual
  `CreateMultipartUpload` → `UploadPart` (lazy `Blob.slice` parts, bounded
  internal concurrency) → conditional `CompleteMultipartUpload` above it. Same
  typed errors as `writeImmutable` (412 → `PreconditionFailedError`, 501 →
  `ConditionalPutUnsupportedError`). **No `AbortMultipartUpload`** on failure —
  parts are left for the bucket lifecycle rule, preserving the "no destructive
  APIs" invariant. SHA-256 is always written as `x-amz-meta-sha256`; the native
  `x-amz-checksum-sha256` header is opt-in (`nativeChecksum`, off by default,
  backend-matrix gated). The constructor gained a third arg — a **write
  allowlist, empty by default** — so callers must make write scope explicit.
  For this static uploader the app passes a broad runtime scope (`*`) because
  client-side allowlists are not security boundaries; IAM/CORS and append-only
  wrapper methods are. README updated with the spike finding and the
  backend-enforcement gate.
- **App write wiring (`src/lib/s3.ts`).** Wet writes are no longer gated by
  build-time `VITE_*` bucket names. The app discovers target collections from
  readable `Collections/<uuid>/collection.json` markers and lets the connected
  credentials attempt the upload. Dry-run stays on by default; wet upload
  failures surface as IAM/CORS/backend compatibility errors.
- **Orchestrator (`src/lib/upload.ts`).** `runUpload` runs the order of
  operations exactly: stream blobs under `<uploadPrefix>/<relpath>` (bounded
  concurrency via a small inline lane pool rather than `p-limit` — lanes lazily
  pull the next blob so memory stays flat across thousands of files, and a hard
  failure aborts the in-flight set at once), **exponential backoff with full
  jitter** on transient failures (network/5xx/429; 412 and access denials are
  never retried), then a **final review** — one `listObjects` pass over the
  prefix per 1000 objects, checking every key is present at its expected size,
  instead of a HEAD round-trip per blob; then the three CSVs; then
  `UploadMeta.json` (upstream's completion
  marker, so it lands after blobs + CSVs); then `UploadComplete.json` last. A
  412 on any final-prefix metadata write triggers the **re-stamp retry**: bump
  the stamp +1s, rebuild the bundle (new prefix → new keys), retry once, then
  surface (open question 5 lean). Abandoned blobs are orphans — no deletes,
  ever. **Dry-run** walks the identical sequence and logs every PUT (bucket,
  key, size, hash) while writing nothing. `buildBundle` now also returns the
  per-file upload plan (`items`) so the orchestrator streams the exact bundle
  the Assign preview shows.
- **Upload step UI (`src/sections/Upload.tsx`).** Replaces the P4 placeholder:
  dry-run toggle (default on), concurrency slider 4–16 (default 8), per-file
  virtualized progress list (state dot + mini bar), aggregate bar + byte
  counts + state tallies, a live event/PUT log, completion summary (prefix +
  bundle hash), Cancel, and **Next batch** (keeps deployment, uploader, target
  collection, and description). Store gained `dryRun`, `uploadConcurrency`, and
  `nextBatch`.

**Operational prerequisites for successful wet writes:**

1. Credentials whose IAM policy permits append-only `PUT`, `HEAD`, `GET`, and
   `LIST` on the intended settings/collection buckets.
2. Bucket CORS allowing this static app origin to call the needed S3 methods
   and headers.
3. **Live backend enforcement** of conditional `PutObject` *and* conditional
   `CompleteMultipartUpload` on the target MinIO endpoint (the multipart
   guarantee is unverified there until proven).
4. The **bucket lifecycle rule** that aborts incomplete multipart uploads
   (recommend 7 days) — the only orphan-part cleanup, since the wrapper never
   aborts.

Deferred to P5 as planned: Dexie-backed resume (completed-blob skip across
restarts, reselect-folder reconciliation) — v0 keeps run state in memory, so a
closed tab restarts the batch. A blob-key 412 mid-run is treated as
"already present / skip" (the forward hook for resume) rather than a failure.

### P5 — done (2026-06-02)

Resume on failure is implemented end-to-end. A wet run now persists its session
to IndexedDB and updates per-file state as blobs land, so a closed tab or a
flaky connection picks the batch back up instead of re-uploading from scratch.
Dry runs persist nothing (they write nothing, so there is nothing to resume).

- **Dexie store (`src/lib/db.ts`, schema v1).** Three tables matching the plan:
  `batches` (`id` = a `crypto.randomUUID` sessionId stable across resume,
  `uploadPrefix`, `targetBucket`, `deploymentId`, `uploaderUser`/`uploaderSlug`,
  `collectionUuid`, `description`, `startedAt`, `completedAt`, `totalFiles`,
  `totalBytes`, `fileAccessMode`, and the structured-cloned `dirHandle`),
  `files` (keyed `sessionId::localPath`, with `state`,
  `remoteKey`/`remoteETag`/`attempt`/`lastError` and the recorded `size`/
  `sha256`/EXIF), and `bundles` (the five serialized payloads +
  `metadataBundleSha256`). **`blobPrefix` was dropped** as P3 flagged — images
  live under the upload prefix, so there is no separate blob prefix to record.
  Versioning uses Dexie's forward-carrying `version(1).stores(...)`; `saveSession`
  replaces a session's file rows wholesale so a re-stamp (new prefix → new keys)
  leaves no stale rows.
- **Durable file access (`src/lib/scanFiles.ts`, `src/lib/resume.ts`).** The
  "Choose folder" path now prefers `window.showDirectoryPicker` so it can stash a
  durable `FileSystemDirectoryHandle` (access mode `persistent-handle`);
  drag-drop and the legacy `<input webkitdirectory>` carry no handle and fall to
  `reselect-required`. `scanDirectoryHandle` walks a handle and prefixes relPaths
  with the handle's own name, so paths match the `topFolder/sub/file.jpg` shape
  the other two scan paths produce — resume reconciliation keys on it.
- **Resume restore.** `restoreFromHandle` revalidates the stored handle's read
  permission inside the Resume click gesture (`queryPermission` →
  `requestPermission`) and re-walks it, trusting identity (no re-hash).
  `reconcileReselect` is the no-handle path: it matches the reselected folder to
  the persisted file list by **relative path, size, AND SHA-256** (re-hashed via
  the existing worker pool), surfacing any mismatch (different folder, edited or
  renamed image) as a skipped-with-reason problem rather than uploading the wrong
  bytes. A reselect via the durable picker opportunistically upgrades the session
  to `persistent-handle` for next time.
- **Resumable orchestrator (`src/lib/upload.ts`).** Refactored into a shared
  executor over a `RunPlan`, driven by `runUpload` (fresh, dry or wet) and
  `resumeUpload` (replay a persisted session). Resume reuses the persisted prefix
  and keys verbatim: **completed blobs skip after a `statObject` size + recorded
  `x-amz-meta-sha256` sanity check** (re-uploading on a remote mismatch or a
  missing object), and **interrupted/pending/failed files restart from scratch**
  (mid-file multipart resume via persisted `UploadId` + `ListParts` remains a
  follow-on, not P5 baseline). Because resume owns the prefix, a 412 on a
  metadata write is treated as "already written, skip" rather than the fresh-run
  re-stamp. File state is written to Dexie as each blob settles; the batch is
  marked `completedAt` once `UploadComplete.json` lands.
- **History UI (`src/sections/History.tsx`).** Replaces the placeholder: lists
  every persisted session (newest first) with status badge, date, collection,
  file count, bytes, and live done/failed tallies. Open sessions offer **Resume**
  (gated on being connected; IAM/CORS decides whether the write succeeds), and
  every session offers **Discard** (drops the local session row, bundle, and
  file rows — never touches remote state). The progress/log view was extracted
  into `components/RunMonitor.tsx`, shared with the New-upload Upload step.

Deferred without blocking: **mid-file multipart resume** (persist `UploadId` +
part ETags, recover via `ListMultipartUploads`/`ListParts`) stays a follow-on as
planned — the Dexie hooks (`remoteETag`, `attempt`) exist but interrupted files
restart whole in v0. Resume requires reconnecting first (secrets are never
persisted), which matches the plan's reconnect assumption. The reselect path
re-hashes all path+size matches (not just the not-done subset) to honor the
SHA-256 reconciliation contract fully; this only runs on the exceptional
reselect path. P6 later removes build-time bucket gates; resume uses the same
runtime credentials and wrapper methods as fresh upload.

### P6 — done (2026-06-02)

Runtime discovery and BYO-S3 portability. This supersedes the earlier
build-time bucket allowlist idea: because the uploader is a static app, compiled
`VITE_*` bucket names cannot be treated as a real security boundary and would
break users who bring their own S3-compatible buckets.

- **Runtime bucket scope (`src/lib/s3.ts`).** `SafeS3Client` is still the only S3
  boundary, but the uploader passes broad runtime bucket scope (`*`) for reads
  and writes. The connected credentials' IAM policy and bucket CORS determine
  actual access. The wrapper still provides the important safety properties:
  no delete/copy/overwrite APIs, immutable conditional writes, and portable
  HEAD verification.
- **Settings discovery.** The app calls `ListBuckets` and probes visible buckets
  for `Settings/locations.json`. Official SPARC'd buckets are sorted first when
  present, but any readable bucket with that marker works.
- **Collection discovery.** The app scans readable buckets for
  `Collections/<uuid>/collection.json`; bucket names no longer need to match
  `sparcd-<uuid>`, and multiple collections can live in one bucket because the
  selection key is `bucket::uuid`.
- **Wet upload behavior.** Dry-run remains on by default, but it is no longer
  forced by missing build-time env vars. A wet run uses the connected
  credentials directly; failures surface as IAM, CORS, or backend compatibility
  problems. Resume follows the same model.
- **Docs direction.** CORS and IAM become operator documentation: provider-
  specific examples should show how to allow the hosted app origin and grant the
  append-only S3 actions. The app detects common CORS/read/write failures and
  points users toward that setup.

`tsc --noEmit` and `vite build` pass for the runtime-discovery implementation.

## Open questions for before P0

1. **`uploaderUser` provenance.** Free text vs. tied to S3 access key
   identity vs. SPARC'd user accounts. The existing Educational Test
   uploads use a short username (`smalusa`); we'd want consistency.
   Lean: free-text field, persisted in Dexie, pre-filled from last
   session.
2. **First test bucket(s).** Needs a concrete name (or naming pattern)
   confirmed write-allowed for the test IAM key. Same blocker as the
   tagger's question 2 — shared answer.
3. ~~**`observations.csv` on empty uploads.**~~ Resolved: always write an
   empty canonical `observations.csv`. P3 still verifies that existing
   readers tolerate an empty file, but absence is no longer an option.
4. **Deployment-creation flow.** Out of scope for this tool. If a
   researcher needs a deployment not yet in `Settings/locations.json`,
   they request one upstream; the upload waits. Confirm this is
   acceptable workflow-wise vs. needing an admin-tool path.
5. **Concurrent upload sessions.** What if two researchers race for the
   same `<ISO>_<uploaderUser>` prefix? Conditional PUTs on final-prefix
   metadata resolve it, but should the loser auto-retry with a
   `<ISO+1s>_<uploaderUser>` prefix or surface the collision? Lean:
   auto-retry once, then surface.
6. **Reader sentinel rollout.** Which existing Java / Next / explorer
   readers need to ignore prefixes without `UploadComplete.json` before
   uploader writes are allowed outside test buckets? Lean: make this a
   production-lift gate, not a P0 blocker. Cross-link: this is the
   uploader-side half of the tagger's **Canonical merge path** question.

## Out of scope (explicit, for future tools)

- Tagging within the upload flow — that's sparcd-tagger
- Map / spatial reports — that's the marimo explorer
- Deployment creation / editing — out, see open question 4
- Video files — out in v0; the Camtrap-DP schema supports them but the
  validation, transcoding, and multipart story is its own project
- RAW image formats — out in v0; JPEG only
- User management / permissions admin
- OPFS source-folder mirroring — see "Why not OPFS staging" above; future
  option if researcher workflows show frequent source-disappearance, not
  in v0
- Modifying existing uploads — never; the tool only creates new prefixes
