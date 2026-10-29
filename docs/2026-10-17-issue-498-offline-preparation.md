# Prepared offline Uploader and local Tagger (#498)

Uploader now has two explicit preparation actions. Choose the intended collection
and prepare its species online; separately prepare both applications' offline
files. Readiness requires verified complete application caches and a valid
prepared species snapshot. Selecting a folder and Inspect remain available
without species preparation; local tagging does not silently substitute defaults.

## Species and assignment

The shared production loader uses non-empty collection species first and falls
back to settings only for missing/empty collection files. Invalid or denied
sources remain errors. The existing source-aware local key-profile reconciliation
runs before accepting a snapshot. The snapshot records a versioned, non-secret
owner scope derived from the canonical endpoint and effective Access key ID,
alongside the endpoint and
collection, source, semantic SHA-256, preparation time, entries and key overrides;
it contains no secret or signed credentials. Once bound to a batch, it is not
replaced by a new shared session or another preparation.

Local Tagger reads only that batch's snapshot, including when another app is
connected. Online Assign independently fetches the actual destination's current
list. Changes require explicit acceptance; identifications no longer allowed by
that list block continuation without deleting tags. Existing requested-species
behavior is retained. If files arrive while a different collection is merely
selected in the preparation picker, the batch retains the last accepted species
list and cancels the unfinished choice; tagging remains available. Preparation does not assign a collection or location.

## Persistence and originals

The shared `sparcd-flip` database upgrades add vocabulary and pre-upload
preparation stores while preserving legacy records. New handoffs use record v2;
old readers cannot mistake them for a bundled-default batch. The preparation
journal stores stable identity, Inspect metadata, thumbnails, timestamps,
relevant wizard inputs and handoff state. Accepted changes are serialized into
IndexedDB; handoff waits for outstanding writes and records its ID before
navigation. Failed writes retain the previous committed snapshot and expose a
retry. Each batch has its own journal key; simultaneous windows neither replace
nor clear another batch’s record. Recovery lists all saved batches, and a normal
Tagger return restores the matching batch’s saved inputs. Legacy singleton
journals remain recoverable and migrate transactionally after successful recovery.
The species panel refreshes from the recovered batch’s vocabulary, including
showing preparation as required when the recovered batch has no snapshot.
Damaged or unsupported journals remain stored and are reported separately from
healthy recovery choices; they cannot block an unrelated healthy Flip return.
Delayed recovery (including an open OS folder picker) cannot reattach files or inputs after Disconnect, an account
switch, Start over, or replacement of the current batch. Unsupported records are kept and explained rather than guessed at.

Original media files and credentials are not copied into the journal. Recovery
reopens a retained directory handle when permission permits, or asks for individual-file or folder
reselection, then verifies path, size and content hash. Missing/changed originals
block adoption with filenames and reasons; saved metadata and tags are retained.
A file's original modified time is preserved for timestamp estimation. Recovery
reads the latest Flip tags, not an older pre-handoff journal copy. Local Tagger
labels thumbnails when originals are unavailable and verifies reopened originals
in bounded-memory SHA-256 passes. Failed final writes leave Done retryable.
Prepared v2 handoffs do not expire merely because they have been carried offline.
Real publication, explicit reset and existing disconnect cleanup retain their
established roles; journal writes are drained before Settings clears storage.

## Application delivery and updates

The installable manifest uses the Uploader identity/start URL and family scope
so a local Tagger handoff can remain in the installed app window. A single worker
at `/sparcd-exploration/offline-worker.js` owns coordinated Uploader/Tagger assets.
The release generator requires both builds, inventories every built public
asset (including embedded worker/WASM code, fonts and icons), hashes file bytes,
and includes worker code in the release identity. Pages deploys this worker at
the family root. Both apps self-host their existing font families.

Only exact public release assets and the two app entry routes are served from
application caches. Navigation query parameters remain usable without becoming
cache keys. S3, authenticated/signed requests, unknown assets, Admin and Explorer
receive no application-shell fallback. Standalone Tagger and Assign remain
online-only; only the Uploader's prepared local batch can be tagged offline.

