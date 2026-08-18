# DRAFT — for review, not yet agreed. Generated 2026-08-06.

# Gap report: specified behavior vs. as-built behavior

Inputs: `spec-features/` (11 story feature files, 73 scenarios), `as-built/uploader/`
(9 files, 106 scenarios), `as-built/tagger/` (11 files, 122 scenarios), `use-cases/`
(3 use cases, 41 NFRs) and the four `NOTES.md` files.

Status vocabulary:

- **covered** — every acceptance criterion of the story is met by a named as-built scenario.
- **partial** — at least one criterion met, at least one not.
- **missing** — no criterion met by any app.
- **no-app** — the behavior belongs to a surface that does not exist in this repo.
  No story scores this: every story has at least one candidate owner app, though F3's
  announcement half and A1's pre-upload-tagging half have no owning surface (noted below).

---

## 1. Per-story coverage

| Story | Specified scenarios | As-built coverage | Status | Notes |
| --- | --- | --- | --- | --- |
| **F1** Upload a batch once back online | 7 | uploader: `Every file in the batch is stored under one upload folder in the collection`, `Each stored object is verified after it is written`, `The upload is only published once every file has landed`, `A batch where some files failed is left unpublished and shown as partial`, `Only JPEG images and MP4 videos are taken from the chosen folder`, `Subfolders are read as part of the same batch`; resume via `An interrupted upload can be continued from where it stopped` | **partial** | Unmet: `Frank can tell at a glance whether he is currently able to upload` — `navigator.onLine` is never consulted (uploader NOTES §"Story mapping"). Unmet: `Preparing a batch requires no connection until Frank chooses to upload` — contradicted by `Nothing in the tool is reachable before a connection is made`; Drop/Inspect/Assign all sit behind the connect gate, and collection + location lists are fetched at Assign. Weak: `An upload that never completes does not add images to the collection` holds only for *discoverability* — media objects of an abandoned run stay in the bucket unpublished, and nothing removes them. |
| **F2** Camera location per SD card | 6 | uploader: `The batch cannot be uploaded until a camera location is assigned`, `The batch cannot be uploaded until a target collection is chosen`, `Locations the chosen collection has already used are offered first`, `The exact metadata that will be written can be previewed before uploading` | **partial** | Unmet: `Only locations valid for the chosen collection can be assigned` and `A location outside the collection cannot be assigned` — the as-built scenario carries an explicit deviation comment: *any* registry location is assignable; already-used locations are an ordering hint only. Not exercised: `An upload cannot be finalized while any batch is missing a location` names *which* batches — as-built a run holds exactly one batch, so the multi-batch message does not exist. `Batches from different cards keep their own separate locations` holds by construction (one upload folder per run) but `The next batch from the same site keeps the previous choices` carries the previous deployment forward silently. |
| **F3** Announce new data ready for tagging | 6 | uploader: `An upload that fails or is abandoned announces nothing`, `The upload is only published once every file has landed`; tagger (pull side, `@unmapped`): `Uploads can be narrowed to those still needing work`, `The collection header totals the work outstanding` | **partial** | Only the two negative criteria are met, and vacuously — the uploader's own scenario states "There is no notification mechanism as-built". Unmet: `The identification team can see that new untagged data is available` as an announcement, `The announcement says what was uploaded`, `An announcement does not reveal a protected location`. `Frank can add his own notes to the announcement` is approximated by `A description can be recorded with the batch`, which is upload metadata, not an announcement. **The announcement itself has no owning app.** |
| **F4** Never expose endangered-species locations | 10 (all `@security`) | tagger: `The tagger applies no species-based or location-based restriction`, `Each upload's camera location is shown in the upload list`, `The focused image shows the deployment it belongs to`, `Image links are time-limited but not otherwise restricted` | **missing** | The as-built file exists solely to record the absence. No sensitivity concept anywhere in either app (tagger NOTES: "F4 — not addressed by this tool"; uploader NOTES: "no implementation whatsoever" — deployment CSV, media paths and the metadata preview all carry precise coordinates). Access is whatever the connected S3 credentials grant. |
| **A1** Identify species before uploading | 6 | uploader: `A batch with no species identifications is accepted and recorded as untagged` | **partial** | That one scenario satisfies `Untagged images are accepted and marked as untagged` and `An upload with no tags at all is still accepted` — but only because the uploader has no tagging surface at all and always writes an empty observations table. Unmet: `Tags assigned without a connection are retained`, `Images and their tags enter the system in a single upload`, `Tags made before upload are attributed to Anita`, `Tags are not lost while waiting for a connection`. **The pre-upload tagging surface has no owning app**: the tagger only reads uploads that already exist. |
| **A2** Camera location while uploading | 5 | uploader: `The batch cannot be uploaded until a camera location is assigned`, `The batch cannot be uploaded until a target collection is chosen`, `Locations the chosen collection has already used are offered first` | **partial** | Same registry deviation as F2: `Only locations valid for her collection can be assigned` and `A location outside her collection cannot be assigned` unmet. `The location applies to the identifications she already made` is unreachable — there are no pre-made identifications (see A1). |
| **AL1** Uploads survive an unreliable connection | 6 | uploader: `Every real upload is recorded so it can be picked up later`, `An interrupted upload is listed as open, never as complete`, `An interrupted upload can be continued from where it stopped`, `Files already stored and verified are not sent again`, `An upload interrupted before the batch was fully examined explains what to do`, `A momentary failure is retried before the file is given up on` | **partial** | Unmet: `An interrupted upload continues on its own when the connection returns` — the as-built scenario carries the comment "continuation is manual: the user clicks Resume. The tool does not detect connectivity returning and does not restart on its own." Within-run retry is five attempts with backoff; past that the run stops. Partial: `An upload is never left in a silent, stuck state` — a *failed* run says so, but there is no stall watchdog, so a run making no progress without erroring is not declared stopped. |
| **AL2** Retry to the same destination | 6 | uploader: `A resumed upload lands in the same place as the original attempt`, `Retrying the failed files of a partial run completes that same upload`, `Retrying does not require choosing the location again`, `The source files are re-checked before anything is sent again`, `An object already present at the same path is never silently overwritten` | **partial** | Best-covered story. Only gap: `No leftover partial data from the failed attempt remains`. The storage wrapper exposes no delete, so nothing is ever cleaned up; and on the path where `An upload interrupted before the batch was fully examined explains what to do` sends the user to a *fresh* upload, the old run's objects stay orphaned under their old prefix while the new run re-uploads the same bytes to a new one — so `The destination ends up with exactly one upload` fails for that path. `Retrying does not require re-identifying species already tagged` passes vacuously (no tagging surface). |
| **H1** Examine images closely | 6 | tagger: `An image can be enlarged well beyond its fit-to-screen size` (6×, 10× fullscreen), `The enlarged image can be moved around`, `Returning to the fitted view is one action away once zoomed`, `Moving to another image starts it fitted to the pane`, `Only the images on screen are rendered while scrolling a large upload`, `Fullscreen gives a larger canvas and a deeper zoom` | **covered** | The only story with no behavioral gap. Two residual items are *not* code gaps: `Zooming and panning stay responsive on a small, low-powered laptop` is addressed structurally (virtualization, per-image subscriptions) but never measured — it needs a threshold and a test on target hardware (see §4); and `Close examination works on images of differing sizes and shapes` has no dedicated as-built scenario, though fit-to-pane makes it hold by construction — worth one verification pass, not an issue. |
| **H2** Identify species in new uploads | 7 | tagger: `Clicking a species identifies the focused image`, `An image can carry more than one species`, `One action identifies every image in a selection`, `New identifications are held locally until they are synced`, `Synced identifications become visible to everyone with access`, `An empty frame is labelled as such` | **partial** | Unmet: `Identifying an image does not by itself reveal a protected location` (see F4). Partial: `Identifications are attributed to the person who made them` — attribution is a free-text "Tagger identity" typed in Settings, stamped into the snapshot path and the `UploadMeta.json` edit comment, unverified against the credentials, and recorded per *sync*, not per identification (tagger NOTES §"H2 — met, with one caveat"). Partial: `Only species valid for the collection can be assigned` — the vocabulary is a global `species.json` from the settings bucket, not per-collection, and `A species not in the vocabulary can still be recorded as a request` provides a free-text bypass. Visibility to others requires an explicit dry-run-off sync, not saving. |
| **H3** Confirm existing identifications | 8 | tagger: `The focused image's identifications and counts are listed in full`, `A recorded count can be corrected`, `A single wrong identification can be removed without losing the others`, `Every identification on an image can be cleared at once`, `A correction is attributed to the person who synced it`, `The previous state is preserved before anything is replaced`, `A restore never overwrites a change it did not see` | **partial** | Unmet: `Harold can confirm an existing identification` / `A review records who carried it out` for a *pure* confirmation — the as-built scenario is named `A review that changes nothing leaves the stored data untouched` and carries the comment "confirming a prior identification without altering it records nothing … the H3 criterion is NOT met". Unmet: `Harold can tell reviewed identifications from unreviewed ones` — the only markers are local (`An image edited locally is distinguishable from one that is not`, and the questionable flag, which `stays in this browser` and never syncs). Partial: `The original identifier's work remains attributable` — untouched rows and unmodeled columns are preserved by `Rows and columns the tagger does not model are preserved`, but traceability is at upload granularity, not per identification. Met: `A review does not destroy the original uploaded data`, via snapshot-before-replace. |

