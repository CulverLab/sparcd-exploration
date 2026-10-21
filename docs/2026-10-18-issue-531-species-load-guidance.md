# Species loading guidance after Browse footer removal (#531 / PR #566)

The Browse collection rail omits species loading text, counts, skipped-entry
counts and source bucket/key diagnostics. Collections and uploads remain usable
while a species request is pending or fails.

The species panel distinguishes loading, failed initial loading, failed refresh,
and an empty successful list. A failed load gives connection/access guidance and
Retry, without exposing raw SDK errors or storage paths. A failed refresh keeps
previously loaded species available and explicitly says so. The change does not
alter collection/settings source precedence, reconciliation, or local tagging.

Retry is reachable by Tab. Native Enter and Space activation are scoped to the
button so the Overview Enter shortcut cannot open Focus instead. During retry,
the button remains focused and aria-disabled; a status announces progress. A
failed attempt restores the error and keeps Retry focus. Success moves focus to
the species filter only if the user is still on Retry. The same panel behavior
works in Overview and the Focus modal.

## Regression coverage

- Browse diagnostic-footer absence during pending, successful and failed reads.
- Collection/upload availability across those states, plus successful loading.
- Initial denied read, persistent retry failure, then real source recovery and
  usable species application in Overview and Focus.
- Actual Tab navigation, Enter activation, Space activation, pending status,
  aria-disabled state, retained retry focus and successful filter focus.
- Existing stale-refresh coverage now asserts the refresh error and retained
  cached list. Existing source reconciliation and local-batch checks remain.
- Mock GET gates hold pending requests until assertions complete, avoiding
  timing-dependent loading assertions.

Validation:

- 294 Tagger unit tests passed; TypeScript and production build passed.
- All 78 focused Browse, H2 species-assignment and local-batch BDD scenarios
  passed (2.3 minutes).
- The final six footer/loading/retry/cached-refresh scenarios passed again after
  strengthening the real Tab/Enter/Space assertions and pending-request gates.
- Diff whitespace checks passed.

Tests used actual Google Chrome in independent sessions on isolated port 5339;
the user's browser windows and existing app servers were not reused. The full
Tagger BDD suite was not rerun for this update.

## Main integration — October 20, 2026

Merged main through `ac6e694`. Resolved overlapping test definitions by retaining
main’s collection-ID tooltip and count-preview coverage, retaining this PR’s
cached-species refresh guidance, and removing obsolete diagnostic-footer steps.
The runtime Browse and Tag changes merged automatically.

Validation: all 306 Tagger unit tests, TypeScript and production build passed.
All 97 focused Browse, H2 species-assignment and local-batch BDD cases passed
without retries in independent actual Google Chrome on isolated port 5354
(2.1 minutes), including retry keyboard controls, footer absence, inherited
count-preview behavior and local save recovery. Temporary Chrome configuration
changes were restored; diff checks passed.

### Integration after Browse columns and filtering merged

Merged main through `bb94d25` (including #563/#564). Retained both the species
loading/retry definitions and the newly merged free-text upload filter definitions
at their shared insertion point. Runtime changes merged automatically.

All 43 combined Browse scenarios passed without retries in independent actual
Google Chrome on isolated port 5356. All 347 Tagger unit tests, TypeScript,
production build, BDD generation and diff checks passed. The temporary Chrome
configuration change was restored.
