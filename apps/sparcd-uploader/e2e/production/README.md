# Production offline checks (#498)

```sh
pnpm --filter sparcd-uploader exec playwright install chrome
pnpm --filter sparcd-uploader test:production:server
pnpm --filter sparcd-uploader test:production:offline
```

The last command builds both apps and generates their coordinated offline release
with `scripts/build-offline.mjs`. `PRODUCTION_TEST_PORT` selects an isolated port
(default 5335); an existing listener is never reused. Both unmodified production
builds are served at their deployed `/sparcd-exploration/uploader/` and `tagger/`
paths. The family-root worker is the generated production worker, not a test
substitute. Unknown assets and Admin/Explorer routes return 404. MIME types,
query parsing, HEAD and path traversal are checked independently. A test-only
HTML probe under the family scope checks unrelated controlled clients; it is
not an Admin or Explorer app substitute.

Tests use actual Google Chrome, fresh independent profiles, real offline network
blocking and persistent-profile browser-process restarts. HTTP responses use
`no-store`, so browser HTTP cache cannot substitute for the service worker.
Application HTML/scripts/fonts and worker requests are never fulfilled by test
routes. S3 uses the existing storage fixture, and folder selection uses the
existing synthetic OS-picker fixture with actual JPEG/MP4 bytes. App records are
created through the UI, not seeded for tests claiming offline readiness.

## Verified workflows

- Existing F1-2 warm-page first offline Inspect and production cross-tool flows.
- Explicit species preparation, collection/settings precedence, denied/malformed/
  empty failures, snapshot isolation from a changing shared account, legacy and
  unsupported snapshots, and current-vocabulary review at online Assign.
- A real inspected batch survives complete Chrome closure before any handoff.
  Chrome restarts with networking already blocked; Uploader loads offline,
  rejects a same-size changed original, recovers the unchanged folder and its
  Inspect state, tags locally, reloads local Tagger, and returns with tags intact.
- Actual Chrome PWA installation and `PWA.launch` after a process restart offline.
  The test chooses Chrome's real standalone-window user preference using CDP
  (CDP installation otherwise defaults to a browser window); it does not emulate
  the display-mode media query. The app window is asserted standalone, inspects
  its first offline batch, opens local Tagger in that window, tags/reloads and
  returns offline. The test app is uninstalled and the temporary profile removed.
- An update missing a required new asset cannot displace a previously usable
  release or pending Inspect work. A complete update waits for the active client
  to close; a separate family-scope document keeps it waiting until it too
  closes. Guidance names all SPARC’d tabs, windows and installed-app windows.
  Reopening activates it without deleting preparation data.
- Worker unit checks cover failed/corrupt installs, eviction/readiness, explicit
  repair, route isolation and bypassing authenticated/signed/S3 requests.
- Production fault injection verifies journal-quota failure/retry, blocked handoff,
  final Tagger-write failure with a retryable Done action, and evicted-asset repair.
- Simultaneous Uploader windows retain separate batch journals and vocabulary
  snapshots, including when files arrive after another window prepares a list.
  Saved-batch recovery offers both records. An unfinished collection picker
  choice cannot strand Tagging when files arrive; the accepted list remains bound.
- Delayed verification cannot resurrect files or inputs after Disconnect, account
  switching, replacement files, or Start over, for both journal and Flip recovery.
  This includes Disconnect while the OS folder picker is still open, before
  verification starts. Six fallback-input cases cover Flip individual files,
  Flip directories and preparation directories: cancellation/reselection, rejection
  after account replacement while the picker is open, and a fresh explicit retry.
  Directory cancellation uses Chrome’s DOM protocol for an empty picker result
  because Playwright rejects an empty directory selection before invoking Chrome.
  Tagger return restores that batch’s inputs; legacy singleton migration retains
  the old record if replacement persistence fails. Recovery refreshes the visible
  vocabulary from the recovered batch; a cached list cannot enable tagging for
  an unprepared batch. Damaged/unsupported journals are reported and retained
  separately, without hiding healthy recovery choices or blocking an unrelated
  Flip return. A damaged matching journal remains an explicit error.
- Journal/unit checks cover quota failure, keeping the previous committed value,
  retry, missing/changed originals, unsupported records, schema migration and
  source/provenance retention. Prepared v2 handoffs are not expired implicitly.

The S3 fixture exposes its digest metadata headers for cross-origin production
requests, matching the CORS contract required by final upload verification.

Ledger-reader regressions verify that success, missing stores, read errors and
aborted transactions release IndexedDB connections by deleting the isolated test
database immediately afterward. Settings Disconnect steps await the actual
post-cleanup reload before asserting records or allowing browser teardown.

Picker coexistence cases keep a saved preparation visible while selecting a
separate new batch, for both directory and individual-file inputs. They verify
that the old journal remains unchanged, then explicitly recover that old batch.
New-upload helpers target the purpose-specific input labels instead of relying
on page-wide input order; recovery inputs retain their opening-time guards.

The production suite also includes the existing Settings/header Disconnect BDD
scenarios and preparation-specific confirmation checks. Individual-file recovery
is exercised with and without the folder API. Durable-handle tests use real
Chrome OPFS directory handles (only the picker result is substituted), persist
and recover them across reloads, then verify original JPEG bytes and playable
H.264 video in local Tagger. The generated clip is documented in
`test/fixtures/README.md`. Synthetic-handle cases explicitly choose the offered
reselection fallback after serialization removes their JavaScript prototypes.

Lifecycle tests own separate traces for each browser lifetime, finalize them
before closure, and attach all traces if any later lifetime fails. CI retains
failure artifacts. Temporary profiles and installed test apps are cleaned up.

## Verification boundary

These are #498 implementation regressions, not completion of #497's independent
acceptance matrix. No real computer shutdown/restart is automated. Installed-app
results are platform-specific; Chrome CDP supports these tests on the tested
host, while other browsers/mobile operating systems need their own #497 results.
No uncached first-ever offline visit is promised. Assign, real upload, and
standalone collection Tagger still require a connection. Full BDD suites remain
separate from this production suite.

## Issue #497 acceptance extensions

Browser and PWA lifecycle tests also edit a species count before restarting,
then reconnect and publish the recovered batch through the real pipeline with
mocked S3. They verify timestamp/linkage, species/count/person, one completed
upload and removal of the handoff record. `missing-species-restart.spec.ts`
covers assets-only preparation followed by cold offline recovery and online
species repair in both modes. These checks run in the existing production CI
job. The requirement mapping and remaining manual computer/device steps are in
`docs/2026-10-18-issue-497-offline-acceptance.md` at the repository root.