**Gaps: 10 of 11 stories (all but H1).**

---

## 2. Missing behavior — draft GitHub issues

One per story with gaps. Paste as-is; replace `<link>` with the wiki story URL.

---

### `[F1] Upload a batch of images once back online — conformance`

**Labels:** `story:F1`, `area:uploader`, `type:conformance`

Story: <link>

Acceptance criteria:

- [x] All images from the batch are stored and retrievable in the target collection — every object is verified after write; metadata published only when all have landed.
- [ ] The upload can be started without a continuous connection during capture — no network required until upload. **The connect gate blocks Drop, Inspect and Assign; collection and location lists are fetched from S3 at Assign.**
- [x] A batch that only partially transfers is not presented as a completed upload — no metadata files are written; the run reports as partial.
- [ ] The uploader can tell at a glance whether they are online. **No offline indicator exists; `navigator.onLine` is never consulted.**
- [ ] An abandoned upload adds nothing to the collection. **Media objects remain in the bucket, undiscoverable but not removed.**

Definition of done: BDD scenarios tagged `@F1` pass.

---

### `[F2] Identify the location of each SD card's images — conformance`

**Labels:** `story:F2`, `area:uploader`, `type:conformance`

Story: <link>

Acceptance criteria:

- [ ] Only locations valid for the chosen collection can be assigned. **Any location in the registry is assignable; already-used locations are sorted first as a hint only.**
- [x] The upload cannot be finalized until the batch has a location assigned — Continue is disabled and states why.
- [x] Each stored image's location matches the one assigned — written into the deployment row and referenced from every media row.
- [ ] Multi-batch finalization names which batches still lack a location. **A run holds exactly one batch; the message does not exist.**
- [ ] Carrying choices to the next batch does not silently reuse the previous deployment. **"Next batch" keeps the previous collection, deployment, identity, description and timezone.**

