# As-built tagger features — review notes

DRAFT — for review, not yet agreed. Generated 2026-08-06 from
`apps/sparcd-tagger` source (P0–P6 complete per its README) and the agreed
story set in `docs/user-stories.md`.

## What these files are

Eleven `.feature` files describing what `apps/sparcd-tagger` **does today**, not
what it should do. Every scenario is traceable to code that exists; nothing
was written from the plan or the README where the code disagrees. Scenarios
that map to an agreed story carry its ID; the rest carry `@unmapped`.

| File | Covers | Tags |
| --- | --- | --- |
| `connect-and-session.feature` | Credential gate, cross-tab session, Settings, disconnect | `@unmapped` |
| `browse-collections-and-uploads.feature` | Collection rail, upload list, progress tallies, entry to Tag | `@unmapped` |
| `H1-examine-images-closely.feature` | Zoom, pan, fullscreen, per-image reset, video, display adjustments | `@H1` |
| `H2-assign-species-to-images.feature` | Species panel, multi-species, Ghost, key bindings, bulk apply | `@H2` |
| `H3-review-existing-identifications.feature` | Existing identifications shown, corrected, removed; attribution | `@H3` |
| `navigate-and-select-images.feature` | Keyboard navigation, sort, find, selection, bursts, cheatsheet | `@unmapped` |
| `local-drafts-and-recovery.feature` | Local drafts, unsaved counts, History recovery, discard | `@unmapped` |
| `sync-identifications-to-the-collection.feature` | Preview, dry-run gate, conflict, snapshot, conditional write, resume | `@H2` `@H3` + `@unmapped` |
| `restore-a-previous-snapshot.feature` | Snapshot listing and restore (supports the M2 constraint) | `@unmapped` |
| `correct-capture-times.feature` | Whole-upload, selection and per-image time correction | `@unmapped` |
| `F4-location-visibility.feature` | What the tool actually reveals about camera locations | `@F4` |

## Coverage against the agreed stories

- **H1 — met.** Zoom to 6× in the pane and 10× fullscreen, drag-to-pan bounded
  to the image, reset-to-fit, and a hard reset of zoom/pan on every image
  change. Responsiveness is addressed structurally (virtualized strip,
  per-image subscriptions, a key handler bound once) but is not measured; the
  "responsive on a small, low-powered laptop" criterion needs a real test on
  target hardware, not a code reading.
- **H2 — met, with one caveat.** Multi-species per image, counts, Ghost for
  empty frames, requested-species free text, per-species keys (including keys
  inherited from `species.json`), and bulk apply across a selection. The
  caveat is attribution: identifications are attributed to a free-text
  "Tagger identity" typed in Settings, stamped into the snapshot path and the
  `UploadMeta.json` edit comment. It is not derived from or checked against
  the credentials used to connect.
- **H3 — partially met.** Existing identifications from any source (Java
  desktop app, sparcd-web, an earlier tagger sync) are shown with counts, and
  can be corrected or removed. **A pure confirmation records nothing** — the
  diff is content-based, so re-applying an identical identification produces
  no change and therefore no "reviewed by / reviewed at" trace. H3's third
  criterion is not satisfied.
- **F4 — not addressed by this tool.** No sensitive-species concept exists
  anywhere in the tagger. Locations are shown to any connected user. Captured
  honestly in `F4-location-visibility.feature` so the gap is on the record.
- **M2 (constraint) — largely supported.** Original files are never destroyed:
  every write is preceded by an immutable snapshot, replacement is conditional
  on the version read, conflicts refuse the write outright, and snapshots can
  be restored. Traceability exists at upload granularity (identity + timestamp
  in the edit comment and snapshot path), not per identification.

## Not covered, because the tagger does not do it

- **F1, F2, A1, A2, AL1, AL2** — all upload-side stories. This app never
  uploads images; it reads uploads that already exist. Those belong to
  `apps/sparcd-uploader`.
- **F3** — no announcement, notification or messaging surface exists.
- **H4, H5, HA1–HA3, JN1–JN2** — no messaging, help-request, expert-hand-off
  or outside-expert path exists.
- **T1–T3, J1–J4** — no permission, user, collection or vocabulary
  administration. The species vocabulary and locations are read-only inputs
  from the settings bucket.
- **FR1–FR3** — no reporting or export surface. Nothing in the tagger produces
  a document, table or file for an audience.

## Ambiguities and things a reviewer should decide

1. **The questionable flag never leaves the browser.** It is stored in local
   drafts, shown as a marker, and toggled per image or across a selection —
   but the sync writes only observations and capture times, so it is never
   published. Its drafts also stay listed as "unsaved" after a sync, because
   only the drafts actually written are cleared. Is a local-only flag the
   intent, or should it become part of the canonical record?
2. **Confirmation of prior work leaves no trace** (see H3 above). If the
   director wants "Harold reviewed this upload on this date", something must
   be recorded that a content diff cannot produce.
3. **Identity is unverified free text.** Anything typed in Settings becomes
   the attribution and the snapshot folder name. Two people sharing a browser
   are distinguished only by remembering to change it.
4. **Dry-run defaults to on, per session.** It is a session preference, not
   persisted; a page reload restores the safe default. Confirm this is wanted
   rather than remembering the last choice.
5. **"Done" in Browse means every image carries a species**, computed from
   the upload's own stored tally. An upload where every image is legitimately
   an empty frame counts as done only if those frames carry the Ghost label.
6. **The Ghost key.** `g` is the built-in key for the Ghost label, but a
   species carrying `g` in `species.json` — or assigned `g` locally — takes
   the key over it, silently. Worth confirming that Ghost should be
   displaceable.
7. **Burst grouping is off by default** ("our cameras shoot no bursts"). With
   it off, the whole upload behaves as one burst for select-all purposes, so
   the select-current-burst accelerator selects the entire upload. Confirm
   that is acceptable.

## Paths noted as possibly unreachable in normal use

Marked with trailing comments in the feature files:

- **Resuming a partially written sync** — only reachable if a write sequence
  is interrupted between files (tab closed, connection dropped mid-sequence).
  The code path and its tests exist; ordinary use will not hit it.
- **A store that does not honour conditional replacement** — depends entirely
  on the S3-compatible backend; not reachable against one that does.
- **Adopting a live connection from a sibling tab** — requires another tab of
  a SPARC'd tool to be open and connected at the same moment.
- **Not documented at all:** the "Tag workspace / choose an upload in Browse"
  placeholder screen. The Tag tab is disabled whenever no upload is selected,
  and clearing the selection routes back to Browse, so the placeholder appears
  to be unreachable. Left out rather than described as behaviour.

## Things verified in code that surprised the reading

- The read path and the write path use **separate clients**; the write-capable
  one is only constructed inside the live-write closures, so a dry-run never
  builds it.
- The version a sync writes against is **pinned once local edits exist** — a
  background refresh cannot advance it — so a change made elsewhere always
  surfaces as a conflict rather than being absorbed.
- A snapshot is only recoverable once its `manifest.json` is written, and the
  manifest is written last. Interrupted snapshots are invisible by design.
- A successful live sync **clears the whole-upload time shift**, because the
  shift has been baked into the stored capture times; leaving it would shift
  them twice on the next sync.
