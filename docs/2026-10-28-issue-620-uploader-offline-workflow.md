# Uploader offline workflow (#620)

The Uploader flow is credentials or Login Later, select/inspect files, and
optionally tag species. Describe and upload require connectivity and available
destination data. Standalone Tagger remains online-only; the existing shared
local-batch tagging implementation is retained for Uploader's optional feature.

## Automatic readiness

Uploader downloads and verifies its coordinated application release automatically
on the production login screen and after reconnecting. The existing exact-asset
worker cache, content verification, failed-install rollback and deferred update
activation remain in place. Login does not gate application-file availability.
The preparation panels and their buttons are removed from Choose and Inspect;
only actionable download failures and staged updates produce readiness notices.
No original media, credentials, or S3 responses are added to application caches.

With credentials and a connection, Uploader automatically reads the master
`Settings/species.json` without choosing a collection. Validated, non-secret
catalog snapshots use the existing vocabulary database; failures and malformed
or empty downloads retain the last good snapshot. Login Later can use that
cached master list. A new batch may acquire a catalog when one becomes available,
but an existing valid batch snapshot is immutable. Legacy collection snapshots,
counts, attribution, thumbnails and recovery journals remain intact. Late
connection responses cannot bind a catalog to another batch or account.

Choosing tagging without a usable catalog opens a popup. The user can continue
selecting/inspecting files. Describe is entered only online; losing connectivity
also prevents continuing from Describe with merely cached destination data.

## Official-list validation

Describe checks tags against fresh official destination data. Start upload checks
again before starting a real session or making upload writes, covering rules
changed since Describe. Tagged dry runs skip that network check and remain
available offline because they publish nothing. Every resume path (manual Retry,
History Resume, and automatic reconnect) validates the saved observations CSV
against its saved destination before any resumed writes, including legacy
sessions without file-level tags. A failed check blocks publication, disables
automatic retries, and opens a popup even while viewing History. Saved bundles,
tags, counts, and retryability remain intact. During a resume check, the upload
shows as preparing and offers Cancel. Cancellation releases the run immediately
without waiting for the network response; late success, mismatch, or read failure
cannot write, display a stale warning, or complete the saved upload. Closing a mismatch popup does not bypass validation. All missing
species, including any legacy requested-species entries, require resolution.
Existing tags and counts are never removed by the check. Read failures also
prevent tagged uploads until the official list can be checked.

Issue #621 remains the policy follow-up: collection-specific allowlist versus
Settings master list. Until that decision, official validation keeps the existing
collection-first/settings-fallback lookup. New optional tagging uses only the
Settings master catalog. No new collection-restriction policy is introduced.

## Verification

Unit regressions cover master-only loading, validation before cache replacement,
failed refresh retention, connection guards, non-secret snapshots, immutable
legacy batch binding, and all missing official species. Browser regressions cover
both offline login paths, missing-catalog and offline-Describe popups, real local
tagging, failed refreshes, changes between Describe and upload, retry after
resolution, offline tagged dry runs without network requests or writes, all three
resume paths after an official-list change, repeated blocked retries, successful
retry after list correction, and isolation across windows. Unit regressions also
cover valid, removed, and unavailable official species for saved legacy bundles. Existing production restart, installed
PWA, recovery, quota failure, cache repair and update-safety checks are adapted to
automatic readiness rather than manual preparation actions.

Application tests use mocked S3 and original-file picker fixtures. Production
checks use actual release assets and independently launched browser processes;
they do not constitute a physical computer restart or live-storage verification.

Full-workflow verification before the cancellation follow-up: 486 Uploader unit tests, 238 standard Uploader browser
scenarios, 62 production offline scenarios, and four production server/worker
checks passed. Both application TypeScript checks and production builds passed.
The complete final production run passed without retries and includes both
delayed-validation guards. Tests use independent headless Google Chrome sessions.

Cancellation follow-up: 489 Uploader unit tests and all seven focused production
species-validation scenarios passed, including cancellation before the response
arrives, unchanged saved data, no late writes or warnings, and successful retry.
All 79 affected standard resume/retry and upload scenarios also passed.
Uploader TypeScript and the production build passed again.

PR #623 review follow-up: refreshing the master cache while a batch is selected
now updates the next-batch seed while preserving the current batch's catalog.
A regression selects the next batch immediately after reset to cover the stale
seed race. Offline resume scenarios wait for verified application-cache readiness
before disconnecting, independently of species-cache readiness. All 490 Uploader
unit tests and all 65 production scenarios passed after these fixes, along with
the Uploader TypeScript check, production build, and `git diff --check`.