Definition of done: BDD scenarios tagged `@F2` pass.

---

### `[F3] Announce that new data is ready to be tagged — conformance`

**Labels:** `story:F3`, `area:uploader`, `type:conformance`

Story: <link>

Acceptance criteria:

- [ ] The people responsible for identifying that collection can see that new, untagged data is available. **No notification mechanism exists. The tagger's "In progress" tab is the only pull-side approximation and requires someone to go looking.**
- [ ] The announcement identifies the collection, location(s), image count and upload date. **Nothing is emitted.**
- [x] An upload that fails or is abandoned does not announce new data — vacuously true: publishing the metadata file is the only thing that makes an upload discoverable, and it is never written for a failed run.
- [ ] A sensitive location is not disclosed in an announcement. **Blocked on F4; no sensitivity concept exists.**
- [ ] Free-text notes can accompany the announcement. **The upload description is the nearest thing and is not an announcement.**

Blocked on: notification mechanism decision (use-cases NOTES §3, Q3.1–Q3.6). **No app in this repo owns the announcement surface.**

Definition of done: BDD scenarios tagged `@F3` pass.

---

### `[F4] Never expose the location of endangered species — conformance`

**Labels:** `story:F4`, `area:uploader`, `area:tagger`, `type:conformance`

Story: <link>

