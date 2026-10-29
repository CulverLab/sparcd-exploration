# Offline acceptance evidence (#497)

This branch extends #498's production harness and fixes the preparation-cleanup
ownership bug inherited from PR #562. The fix is made only in PR #565; PR #562
remains unchanged. #497 stays separate from #498.

## Automated requirement mapping

| Requirement | Evidence in `apps/sparcd-uploader/` |
| --- | --- |
| Loaded-page first offline Inspect | Existing production F1-2 scenario |
| Ordinary-browser offline reload/cold reopening | `e2e/production/offline-apps.spec.ts`, `offline-restart.spec.ts` |
| Installed PWA cold launch and local tagging | `e2e/production/pwa.spec.ts`: real Chrome installation/standalone window, process restarts |
| No uncached first-ever offline promise | `offline-apps.spec.ts`: uncached visit fails, online recovery works |
| Missing species after cold reopening | `missing-species-restart.spec.ts`: browser and PWA; recover Inspect without taxonomy defaults, accessible disabled-tagging explanation, online species repair without changing inspected files, then offline local handoff |
| Prepared vocabulary isolation and failure handling | Existing `features/prepared-species.feature`, preparation/recovery production regressions, source-selection unit tests |
| Species/count persistence after restart and return | `offline-restart.spec.ts`, `pwa.spec.ts`: change Coyote count to 3 through UI, wait for durable write, restart local Tagger, verify count, return and publish |
| Safe reselection | Existing changed-original rejection, individual-file/folder fallback and real OPFS handle recovery tests |
| Reconnect through Assign and publication | Both lifecycle tests use `acceptance-helpers.ts`; verify one completed upload, one media/observation row, correct linkage/timestamp/species/count/person, completed ledger and removed Flip handoff |
| Online-only boundaries | Both lifecycle tests assert disconnected Assign connection gate with announced explanation; standalone Tagger shows an alert and Uploader recovery link |
| Production network/process integrity | Real built Uploader/Tagger and coordinated worker; no app-asset response mocking; real blocked-network probes; independent Chrome processes destroyed/relaunched with profiles retained between lifetimes |
| Reachable network but unreachable storage | Remains #458's status contract. Existing upload failure handling is retained; #497 does not redefine reachability |

The production S3 fixture exercises the real upload pipeline without writing to
live storage. Exactly-one assertions cover this journey; they do not claim to
prove every retry/deduplication case, which retains its existing coverage.

## Test environment and commands

Base: #498 / PR #562 commit `3cff734`. Acceptance tests use independent headless
Google Chrome 155.0.8059.80 profiles on macOS 27.0.1 ARM64. Both ordinary-browser
and actual installed-PWA modes run on isolated port 5337; user browser windows
and existing app servers are not reused.

From the Uploader app directory, after building both apps and generating the
coordinated offline release:

```sh
PRODUCTION_TEST_PORT=5337 ./node_modules/.bin/playwright test --config playwright.production.config.ts
node --test e2e/production/server.test.mjs ../../scripts/offline/worker.test.mjs
```

Initial acceptance validation on 2026-10-18 (before the ownership follow-up):

- Full production Chrome suite: **51 passed (2.8 minutes)**, no retries,
  including all four new/strengthened acceptance journeys.
- Production server and worker checks: **4 passed**.
- Uploader and Tagger TypeScript checks and production builds passed.
- BDD delta against the #498 parent: no feature or application-source changes.
- Diff whitespace check passed.

During test development, an unsupported UTC selector fixture was replaced with
America/Phoenix, and thumbnail comparisons were synchronized across remounts.
The initial full run above includes both test corrections. That initial commit
changed no production code; the ownership follow-up below does.

## Remaining manual verification — not completed by automation

Record release/commit, OS/version, Chrome/version, device, browser versus installed
PWA, preparation time, original-file location, outcome and any failure artifact.
Record untested platforms as **not tested**, not passed. These checks establish
results for tested platforms only; they do not add a promise for every browser.

1. On a supported real device, prepare both apps and a collection's species
   online. Install the PWA for the PWA run; also run the ordinary browser without
   requiring installation. Use a small known image/video batch and retain the
   original files externally to the browser profile.
2. Inspect, tag a species, change its count, and save/return. Record the filename,
   capture time, species, count and attribution as a baseline.
3. Fully shut down the computer. Disable network connectivity before starting
   the browser/PWA again (do not warm either app online). Open the deployed app
   from the saved URL or installed launcher. Repeat independently for browser
   and PWA; automated process closure is not a substitute for this step.
4. Verify the shell and saved batch load. Exercise the real OS folder/file
   picker and permission prompts. Cancel once, then reselect the correct files;
   confirm thumbnails are not mistaken for available originals. Also try a
   changed original and verify safe rejection with no loss of the saved work.
5. Confirm capture metadata, species/count and attribution survive; open original
   image/video media after access is restored. Complete local tagging and return.
   Verify Assign and standalone collection Tagger remain unavailable offline,
   with understandable keyboard/screen-reader guidance.
6. Reconnect, authenticate as necessary, Assign and upload to an approved test
   destination. Check media.csv, observations.csv, UploadMeta.json and publication
   state: one intended upload, unchanged media/capture data, correct location,
   count/person and no duplicate records or resumable completed upload.
7. Repeat device-specific recovery paths where file handles are unavailable or
   permissions are lost. Record mobile/tablet installation, launch and picker
   behavior separately if those platforms are in the supported release matrix.

## Closure gate

Link the automated run evidence and completed manual records to #497. Until the
real computer-restart and supported-platform results are recorded, #497 remains
open. This document is not an assertion that those manual checks passed.

## Preparation cleanup ownership follow-up (PR #565 only)

Greptile identified a data-loss bug inherited from PR #562: saving batch B,
resuming older upload A from History and finishing A could delete B's recovery
journal. PR #562's branch/head remains unchanged; this correction belongs to
PR #565.

Fresh uploads capture the current preparation ID into their upload session and
snapshots. Resumes use only the saved session's owner. Legacy sessions without an
owner do not guess one from the current files. Cleanup runs once on the real
publication-completion transition and queues deletion behind that owner's saves.
It does not delete unrelated preparations or repeatedly act on a lingering done
snapshot. The optional local-ledger field needs no IndexedDB schema migration
and does not change S3 object or CSV formats.

Unit coverage checks unrelated/legacy History completion, matching completion,
dry run, failure/cancellation, repeated done notifications, later edits/batches,
in-flight saves and resume-owner persistence. The two History ownership unit
regressions fail against the original journal (B becomes null) and pass with the
fix. Production Chrome tests create a failed A through the UI, save B with notes
and prepared species, finish A through History, reload and recover B unchanged.
Both owned and legacy A sessions are covered. Browser and PWA lifecycle checks
also assert that publishing the owned batch removes its own preparation.

Ownership follow-up validation:

- 380 Uploader unit tests passed, including 10 new ownership cases.
- All 53 production Google Chrome checks passed (4.4 minutes), no retries.
- The four focused History/browser/PWA checks also passed independently.
- Four production server/worker checks passed.
- Both applications' TypeScript checks and production builds passed.
- Full standard Uploader BDD: 170 passed (10.4 minutes), independent Google
  Chrome on port 5338, no retries.
