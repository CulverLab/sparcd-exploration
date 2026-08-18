# DRAFT — for review. Generated 2026-08-06.

Restructured from the wiki use case *"Upload Images - Case 1: New upload only"*.
Branches that were woven into the numbered steps have been moved to Extensions.
Two extensions carry open questions — see `NOTES.md`.

Covers stories **F1, F2, F3, A1, A2**.

---

## Title

**Upload a batch of images from an SD card into a collection**

## Primary Actor

Uploader — a field worker (Frank) or a species identifier who tags before
uploading (Anita). Both act in the same role here.

## Goal in Context

The uploader has one or more SD cards of camera-trap images, possibly already
tagged with species offline. They want every image from each card stored in the
correct collection, tied to the camera location it came from, with any offline
tags carried along, and the identification team told that new data is waiting.

## Scope

SPARCd (system under design), including whatever runs on the uploader's own
machine.

## Level

User goal.

## Stakeholders & Interests

| Stakeholder | Interest |
| --- | --- |
| Uploader | Get a full card in with minimal fuss; know the upload really finished; not have to re-do tagging done offline. |
| Species identifiers | Learn promptly that new untagged data exists, and know which collection, location, and how many images. |
| Collection lead | Every image is attributable to a real, valid location in their collection; nothing lands unlocated. |
| Project / researchers | Uploaded data is complete, located, and never silently altered afterwards. |
| Sensitive-species stewards | Precise locations of sensitive species never leave the authorized circle (F4, M1). |
| Administrator | Locations and species offered during upload come from the configured lists. |

## Preconditions

- The uploader is authenticated and has upload permission on at least one
  collection.
- The administrator has configured at least one valid location for that
  collection.
- The images exist on local storage (SD card or copied folder).
- Any offline species tagging the uploader intends to do is already done.

## Trigger

The uploader has network access and starts an upload for a card of images.

## Main Success Scenario

1. The uploader starts a new upload and SPARCd confirms it is online.
2. The uploader selects the collection to upload into.
3. SPARCd confirms the uploader may upload to that collection and offers the
   locations valid for it.
4. The uploader selects the source folder or SD card for the first batch.
5. SPARCd identifies the image files in the source and reports the count to be
   uploaded, ignoring non-image files.
6. SPARCd reads any species tags the uploader recorded offline and shows how
   many images are tagged and how many are untagged.
7. The uploader assigns a camera location to the batch, chosen from the
   locations offered in step 3.
8. The uploader repeats steps 4–7 for each additional SD card in this upload.
9. SPARCd shows the upload summary — collection, each batch with its location,
   image counts, tagged/untagged counts — and states whether the destination
   protects sensitive locations.
10. The uploader confirms and starts the transfer.
11. SPARCd transfers the images and their tags, showing progress, and verifies
    that every image in every batch arrived intact.
12. SPARCd records the upload as complete: images stored and retrievable in the
    collection, each with the location assigned in step 7, tagged images
    carrying their species, untagged images marked untagged.
13. The uploader adds optional notes for the identification team.
14. SPARCd announces to the people responsible for identifying that collection
    that new data is available, stating the collection, location(s), image
    count, and upload date, plus any notes — and excluding precise locations
    for anything designated sensitive.

## Extensions

**1a. The uploader is offline when starting.**
&nbsp;&nbsp;1a1. SPARCd shows a clear offline indicator and does not begin a
transfer. The uploader may still prepare the upload (steps 2–9) and start it
when connectivity returns.

**3a. The uploader has no upload permission on the selected collection.**
&nbsp;&nbsp;3a1. SPARCd refuses the upload outright and names the missing
permission. Nothing is written. *(M2: out-of-permission actions are refused, not
partially honored.)*

**3b. The collection has no valid locations configured.**
&nbsp;&nbsp;3b1. SPARCd states that the collection has no locations and directs
the uploader to the administrator. The upload cannot proceed to step 7.

**5a. The source contains non-image files (video, thumbnails, system files).**
&nbsp;&nbsp;5a1. SPARCd excludes them, uploads only image files, and reports
what was excluded.

**5b. The source contains no image files.**
&nbsp;&nbsp;5b1. SPARCd reports the empty batch; the uploader chooses another
source or removes the batch.

**6a. No images in the batch carry offline tags.**
&nbsp;&nbsp;6a1. SPARCd accepts the batch and marks every image untagged. The
upload proceeds normally.

**7a. The uploader tries to continue without assigning a location.**
&nbsp;&nbsp;7a1. SPARCd blocks confirmation at step 10 and names each batch
still missing a location. The upload cannot be finalized.

**9a. The uploader is unsure whether the destination protects sensitive
locations.**
&nbsp;&nbsp;9a1. SPARCd states the protection state of this destination before
the uploader commits, per F4.