Acceptance criteria:

- [ ] Precise sensitive-species locations are not visible outside the collection's authorized members. **No sensitivity concept in either app; locations are shown to any connected user.**
- [ ] Precise sensitive locations do not appear in any export, report or view accessible to unauthorized users. **The deployment CSV, media paths and the uploader's metadata preview all carry precise coordinates.**
- [ ] The protection state of an upload is clear before the uploader commits to it. **Nothing is shown.**
- [ ] A change that would expose a previously protected location cannot happen silently. **No protection state exists to change.**
- [ ] Permission to view or identify does not by itself reveal sensitive locations. **Access is entirely determined by the S3 credentials supplied.**

Blocked on: Story J1 (who designates sensitivity), the permission model (use-cases NOTES §4), and the undefined term "precise location" vs. a coarsened location (spec NOTES §4.3). Enforcement in a static bring-your-own-credentials tool is architecturally bounded — see §4.

Definition of done: BDD scenarios tagged `@F4` pass.

---

### `[A1] Identify species before uploading — conformance`

**Labels:** `story:A1`, `area:uploader`, `type:conformance`

Story: <link>

Acceptance criteria:

- [ ] Tags assigned to not-yet-uploaded images are retained without a network connection. **The uploader has no tagging surface; the tagger only reads uploads that already exist.**
- [ ] The upload carries both the images and the species tags — no separate later step. **An empty observations table is always written.**
- [x] Untagged images are accepted and marked as untagged — by construction, every upload is untagged.
- [ ] Pre-upload tags are attributed to the tagger (`@unmapped`, needs director sign-off). **No attribution path.**

**No app in this repo owns pre-upload tagging.** Decide whether it belongs in the uploader, in the tagger over a local batch, or is deferred.

Definition of done: BDD scenarios tagged `@A1` pass.

---

### `[A2] Specify the camera location while uploading — conformance`

**Labels:** `story:A2`, `area:uploader`, `type:conformance`

Story: <link>

Acceptance criteria:

- [ ] Only locations valid for the collection can be assigned. **Same registry deviation as F2.**
- [x] The upload cannot be finalized until the batch has a location assigned.
- [x] The stored location matches what was assigned.
- [ ] The location applies to identifications made before upload. **Unreachable — no pre-upload identifications exist (A1).**

Definition of done: BDD scenarios tagged `@A2` pass.

---

### `[AL1] Uploads survive an unreliable connection — conformance`

**Labels:** `story:AL1`, `area:uploader`, `type:conformance`

Story: <link>

Acceptance criteria:

- [ ] An interrupted upload continues without the uploader restarting it manually. **Continuation is manual: the user clicks Resume. No connectivity watcher, no automatic restart.**
- [x] Data already transferred and verified is not sent again — each recorded object is re-checked for size and `sha256` and skipped on match.
- [x] The upload is found either completed or clearly resumable — History lists it as open with done/failed counts; only published runs are marked complete.
- [ ] Never in a silent, stuck state. **A failed run says so, but there is no stall detection for a run that makes no progress without erroring.**

Definition of done: BDD scenarios tagged `@AL1` pass.

---

### `[AL2] Retry a failed upload to the same destination — conformance`

**Labels:** `story:AL2`, `area:uploader`, `type:conformance`

Story: <link>

Acceptance criteria:

