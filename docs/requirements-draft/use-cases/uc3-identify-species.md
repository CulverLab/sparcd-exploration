# DRAFT — for review. Generated 2026-08-06.

Covers stories **H1, H2, H3**, including the path where an upload already
carries identifications and the identifier is confirming prior work.

---

## Title

**Identify and confirm the species in an uploaded batch of images**

## Primary Actor

Species identifier (Harold) — works from a small, low-powered laptop, reviews
large numbers of images, and both tags new uploads and validates existing
identifications.

## Goal in Context

An upload is available for identification. The identifier works through its
images, zooming in where needed, assigning one or more species to untagged
images and confirming, correcting, or removing identifications that are already
there. Everything he does is attributed to him and visible to others with
access.

## Scope

SPARCd (system under design).

## Level

User goal.

## Stakeholders & Interests

| Stakeholder | Interest |
| --- | --- |
| Species identifier | See enough detail to be sure; move through many images without fighting the tool; not redo work already done. |
| Uploader | The batch they uploaded gets identified, and their own offline tags are respected rather than silently replaced. |
| Prior identifier | Their earlier identifications are reviewed, not overwritten without a record. |
| Collection lead | Identifications are attributed, corrections are traceable, quality is reviewable. |
| Project / researchers | Species data reflects a real review by a named person, with multi-species images represented fully. |
| Sensitive-species stewards | Identifying an image does not, by itself, reveal a protected location (M1). |

## Preconditions

- The identifier is authenticated and has identify permission on the collection.
- A completed upload exists in that collection (UC1 success guarantee).
- The administrator has configured the species list available to the collection.

## Trigger

The identifier opens an upload to work on — typically after the announcement
from UC1 step 14.

## Main Success Scenario

1. The identifier selects a collection and an upload to work on.
2. SPARCd confirms identify permission and opens the upload, showing how many of
   its images are untagged and how many already carry identifications.
3. SPARCd displays the first image fitted to the screen, together with any
   identifications already on it — species, counts, and who recorded them.
4. The identifier zooms into the image and pans around the enlarged view to
   examine small, distant, or partly hidden animals.
5. For an untagged image, the identifier assigns one or more species, with a
   count for each.
6. For an image that already carries identifications, the identifier confirms
   them as correct.
7. SPARCd saves the result — new identifications attributed to the identifier,
   confirmations recorded as a review by the identifier, with the original
   identification and its author retained.
8. The identifier moves to the next image; SPARCd displays it fitted to the
   screen, without carrying over the previous image's zoom and pan.
9. The identifier repeats steps 4–8 through the upload.
10. SPARCd shows the upload's identifications as saved and visible to everyone
    with access to the collection, each attributed to whoever recorded it.

## Extensions

**2a. The identifier lacks identify permission on the collection.**
&nbsp;&nbsp;2a1. SPARCd refuses access to the upload. No image data and no
location data is shown. *(M2: refused, not partially honored.)*

**2b. The upload contains sensitive-species material.**
&nbsp;&nbsp;2b1. The identifier sees the images and can identify them, but
precise locations are withheld unless he is explicitly authorized for them.
Identify permission alone does not grant sensitive locations (M1).
&nbsp;&nbsp;**OPEN QUESTION — permission model.** Which permission grants
precise locations, and whether it is per-collection or per-location, is not yet
defined. See `NOTES.md`.

**3a. The image already carries identifications made offline by the uploader.**
&nbsp;&nbsp;3a1. They are shown with their author, exactly as any other existing
identification, and follow the step 6 confirm/correct/remove path.

**4a. The image is too dark, blurred, or ambiguous to identify.**
&nbsp;&nbsp;4a1. The identifier leaves it untagged and moves on; it remains
marked untagged and available for someone else. Partial progress through an
upload is never lost.

**5a. More than one species is present in the image.**
&nbsp;&nbsp;5a1. The identifier assigns each species present; the image carries
all of them.

**5b. The species is not on the configured list.**
&nbsp;&nbsp;5b1. The identifier cannot invent one. The species list is
administrator-controlled (J1); requesting a new species is a separate path.

**6a. An existing identification is wrong.**
&nbsp;&nbsp;6a1. The identifier corrects it. SPARCd records the correction, who
made it, and when, and retains what it replaced. The original identification is
not silently overwritten (M2).

