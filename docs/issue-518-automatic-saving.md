# Tagger automatic saving (#518)

Standalone collection Tagger queues completed stored-data actions immediately in
IndexedDB. Network saving starts after 500 ms idle, with a one-second maximum
queueing delay. One coordinator serializes each upload's writes. New actions
accepted during a write retain their own target sets and Undo boundaries.

Count fields finish on blur or Enter. Ctrl/Cmd+S validates the active editor,
finishes it, and flushes or retries accepted work. Invalid input stays focused.
Image and section navigation leave saving active. Upload and collection switches
flush and wait; failures keep the current upload open. Logout and ordinary
account/destination changes wait for pending saves. Credential repair uses the
same account/destination and retains the original action's attribution.

Standalone entry and editing require an online connection. Connection loss pauses
editing and Undo, retains accepted work, and retries on reconnection. Uploader
handoff and offline local-batch tagging retain their existing behavior.

## Stored data and recovery

* Original media and the immutable `.sparcd-tagger-original/` baseline remain
  indefinitely. Automatic save and Undo never overwrite these objects.
* No new per-edit snapshot sets are created. Existing historical snapshot objects
  stay in place; their administrative recovery is outside this user workflow.
* A durable journal retains intended canonical bodies and each write's receipt.
  It clears only after every required write and local acknowledgement completes.
* Old manual Sync and snapshot-restore journal formats remain recoverable.
  Unscoped pre-upgrade work requires explicit adoption for the connected account.
  A receiptless legacy operation resumes its exact writes first, then requires
  review of any retained edits. Compatibility retirement belongs to #519.

This replaces #372's former per-edit snapshot/restore workflow while retaining
its original-data guarantees. It retains #371's original attribution and audit
history, including attributed reversals. Dependencies incorporated into this
branch are #592 (identity, with #590 attribution) and #594 (Need expert, with
#593 and #575).

Saving appears when work is accepted. Saved means all required remote writes
completed. Pending/reconnecting and Save failed take precedence. Retry resumes
the retained flight. A conflict never blindly retries stale writes: compare the
retained affected values with current storage, then explicitly discard or reapply.
The conflict reason is durable: reload and reconnect retain this recovery choice. Partly written canonical files may appear
in storage during recovery; saving is not an atomic multi-object transaction.

## One-level Undo

Undo belongs to an account, destination, collection, upload and browser. The
latest editing action replaces it, including when several actions share a
network flight. A bulk action retains its original targets. Undo survives reload
and consumes its record only after the entire reversal commits. Failed reversals
resume idempotently. There is no application Redo or cross-browser Undo.

Undo checks affected values, reverses only those values, and preserves unrelated
remote fields and audit history. Conditional writes also catch changes racing
with the reversal. Offline, pending, failed and recovery states disable Undo with
an accessible explanation. Ctrl/Cmd+Z invokes it outside editors; native text
undo/redo remains available inside editors. Escape dismisses the topmost surface
without discarding accepted work.

IndexedDB version checks and browser Web Locks protect journal/Undo consumption
across tabs. A stale tab retains its actions as a recovery branch for explicit
review. This is a narrow safeguard, not editing ownership or a server lease;
#271's broader coordination remains separate.

Pending work registers the browser's unload warning and is durably retained.
Browsers may suppress the warning. Recovery does not depend on an unload network
request. Active upload selection is remembered for same-tab reload recovery. Save acknowledgements retain the active image, selection and open display controls. Credential repair is also available when a reload cannot read canonical files yet.

## Verification

`automaticSaver.test.ts` covers durable action boundaries, bounded debounce,
serialization, recovery, offline state and cross-tab protection. The automatic
saving Chrome feature covers real mutations, stored canonical results, Undo,
partial-write recovery, conflict resolution and #463's stale-clean-draft path.
The full Tagger suite and Uploader/cross-tool regressions remain release gates.

### Completed verification (2026-10-21)

| Gate | Result |
| --- | --- |
| Full configured Tagger BDD, installed Google Chrome | 386 passed, no retries |
| Tagger unit tests | 421 passed |
| Shared Camtrap unit tests and TypeScript | 77 passed; type check passed |
| Uploader unit tests | 405 passed |
| Uploader/Tagger shared-session and handoff Chrome scenarios | 5 passed |
| Built Uploader offline Chrome scenario | 1 passed |
| Tagger and Uploader TypeScript and production builds | Passed |

All browser sessions were independent of the user's Chrome session. S3 writes
were handled by local mock storage; production storage was not modified.

Implementation stages are committed on `feature/tagger-automatic-save-518`:
durable coordinator/Undo foundations; action-safe publication and targeted Undo;
legacy/workflow migration; and reload, credential and workspace safeguards.
No pull request was created.