- [x] The retry targets the same collection and location as the original attempt — same upload folder and object paths; deployment, identity, description and timezone come from the local record.
- [ ] The destination contains exactly one upload, with no leftover partial data. **"Retry failed files" holds this. The interrupted-before-fully-examined path does not: it directs the user to a fresh upload, leaving the old prefix's objects orphaned while the same bytes are re-uploaded under a new prefix. The storage wrapper exposes no delete, so nothing is ever cleaned up.**
- [x] Retrying does not require re-entering the location or re-identifying species — never re-asked; re-identification is vacuous (no tagging surface).

Blocked on: Q1.4 (use-cases NOTES §1) — where the boundary sits between clearing a failed attempt's partial data and M2's prohibition on destroying uploaded data.

Definition of done: BDD scenarios tagged `@AL2` pass.

---

### `[H2] Identify species in new uploads — conformance`

**Labels:** `story:H2`, `area:tagger`, `type:conformance`

Story: <link>

Acceptance criteria:

- [x] One or more species assigned to an untagged image are saved and visible to others with access — via a dry-run-off sync that replaces the stored observation files.
- [x] An image can carry more than one species — neither replaces the other; Ghost is exclusive by design.
- [ ] Identifications are attributed to the person who made them. **Attribution is a free-text "Tagger identity" typed in Settings, unverified against the credentials, and recorded once per sync in the `UploadMeta.json` edit comment and the snapshot path — not per identification.**
- [ ] Only species valid for the collection can be assigned (`@unmapped`, needs director sign-off). **The vocabulary is a single global `species.json`, and free-text "requested species" bypasses it.**
- [ ] Identifying an image does not by itself reveal a protected location. **Blocked on F4.**

Definition of done: BDD scenarios tagged `@H2` pass.

---

### `[H3] Confirm species already identified in existing uploads — conformance`

**Labels:** `story:H3`, `area:tagger`, `type:conformance`

Story: <link>

Acceptance criteria:

- [x] Existing species and counts are shown when the image is opened — from any source (desktop app, sparcd-web, an earlier sync).
- [x] An existing identification can be corrected or removed — per-species removal preserves the rest; counts are editable; Detag clears all.
- [ ] A confirmation records that a review took place and by whom. **The sync diff is content-based, so re-applying an identical identification produces no change and therefore no "reviewed by / reviewed at" trace.**
- [ ] Reviewed identifications are distinguishable from unreviewed ones (`@unmapped`, needs director sign-off). **The only markers are local: the unsaved-edit marker and the questionable flag, which never leaves the browser.**
- [ ] The original identifier's work remains separately attributable. **Traceability is at upload granularity; untouched rows and unmodeled columns are preserved, but there is no per-identification author.**
- [x] A review does not destroy the original uploaded data — an immutable snapshot precedes every replacement, replacement is conditional on the version read, and conflicts refuse the write outright.

Definition of done: BDD scenarios tagged `@H3` pass.

---

## 3. Unmapped behavior — candidates for new wiki stories

165 as-built scenarios carry `@unmapped` (86 uploader, 79 tagger). Grouped:

