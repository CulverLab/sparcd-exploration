# DRAFT — for review. Generated 2026-08-06.

Covers stories **AL1, AL2**. Continues from UC1 extension 11a/11b.

The **Minimal Guarantees** section is the substance of this use case: what
matters most is what remains true when the network never comes back.

---

## Title

**Resume or retry an interrupted upload without creating duplicates**

## Primary Actor

Uploader on an unreliable connection (Alice).

## Goal in Context

An upload that was started has stopped short — the connection dropped, the
machine slept, or the attempt ultimately failed. The uploader wants it to finish
by itself when the network returns, and if it cannot, to retry it to the same
collection and location without re-entering anything and without ending up with
two uploads.

## Scope

SPARCd (system under design), including whatever runs on the uploader's own
machine.

## Level

User goal.

## Stakeholders & Interests

| Stakeholder | Interest |
| --- | --- |
| Uploader | Start it before bed, find it done — or clearly resumable — in the morning; never re-tag or re-enter a location. |
| Species identifiers | One announcement for one upload; no half-uploaded batch presented as ready to tag. |
| Collection lead | Exactly one copy of each batch, at the right location; no orphaned partial data. |
| Project / researchers | No duplicate observations skewing counts. |
| Administrator | Failed uploads leave a diagnosable trail, not silent debris. |

## Preconditions

- An upload was started under UC1 and did not complete.
- The interrupted upload's target collection, per-batch locations, offline tags,
  and source files are still recorded on the uploader's machine.
- The uploader's permission on the target collection is unchanged.

## Trigger

Connectivity returns, or the uploader opens SPARCd and asks to retry an upload
shown as incomplete.

## Main Success Scenario

1. SPARCd detects that an upload is incomplete and shows it as resumable, with
   its collection, location(s), and how much remains.
2. SPARCd detects that connectivity has returned.
3. SPARCd resumes the upload on its own, without the uploader restarting it.
4. SPARCd determines which images were already transferred and verified, and
   sends only the remainder.
5. SPARCd transfers the remaining images and their tags, showing progress.
6. SPARCd verifies that every image in every batch is now stored intact.
7. SPARCd records the upload as complete — one upload, in the collection and at
   the locations originally assigned, with the originally assigned tags.
8. SPARCd announces the completed upload to the identification team exactly once
   (UC1 step 14).

## Extensions

**1a. The uploader is away when the interruption happens.**
&nbsp;&nbsp;1a1. SPARCd continues to retry unattended and leaves the upload in a
state that reads, on return, as either completed or clearly resumable — never
silently stuck.

**2a. Connectivity does not return before the uploader returns.**
&nbsp;&nbsp;2a1. SPARCd shows the upload as incomplete and resumable, with what
remains, and keeps retrying. No announcement is made.

**3a. The uploader asks to retry an upload that ultimately failed.**
&nbsp;&nbsp;3a1. SPARCd retries against the same collection and the same
per-batch locations as the original attempt.
&nbsp;&nbsp;3a2. The uploader is not asked to re-enter a location or re-identify
species already tagged.
&nbsp;&nbsp;3a3. Flow continues at step 4.

**4a. Data already at the destination cannot be verified as matching the
source.**
&nbsp;&nbsp;4a1. SPARCd re-sends those images rather than assuming they are
good. Unverified data is never counted as transferred.

**4b. The source files have moved or the SD card is absent.**
&nbsp;&nbsp;4b1. SPARCd reports which source is missing and keeps the upload
resumable; it does not fail it or discard the recorded collection, locations, or
tags.

**5a. The connection drops again mid-resume.**
&nbsp;&nbsp;5a1. Return to step 1. Repeated interruption never compounds into
duplicate data.

**6a. Verification fails repeatedly.**
&nbsp;&nbsp;6a1. SPARCd stops retrying, reports the failure plainly with what is
and is not transferred, and leaves the upload retryable. It is never recorded as
complete and never announced.