Installation verifies every required asset before success. Failed installations
remove their incomplete cache and leave the old release intact. Reopening
rechecks completeness. Explicit online preparation repairs evicted current
assets only if their bytes match the pinned release. New workers never force
activation or reload: an accessible notification asks users to finish work,
close all SPARC’d tabs, windows and installed-app windows (including Home,
Explorer, Admin, Uploader and Tagger), then reopen Uploader. Activation occurs after the old
clients close; the immediately preceding cache is also retained. Collection of
older unused application caches never deletes IndexedDB work.

## Checks and remaining acceptance boundary

The production Chrome harness tests cold ordinary-browser reopening and actual
installed-PWA launch after complete process restarts with offline networking from
launch. It exercises Inspect, verified reselection, local tags, reload/return,
reconnection, absent prerequisites, failed updates and staged activation with
pending work. It uses actual app assets and UI-created records; only storage
responses and the OS file picker are fixtures. See
`apps/sparcd-uploader/e2e/production/README.md` for commands and trace handling.

These are #498's implementation regressions. Issue #497 remains separate and
blocked pending delivery of this prerequisite; its full platform acceptance
matrix and manual real-computer shutdown/restart are not claimed complete.

The restart checks also close the complete browser process with saved local
Tagger edits, then reopen that exact batch URL offline before returning it.
This is tested separately in an ordinary browser and a real standalone PWA.

## Local verification (2026-10-17)

- Uploader 338, Tagger 294, Flip 31 and s3-safe 23 unit tests passed (686 total).
- Both applications' TypeScript checks and production builds passed, as did
  Flip and s3-safe TypeScript checks and the frozen-lockfile check.
- All 170 Uploader BDD scenarios were verified: 164 passed in the broad run;
  six affected scenarios passed after rerunning with fixed preparation/status
  setup and without development-server source reloads during the run.
- The 96-case Tagger species/navigation/viewing subset passed, plus all nine
  local-batch scenarios (two overlap the subset).
- The canonical production command passed all 20 then-discovered cases. The
  subsequently added final-return-write retry case also passed (21 production
  cases verified). This includes actual installed-PWA and ordinary Chrome
  process restarts while local Tagger holds saved edits.
- Four production routing/worker unit checks and whitespace checks passed.

No #497 issue closure, full cross-platform acceptance, or real OS shutdown test
is implied by these results. Browser tests owned their Chrome profiles/windows;
the user's running Tagger and Admin instances were not reused or stopped.

## Follow-up isolation and recovery verification (2026-10-17)

The batch-isolation, stale-recovery, preparation-control and update-guidance fixes
passed 357 Uploader unit tests, 294 Tagger unit tests, four production
server/worker checks, and all 24 production Google Chrome checks on isolated
port 5337. Both apps passed TypeScript checks and production builds. The Chrome
suite includes ordinary-browser and installed-PWA restarts, simultaneous-window
vocabulary isolation before/after file selection, multiple saved-batch recovery
choices, and update waiting while an unrelated family-scope document remains open.
Sixteen delayed-recovery cases cover Disconnect, account switching, replacement
batches and Start over across journal and Flip handle/reselection paths. Focused
unit coverage also verifies batch-specific return inputs and failure-safe legacy
journal migration. These results do not close or implement #497's separate
acceptance matrix.

## Final-review regression fixes (2026-10-17)

Flip reselection captures the batch/connection guard before opening native or
fallback input pickers, so a sibling-tab Disconnect while the picker remains open cannot restore
the discarded batch. The species panel refreshes on batch-token changes and
reads the bound snapshot rather than substituting the shared selected cache.
A recovered unprepared batch keeps tagging disabled with its explanation and
online preparation controls available.

Journal discovery reports damaged/unsupported records separately and preserves
them while listing healthy batches. Flip return validates only matching journals;
an unrelated damaged journal cannot block it, while a damaged matching journal
remains an explicit recovery error.