| # | Group | Where | Scn. | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | **Bring-your-own-credentials connection & session** — connect gate, endpoint inference, secret never on disk, live cross-tab relay, disconnect propagation, identity chip, cache invalidation on reconnect | uploader `connect-and-session`, tagger `connect-and-session` | 10 + ~6 | **propose-new-story** — one shared session story covering both tools. Interacts with the DRAFT session-lifetime questions (use-cases NOTES §2). |
| 2 | **Folder intake from an SD card** — drag-drop or picker, recursive scan, media-type filter, empty-folder message, batch replacement, de-duplication, durable handle vs. reselect | uploader `choose-folder` | 8 | **spec-later** — mostly refines F1; fold into F1 once "which formats count" (Q5.2) is answered. |
| 3 | **Pre-upload inspection and the error/warning gate** — per-file examination, blocking errors vs. warnings, unsafe paths, duplicates by content, oversize flag, dropping files, background processing | uploader `inspect-batch` | 12 | **propose-new-story** — a real user-facing capability ("catch bad files before they reach the collection") that no story describes. |
| 4 | **Collection and location-registry discovery** — runtime collection listing, searchable deployment picker, coordinate/elevation detail, id-is-not-unique handling, malformed-entry tolerance, unreadable-registry message | uploader `assign-collection-and-deployment` | 12 | **propose-new-story** — and it is where the F2/A2 validity restriction must land. Depends on J1. |
| 5 | **Establishing the authoritative capture time** — timezone defaulting from machine then deployment coordinates, manual-override stickiness, DST-aware naive→instant conversion, per-file and bulk manual entry, impossible-date rejection | uploader `capture-time-and-timezone` | 11 | **propose-new-story** — load-bearing: it decides the capture time of record. No story mentions timezones at all. |
| 6 | **Upload-run safety controls** — dry-run by default, required-access statement, refusal to overwrite an existing object, fatal-vs-systemic failure rules | uploader `upload-run` | ~6 | **propose-new-story** — safety semantics that F1/AL1 assume but never state. |
| 7 | **Upload-run operational controls** — concurrency slider, per-file and batch progress, activity log, cancel, back-disabled, next-batch carry-over | uploader `upload-run` | ~6 | **spec-later** — operational polish; NFR-1.2 covers progress reporting. |
| 8 | **Local upload ledger and resume mechanics** — per-run record, folder re-attachment by handle or reselect, path/size/hash reconciliation, refusal when files cannot be matched, local-only discard, single-resume lock | uploader `resume-and-retry` | 6 | **spec-later** — the mechanism behind AL1/AL2; specify as NFRs (NFR-2.7, NFR-2.10) plus one story if resume becomes automatic. |
| 9 | **Correcting a published upload** — listing/searching published uploads, description correction, deployment re-pointing, snapshot-before-change, stale-ETag conflict, edit audit notes, no-op and dry-run behavior, unsupported-endpoint refusal | uploader `correct-a-published-upload` | 9 | **propose-new-story** — directly engages M2 (originals not destroyed, changes traceable) and Q1.1–Q1.3. Highest-value new story in the uploader. |
| 10 | **Shared-laptop hygiene** — default uploader identity, Settings disconnect wiping local records with an unfinished-upload guard, header disconnect that does *not* wipe and has no guard, theme persistence | uploader `settings-and-local-data`, tagger `connect-and-session` | 6 + ~3 | **propose-new-story** — the two disconnect paths behaving differently is a defect worth a story, not just a note. |
| 11 | **Browse and work triage** — collection rail and filter, species-vocabulary load state, upload rows with date/uploader/location/progress, All / In progress / Done tabs, sync pills, collection totals | tagger `browse-collections-and-uploads` | 9 | **propose-new-story** — this is the de-facto answer to F3's "the team can see new untagged data". Decide whether it *is* the announcement mechanism (Q3.2 pull option). |
| 12 | **Navigating and selecting images** — keyboard stepping, sort with focus/selection remap, find-by-filename, click/shift/meta selection, burst bands, cheatsheet, hotkey suppression | tagger `navigate-and-select-images` | 13 | **spec-later** — throughput machinery behind H2; NFR-3.3 ("few enough actions") is the requirement, the mechanics are design. |
| 13 | **Local drafts and crash recovery** — per-edit persistence, save/flush, reopen restores work, cross-upload History of unsynced edits, guarded discard, base version pinned while edits outstanding | tagger `local-drafts-and-recovery` | 9 | **propose-new-story** — "identification work is never lost" is a user-visible promise no story makes. |
| 14 | **Sync to the collection** — forced preview, dry-run gate, identity requirement, conflict refusal, immutable snapshot before replacement, only-changed-files writes, unmodeled-column preservation, journal resume, post-sync cleanup, state pill | tagger `sync-identifications-to-the-collection` | 14 | **propose-new-story** — the tagger's whole write model. H2/H3 say "saved and visible"; they never say saving is an explicit, previewed, conflict-checked publish. |
| 15 | **Snapshot and restore** — snapshot listing (incomplete ones excluded), dry-run-gated restore, pre-restore snapshot, conflict refusal, cross-upload History browser, local edits survive a restore | tagger `restore-a-previous-snapshot` | 11 | **propose-new-story** — the concrete M2 mechanism. Pairs with #9 and #14. |
| 16 | **Correcting capture times after upload** — whole-upload / selection / per-image shifts, validation, original preserved and shown, offset cleared after sync, bursts unaffected | tagger `correct-capture-times` | 11 | **propose-new-story** — camera-clock drift is a real field problem with no story. Note it edits data the uploader already published (M2 again). |
| 17 | **Flagging an image as questionable** | tagger `H3-review-existing-identifications` (`@H3`-tagged but unmapped in substance) | 1 | **propose-new-story** — currently local-only and never synced, so it does not reach a second opinion. Either make it canonical or drop it (tagger NOTES ambiguity 1). |
| 18 | **Presentation-only affordances** — theme switching, UTM/elevation display maths, virtualized rendering, keyboard cheatsheet, reference-image loupe, display adjustments | both apps | ~10 | **intentionally-out-of-scope** — design detail, not requirements. Keep as as-built documentation only. |