**9b. Some or all of these images already exist in the collection from an
earlier upload.**
&nbsp;&nbsp;9b1. SPARCd reports the overlap and offers the uploader a choice of
how to proceed.
&nbsp;&nbsp;**OPEN QUESTION — conflicts with M2.** The current wiki use case
offers "replace the previous upload." M2 requires that original uploaded data
cannot be destroyed or silently overwritten and that changes stay traceable. The
available options (add alongside / supersede-but-retain / refuse) and who may
choose them must be decided before this extension can be specified. See
`NOTES.md`.

**10a. The uploader cancels before the transfer starts.**
&nbsp;&nbsp;10a1. SPARCd discards the pending upload. Nothing is stored in the
collection and no announcement is made.

**11a. The transfer is interrupted or fails.**
&nbsp;&nbsp;11a1. The upload is not presented as complete and no announcement is
made. Recovery continues in **UC2 — Resume or retry an interrupted upload**.

**11b. Verification finds missing or corrupt images.**
&nbsp;&nbsp;11b1. SPARCd re-sends the affected images. If verification still
fails, the upload stays incomplete and is handled by UC2 — it is never recorded
as complete.

**11c. The uploader's session ends (idle timeout or logout) mid-transfer.**
&nbsp;&nbsp;**BLOCKED ON A PENDING DECISION.** The wiki use case includes
idle-logout steps here, but the stories governing session lifetime are still
DRAFT. Whether a transfer survives an idle logout, and what the uploader sees on
returning, cannot be specified until that decision is made. See `NOTES.md`.

**14a. The announcement cannot be delivered.**
&nbsp;&nbsp;14a1. The upload remains complete and the data remains retrievable;
SPARCd records that the announcement is outstanding and retries. The upload is
never rolled back because an announcement failed.

## Success Guarantees

- Every image file from every batch is stored in the selected collection and
  retrievable there.
- Each stored image carries the location the uploader assigned to its batch, and
  that location is valid for the collection.
- Species tags recorded offline are stored with their images, attributed to the
  uploader; images without tags are stored and marked untagged.
- The identification team can see that new, untagged data is available, with
  collection, location(s), image count, and upload date.
- No precise location of a sensitive species is exposed to anyone outside the
  collection's authorized members.

## Minimal Guarantees

- A batch that only partially transferred is never presented as a completed
  upload and never triggers an announcement.
- No image is stored without a location.
- No existing data in the collection is destroyed or silently overwritten by
  this upload.
- An upload the uploader may not perform is refused entirely, with nothing
  partially written.
- The uploader is left with an unambiguous state — completed, cancelled, or
  clearly resumable — never a silent, stuck one.

## Non-functional requirements

Requirements the BDD scenarios for these stories cannot carry.

### Performance

- **NFR-1.1** (F1, AL1) Upload throughput is limited by the connection, not by
  SPARCd: overhead per image stays small enough that a full SD card of several
  thousand images completes unattended overnight on a slow rural link.
- **NFR-1.2** (F1) Progress reporting updates often enough that the uploader can
  tell within a minute whether an upload is still making headway.
- **NFR-1.3** (A1) Reading offline tags for a full card completes fast enough to
  keep step 6 interactive — the uploader is not left staring at a blank screen.

### Security

- **NFR-1.4** (F4, M1) Precise sensitive-species locations are absent from the
  announcement, from any notification payload, and from any object name, file
  path, or embedded metadata that an unauthorized user could reach.
- **NFR-1.5** (F4, M1) Location protection is enforced by the system, not by the
  uploader remembering to set it; the protection state is shown before the
  uploader commits.
- **NFR-1.6** (M2) Every upload records who performed it and when, in a form
  that cannot be edited by the uploader.
- **NFR-1.7** (M2) An upload attempt outside the uploader's granted permissions
  writes nothing at all — no partial batch, no placeholder record.

### Reliability

- **NFR-1.8** (F1, F3) "Complete" is a verified state: an upload is recorded
  complete only after every image is confirmed stored and readable.
- **NFR-1.9** (F3) An announcement is emitted at most once per completed upload,
  and never for a failed or abandoned one.
- **NFR-1.10** (F1) Upload state survives an application restart on the
  uploader's machine.

### Usability

- **NFR-1.11** (F1) The offline indicator is visible without hunting for it, and
  distinguishes "no network" from "upload stalled."
- **NFR-1.12** (F2, A2) Location selection presents only valid choices; there is
  no free-text path to an invalid location.
- **NFR-1.13** (F1, A1) The pre-commit summary (step 9) is readable by a
  non-technical volunteer in the field: counts, locations, and protection state
  in plain language.