Verification: 363 Uploader unit tests, 294 Tagger unit tests, both TypeScript
checks, the Uploader production build, four server/worker tests, and all 28
production Google Chrome cases passed on isolated port 5337. Four permanent
browser regressions cover recovered prepared/unprepared status, Disconnect
during the OS picker, and healthy recovery/Flip return alongside an unsupported
journal. The deferred-recovery unit matrix also includes the picker boundary
and cancellation. The initial browser run passed 27 cases and exposed an
incorrect “Drop” test label; after asserting the actual “Files” label, the full
28-case run passed. Issue #497 remains separate.

## Fallback input-picker scope (2026-10-17)

Both Flip return and saved-preparation recovery capture the batch/connection
guard synchronously before clicking the fallback file input. The input change
callback consumes that opening-time guard before scanning or adopting files.
Preparation recovery also retains the specific saved record selected when the
picker opened. Cancelling does not start recovery; reopening captures a fresh
guard, including after an account change rejected the previous selection.

Six permanent production Chrome cases cover individual-file Flip return,
directory-input Flip return and directory-input preparation recovery. Each path
covers cancellation followed by normal recovery, stale selection after account
replacement, and a fresh explicit retry. The test harness can disable File
System Access independently of its phone-shaped/no-directory-picker fixture.
Directory cancellation sends an empty input result through Chrome's DOM protocol
because Playwright's directory-input wrapper rejects an empty list.

Verification: all 363 Uploader unit tests, the Uploader TypeScript check and
production build, and the complete 34-case production Chrome suite passed on
isolated port 5337. This remains #498 regression coverage; #497's separate
acceptance matrix and manual computer-restart testing are unchanged.

## PR #562 recovery and journal review fixes (2026-10-17)

Saved preparations now offer individual-file reselection as well as folder
reselection where supported. Relative paths are preserved rather than guessed
from basenames; path, size and hash verification still precede adoption. A
successfully verified saved or newly selected directory handle is retained in
the recovered batch and journal for subsequent local Tagger access. File-input
recovery clears any old, unverified handle.

Settings Disconnect counts saved, unsupported and pending/failed preparation
journals as well as resumable uploads. Its confirmation supports Cancel, Escape,
review and explicit discard; cancellation retains work and restores focus to
Disconnect. Explicit discard still drains journal writes before clearing storage.

The journal keeps one active write and only the latest pending snapshot per
batch. Serialization occurs when a write starts, avoiding a growing backlog of
whole-batch thumbnail copies. Flush waits for the latest accepted state; failures
remain visible across other batches' successes, retries preserve batch ownership,
and deletion supersedes obsolete writes without resurrection.

Permanent regressions cover phone-shaped and desktop individual-file recovery,
same-size content changes, saved/unsupported/unsaved Disconnect warnings,
Cancel/Escape/review/discard, and verified handles across another reload followed
by original image loading and actual video playback. Queue tests hold a write
while 1,000 updates arrive and exercise independent batches, retries and deletion.
The video fixture is a generated one-second green H.264 clip, not user media;
only the folder-picker result is replaced, using real Chrome OPFS handles and
production IndexedDB serialization. This does not replace #497's manual platform
and OS-restart acceptance.

Verification: 370 Uploader unit tests, 31 Flip unit tests, four production
server/worker checks, Uploader TypeScript and production build, and all 43
production Google Chrome cases passed on isolated port 5337. The expanded suite
includes three existing Settings/header Disconnect scenarios. Their production
S3 fixture now exposes digest metadata headers for cross-origin verification;
this fixes the fixture without weakening real-upload verification. Browser tests
owned independent Chrome profiles; the user's Tagger/Admin servers were untouched.

## PR #562 Disconnect test lifecycle follow-up (2026-10-17)

The CI failure completed the guarded-Disconnect assertions but hung during
Chrome context teardown. Settings steps now register a load wait before the
immediate Disconnect or confirmed discard, and finish the post-cleanup reload
before reading storage or ending the scenario. Ledger readers await transaction
completion and close their IndexedDB connection in `finally`, including missing
stores and failed reads. Four isolated Chrome regressions verify that database
deletion is not blocked after success, missing stores, read failure or abort.

