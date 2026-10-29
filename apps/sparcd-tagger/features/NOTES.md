# Tagger executable coverage

Feature files exercise the standalone collection workflow and the unchanged
Uploader local-batch workflow. All storage writes use the in-process mock S3
fixture. Browser verification uses independent Google Chrome sessions.

| Feature group | Coverage |
| --- | --- |
| `automatic-saving.feature` | Saving/Saved/offline states, in-flight edits, reload Undo, reviews, location reversal, completed/invalid count input, partial-save and Undo retries, explicit conflict resolution, unrelated remote edits, #463, actual cross-tab recovery and duplicate Undo protection |
| `sync-identifications-to-the-collection.feature` | Automatic detag publication, bulk species/time target sets and Undo, shared Need expert and unsupported conditional storage |
| `legacy-save-recovery.feature` | Explicit account adoption and idempotent pre-upgrade manual Sync/snapshot-restore recovery, including a PUT whose local receipt was interrupted; historical objects retained |
| `local-drafts-and-recovery.feature` | Immediate image/section navigation, upload-switch flush/wait/failure, unload-warning registration, logout guard, same-account credential repair and Recovery listing |
| `need-expert-retry.feature` | New actions accepted during an earlier save, partial failure/reload, no lost expert/species/time/removal edits or duplicate audit events |
| `s3-read-errors.feature` | Transient reads recover; permission failures retain actionable diagnostics and credential repair |
| H2, H3 and identity features | Real mutation/save paths, counts, corrections/removals, immutable originals, distinct original/review attribution and per-action identity |
| H1, navigation, display preferences | Examination, responsive layouts, keyboard/popup behavior, image loading and transient display controls |
| Browse and collection visibility | Listing, metadata, filtering, permission/loading states, responsive columns and accessible explanations |
| Location/time correction | Registry-only location selection, targeted correction, timestamp eligibility, bulk targets and automatic publication |
| Classification/expert badges | Grid/List/Focus, coexistence, accessibility, touch, fresh sessions and fullscreen exclusion |
| `local-batch.feature` | No online collection controls, offline tagging, attribution and Done return |

The reviewed #518 policy supersedes manual Sync preview/dry-run and the user
snapshot browser/restore workflow. Their former UI scenarios are replaced by
publication, conflict, Undo and upgrade-recovery scenarios. The legacy planning,
restore and journal unit tests remain: compatibility removal belongs to #519.

Original media and the immutable original metadata baseline remain indefinitely.
Automatic edits and Undo create no per-edit snapshot sets and do not remove
historical snapshots. Journals are recovery state until every required write
completes. Undo changes affected values, retains audit history, is scoped to the
account/upload/browser, and has no application Redo. See
[the policy and implementation notes](../../../docs/issue-518-automatic-saving.md).

Focused unit coverage includes deterministic 500 ms idle/one-second maximum
queueing, action/Undo boundaries, serialization, stale-tab CAS protection,
conditional-write races, preservation of unknown columns, time-source reversal,
legacy journal planning, original baseline guarantees, attribution and #463.
Browser checks cannot promise that an actual browser close displays or honors
an unload warning; they verify registration and durable reload recovery.

The full Tagger BDD run, relevant shared/Uploader units, and cross-tool handoff
checks are completion gates. A successful focused subset does not substitute
for these gates. No production backend is mutated by these tests.