**6b. An existing identification should not be there at all.**
&nbsp;&nbsp;6b1. The identifier removes it. SPARCd records the removal and who
made it, and retains the removed identification as history rather than erasing
it (M2).

**6c. The identifier disagrees but is not confident enough to correct.**
&nbsp;&nbsp;6c1. Out of scope here — this is the "ask an expert" path (stories
HA1–HA3), not yet drafted as a use case.

**7a. Saving fails (connection lost).**
&nbsp;&nbsp;7a1. SPARCd reports the failure and does not show the identification
as saved. Work already saved is unaffected; the identifier is never left
believing an unsaved identification was recorded.

**8a. The identifier reaches the end of the upload.**
&nbsp;&nbsp;8a1. SPARCd reports how many images were identified and how many
remain untagged.

**9a. The identifier stops partway through.**
&nbsp;&nbsp;9a1. Everything saved so far remains saved and attributed. The
upload shows the remaining untagged count so the next session — or the next
person — can pick it up.

**9b. Another identifier is working on the same upload at the same time.**
&nbsp;&nbsp;**OPEN QUESTION — concurrent identification.** Whether two people
may work the same upload simultaneously, and what happens when both touch one
image, is undecided. See `NOTES.md`.

**9c. The identifier's session ends while working.**
&nbsp;&nbsp;**BLOCKED ON A PENDING DECISION.** Session-lifetime stories are
still DRAFT. What happens to in-progress, unsaved work at logout cannot be
specified yet. See `NOTES.md`.

## Success Guarantees

- Every identification the identifier made is saved, attributed to him, and
  visible to others with access to the collection.
- An image carries all the species present in it, each with its count.
- Existing identifications the identifier confirmed carry a record that a review
  took place and by whom.
- Corrections and removals are recorded with their author, and what they
  replaced is retained.
- Images left unidentified remain marked untagged and available.

## Minimal Guarantees

- No identification is presented as saved unless it was.
- No prior identification is destroyed or silently overwritten; every change is
  traceable to a person.
- Work saved before an interruption survives it.
- An identifier without permission on a collection sees none of its images,
  identifications, or locations.
- Identifying an image never reveals a protected location to someone not
  authorized for it.

## Non-functional requirements

Requirements the BDD scenarios for these stories cannot carry.

### Performance

- **NFR-3.1** (H1) Zoom and pan stay responsive on a small, low-powered laptop —
  interaction tracks the input without perceptible lag on typical camera-trap
  images.
- **NFR-3.2** (H1) The next image is ready to examine fast enough that a long
  review session is not paced by loading.
- **NFR-3.3** (H2) Assigning a species and moving on takes few enough actions to
  sustain hundreds of images in one sitting.
- **NFR-3.4** (H1) Image detail is legible well beyond fit-to-screen size —
  zooming reveals real resolution, not an upscaled preview.
- **NFR-3.5** (H1, H2) Performance holds on a modest home connection, not only
  on a fast campus link.

### Security

- **NFR-3.6** (M1) Precise sensitive-species locations are absent from every
  view, export, image metadata, and file path reachable by an identifier not
  authorized for them.
- **NFR-3.7** (M2) Every identification, confirmation, correction, and removal
  records its author and time, and that record cannot be altered by the person
  who made it.
- **NFR-3.8** (M2) Actions outside the identifier's permissions are refused
  outright, with no partial effect.

### Reliability

- **NFR-3.9** (H2, H3) A saved identification survives loss of connection,
  browser or application restart, and machine restart.
- **NFR-3.10** (M2) Correction and removal history is retained for the life of
  the data, not trimmed to save space.
- **NFR-3.11** (H3) Existing identifications shown to a reviewer are the current
  ones — a reviewer never confirms a stale value.

### Usability

- **NFR-3.12** (H1) Zoom state resets between images so the identifier is never
  disoriented by an inherited view.
- **NFR-3.13** (H3) Existing identifications, their counts, and their authors
  are visible without extra navigation, so confirming is genuinely cheaper than
  redoing.
- **NFR-3.14** (H2, H3) The difference between untagged, newly identified, and
  reviewed-and-confirmed is obvious at a glance.
- **NFR-3.15** (H1) The interface is usable on a small screen without horizontal
  scrolling or hidden controls.