**18 groups.**

---

## 4. Not expressible in BDD

Merged residue from `spec-features/NOTES.md` §1–2, the 41 NFRs in the three use cases,
and the as-built NOTES. These belong in the SRS, the use cases, or a policy document —
not in a `.feature` file.

**Performance and responsiveness (no threshold exists yet)**
- H1 "responsive on a small, low-powered laptop" — needs a device class and a maximum input-to-paint delay. NFR-3.1, NFR-3.2, NFR-3.5, NFR-3.15.
- H1 "detail legible well beyond fit-to-screen" — needs a stated minimum magnification (1:1 pixels? 4× fit?). As-built is 6× / 10× fullscreen; confirm that is the target. NFR-3.4.
- Upload throughput limited by the connection, not the client; progress-reporting cadence; offline-tag read time for a full card. NFR-1.1, NFR-1.2, NFR-1.3.
- Resume cost proportional to what remains; backoff recovery on a flapping link. NFR-2.1, NFR-2.2.
- H2 "few enough actions to assign a species and move on". NFR-3.3.

**Durability and state**
- F1 "no connection required until upload" — an architectural offline-first constraint, not a positive test. As-built, the connect gate violates it.
- Upload state durable across app crash, machine restart and browser session. NFR-1.10, NFR-2.7.
- An unattended overnight upload makes progress across repeated drops without attention. NFR-2.9.
- Completion is idempotent across repeated resumes. NFR-2.8.
- A saved identification survives loss of connection, crash and restart. NFR-3.9.
- A1 offline tag retention has no stated horizon (app restart? device restart? weeks?).

**Timeliness and consistency**
- AL1 "never silently stuck" — how long may an upload make no progress before it must declare itself stopped? No threshold; as-built has no stall detection. NFR-2.13.
- H2/H3 "visible to others with access" — propagation delay unstated (immediately? on next open?). As-built requires an explicit sync, which makes this a workflow question, not a latency one. NFR-3.11.
- The morning-after view answers "did it finish?" at a glance. NFR-2.11.
- Announcement delivered at most once per completed upload, and not re-emitted after a resume. NFR-1.9, Q3.5.

**Security architecture and threat model**
- F4/M1 "precise location cannot be recovered indirectly" — a universal negative over an open channel set (metadata, file names, paths, identifiers, aggregates, timing, ordering). Needs a threat model plus a review/pen-test procedure, not a scenario.
- F4 "a single compromised account cannot widen exposure" — an architectural property (authorization at the data boundary, not the view). In a static bring-your-own-credentials tool this can only be enforced by the S3 policy, so it constrains deployment, not app code.
- Location protection enforced by the system, not by the uploader remembering. NFR-1.5.
- Precise sensitive locations absent from every view, export and file. NFR-1.4, NFR-3.6.
- Permissions re-checked at the moment of action, and out-of-permission actions refused in full with nothing partially applied. NFR-1.7, NFR-2.3, NFR-3.8, Q4.4, Q4.5.
- Locations and tags held on the uploader's machine between attempts. NFR-2.6.