**7a. A previous attempt left partial data at the destination.**
&nbsp;&nbsp;7a1. On completion the destination holds exactly one upload —
leftover partial data from failed attempts is not left behind alongside it and
is not presented as data to tag.
&nbsp;&nbsp;**Note (M2):** clearing a *failed attempt's* partial data must be
distinguishable from destroying *completed* uploaded data, which M2 forbids. The
boundary needs an explicit rule. See `NOTES.md`.

**7b. The uploader's permission on the collection changed since the original
attempt.**
&nbsp;&nbsp;7b1. SPARCd refuses the resume entirely and explains why. Nothing
further is written.

**7c. The uploader's session ended while the upload was unattended.**
&nbsp;&nbsp;**BLOCKED ON A PENDING DECISION.** Whether an unattended overnight
upload survives an idle logout is exactly the question the DRAFT session-lifetime
stories leave open, and AL1 depends on the answer. See `NOTES.md`.

**8a. The upload was already announced by a prior completed attempt.**
&nbsp;&nbsp;8a1. No second announcement is made.

## Success Guarantees

- The upload completes to the same collection and the same per-batch locations
  as the original attempt.
- The destination contains exactly one upload — no duplicates, no leftover
  partial data from failed attempts.
- Species tags assigned before the first attempt are preserved; nothing is
  re-tagged.
- Data already transferred and verified is not sent again.
- Exactly one announcement is made for the upload.

## Minimal Guarantees

Even when the upload never completes:

- **The upload is never in a silent, stuck state.** On returning, the uploader
  finds it either completed or plainly shown as incomplete-and-resumable, with
  how much remains.
- **Nothing the uploader entered is lost.** Target collection, per-batch
  locations, and offline species tags survive interruption, application restart,
  and machine restart, and are reused on retry without re-entry.
- **An incomplete upload is never presented as complete** and never announces
  new data to the identification team.
- **No duplicate data results from any number of interruptions or retries.**
- **Nothing already stored in the collection is destroyed or silently
  overwritten** by a resume or retry.
- **A resume the uploader is no longer permitted to perform is refused
  entirely**, with nothing partially written.
- **Failure is legible**: a permanently failed upload reports what transferred
  and what did not, in terms the uploader can act on.

## Non-functional requirements

Requirements the BDD scenarios for these stories cannot carry.

### Performance

- **NFR-2.1** (AL1) Resume cost is proportional to what remains, not to the size
  of the batch: determining what has already transferred does not require
  re-reading or re-hashing the whole card over the network.
- **NFR-2.2** (AL1) Retry backoff recovers quickly on a flapping link — a
  connection that returns is used within a minute, not after a long fixed wait.

### Security

- **NFR-2.3** (M2) Resume and retry re-check permission at the moment of
  transfer; a stale authorization from the original attempt is not sufficient.
- **NFR-2.4** (M2) Each attempt — including failed ones — is traceable to who
  made it and when.
- **NFR-2.5** (M2) Clearing a failed attempt's partial data is itself recorded,
  and cannot touch data from any completed upload.
- **NFR-2.6** (F4, M1) Locations and tags held on the uploader's machine between
  attempts get the same protection as stored data; unattended overnight state is
  not a leak path.

### Reliability

- **NFR-2.7** (AL1) Upload state is durable across application crash, machine
  sleep, and reboot.
- **NFR-2.8** (AL2) Completion is idempotent: repeated resumes of the same
  upload converge on one stored upload and one announcement.
- **NFR-2.9** (AL1) An upload left unattended for a full night makes progress
  across arbitrarily many disconnect/reconnect cycles without human input.
- **NFR-2.10** (AL1) Transferred data is verified against the source, not
  assumed from a byte count.

### Usability

- **NFR-2.11** (AL1) The morning-after view answers "did it finish?" at a
  glance, without reading a log.
- **NFR-2.12** (AL2) Retry is a single action — no re-selecting the collection,
  the location, or the source.
- **NFR-2.13** (AL1) Failure messages name the cause in plain language and say
  what the uploader should do next.