Verification: all three Disconnect scenarios passed three consecutive runs
(nine cases); the complete production Google Chrome suite passed all 47 cases
on isolated port 5337, including full context teardown and browser/PWA restarts.
This follow-up changes the test harness and documentation only.

## PR #562 picker coexistence follow-up (2026-10-17)

New-upload folder/file inputs and saved-preparation recovery inputs have distinct
purpose-specific labels. The shared new-upload helpers select their exact inputs
instead of the first file input on the page. Recovery guards remain unchanged.
Two production regressions select a fresh batch alongside an existing recovery
panel, assert the original journal is untouched, and then explicitly recover the
original batch. Both directory and individual-file selection are covered.

Verification: the previously failing drag-versus-dialog scenario passed three
consecutive runs; all 170 Uploader BDD scenarios and all 49 production Google
Chrome cases passed. Uploader TypeScript and production build passed, and the
coordinated offline release was regenerated. The full BDD run used a temporary
local configuration selecting actual Google Chrome on port 5338; production ran
on port 5337. Test outputs were separate, and the temporary configuration was
removed after the runs. No user's existing browser window or app server was used.

## Main integration — October 20, 2026

Merged main through `ac6e694`. Retained preparation/species readiness alongside
required assignment comments, moved the guarded local-tagging action to main’s
Verify header, and retained both Settings cleanup and remembered-login guidance.
Local Tagger retains main’s accessible retry, blank-identity return and immediate
duplicate-submission guard alongside offline thumbnail and storage-error states.
Updated offline fixtures for Choose/Verify labels and the enabled Done action.

Preparation journals now also save mountain range, date collected and the frozen
upload-comment preview date. Recovery and Tagger return restore those fields;
legacy journals clear them instead of borrowing another batch’s values. Unit
coverage checks round-trip and legacy behavior; the real offline restart case
checks required fields after recovery and local tagging/return.

Validation: both application TypeScript checks and production builds passed;
all 49 production Google Chrome cases passed on port 5349, including real browser
and installed-PWA restarts. All 13 local Tagger Chrome cases passed on port 5350.
The 74 focused Uploader cases passed across the initial 73 successes and the
corrected Settings security-explanation rerun on port 5351. All 306 Tagger unit
tests and four production server/worker checks passed. A Uploader performance
threshold exceeded its budget while concurrent Chrome suites were running;
all 409 Uploader unit tests passed on a separate rerun after browser completion
(the 17,000-file check completed in 1.09 seconds against its 2-second limit).

PR #565’s preparation-ownership cleanup remains on that separate branch. It
still needs to be rebased after this integration; these changes do not replace
its acceptance work or the separate manual/platform boundaries of #497.

### CI viewport regressions after integration

The Uploader BDD job reported five deterministic viewport failures. The new
preparation panels pushed the unfinished-upload notice below the phone viewport;
it now appears before the preparation controls on Choose. The virtual-list
preview regression now scrolls the list into view before scrolling its contents,
while retaining the existing focus, virtualization and scroll-preservation checks.

Reproduced the CI failures in independent Google Chrome. The five targeted cases
passed after the fixes; the complete 217-scenario Uploader BDD suite then passed
without retries on isolated port 5352 (10.4 minutes). TypeScript and diff checks
passed. The temporary Chrome test configuration was restored.

### Partial recovery retains the whole preparation

A mixed folder now restores verified files with their saved species counts and
Tagger attribution. Missing files and size/hash mismatches remain explicit error
entries with no usable bytes; their expected hashes, tags and Inspect metadata
stay in the same journal. Inspect lists the recovery problems and offers original
folder reselection. Upload and local Tagger handoff stay blocked until the
unavailable originals are recovered or explicitly removed. Reloading and retrying
recovery does not discard those records. The same behavior covers Tagger returns
and saved directory handles.

Verification: all 415 Uploader unit tests, 217 standard browser scenarios and 50
production offline scenarios passed without retries, including mixed-file reload
and retry coverage. Uploader TypeScript, production build and all four production
server/worker checks passed. PR #565 retains its separate ownership cleanup fix
and is rebased onto this corrected head.