**Retention, audit and traceability**
- F4/M2 retention: how long originals are kept, what an audit record must contain, who may read it, whether the audit record is itself immutable.
- Every upload, attempt (including failed ones), correction and removal traceable to a person and time. NFR-1.6, NFR-2.4, NFR-3.7, NFR-3.10, NFR-3.13.
- Clearing a failed attempt's partial data is itself recorded. NFR-2.5.
- "Complete" is a verified state, not an assumed one. NFR-1.8.
- Transferred data verified against the source. NFR-2.10. **As-built caveat:** verification depends on the backend preserving the custom `sha256` object metadata the uploader sets on write; a backend that drops it fails every skip check and post-write verification rather than passing silently. Confirm that is the intended failure mode.

**Identity and permissions (undefined, blocking)**
- The permission model does not exist: levels and what each grants; whether "may see precise sensitive locations" is separate from "may identify"; per-collection or per-location; how administrator-acting-on-behalf appears in records. Q4.1–Q4.6.
- Session lifetime and idle logout are DRAFT; an idle timeout shorter than a night's upload defeats AL1. Q2.1–Q2.5.
- As-built, identity in both tools is unverified free text typed by the user. Any attribution requirement must state how identity is established.

**Undefined terms that block testability**
- **"Precise location" vs. a coarsened location** — the single most load-bearing undefined term across the set. Nothing defines the coarsening (region? county? nothing at all?).
- **"Batch"** — one SD card, or one upload session that may hold several cards? As-built a run holds exactly one batch.
- **Counts** — H3 shows per-species counts, but no story says how a count is recorded. A story is missing. Q5.5.
- **"Image file"** — which formats. As-built: JPEG and MP4 only. RAW and other video containers undecided. Q5.2.
- **Batch identity** — what makes a retry "the same upload": the source card, the destination, or an identifier assigned at first attempt? Q5.3.
- **Species-list scope** — global or per-collection. As-built global. Q5.4.
- **"Reviewed and nothing identifiable"** vs. "not yet reviewed" — as-built the Ghost label carries this, and Browse's "Done" counts an upload complete only if empty frames are Ghost-labelled. Q5.6.

**Out of scope for the feature files, still needing their own treatment**
- M1 and M2 in adversarial framing, and the M3/M4 open questions (law enforcement, border patrol).
- Story J1 (who designates a species or location sensitive) — F4 assumes designations already exist.
- Concurrent identification of one upload by two people. Q5.1. As-built the tagger refuses the write on conflict and offers keep-editing or discard-and-reload; whether that is the intended collaboration model is undecided.

---

## 5. Decisions from the first review pass (Julian, 2026-08-06)

Settled while reviewing the wiki digest; fold into the issues above when filing:

1. **F2 issue:** the collection-restricted location list is confirmed wanted — the tool must offer only locations belonging to the chosen collection, not sort-first.
2. **AL1 issue:** automatic resume on connectivity return is required as written, and a stall watchdog is required (threshold to be picked in the issue).
3. **H3/tagger:** the questionable flag must be shared, not browser-local — add to the tagger conformance work.
4. The untagged-vs-Ghost distinction is the intended rule (closes the "reviewed and nothing identifiable" open item as a decision; the term still needs a line in the glossary).

### `[uploader] Two disconnect paths behave differently — bug`

**Labels:** `area:uploader`, `type:bug`

Disconnecting from Settings clears the tool's local upload records and warns if
an upload is unfinished; disconnecting from the header does neither. Standardize
on one meaning of disconnect. What that meaning should be (keep vs. clear local
data) is an open team question — Q22 on the wiki digest — but the two paths
diverging is a defect regardless of the answer.
