<!-- DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md and the SPARCd requirements wiki User Stories page. -->

# Notes on the specification feature files

> **DRAFT — for review, not yet agreed.** Generated 2026-08-06 from
> `docs/user-stories.md` and the SPARCd requirements wiki User Stories page.

These `.feature` files transcribe the agreed acceptance criteria for stories
F1, F2, F3, F4, A1, A2, AL1, AL2, H1, H2 and H3 into reviewable scenarios.
This file records what did **not** fit into a scenario, and why. That residue
is what use cases, non-functional requirements, or a separate policy document
have to carry — it is not covered by the feature files.

## 1. Criteria that could not be expressed as a scenario

### H1 — "Zooming and panning remain responsive on a small, low-powered laptop"

There **is** a scenario for it, but it is not a real acceptance test. It has no
threshold: "responsive" is not binary until someone names a target device class
and a maximum delay (for example, "the view updates within 100 ms of input on
a 4 GB, integrated-graphics laptop at 1366×768"). Until that number exists,
the scenario is only a placeholder for a **performance NFR**. Recommend moving
the real requirement to an NFR and leaving the scenario as a pointer.

Same problem, smaller: "detail becomes clearly legible well beyond the
fit-to-screen size" needs a stated minimum magnification (e.g. 1:1 pixels, or
4× fit-to-screen) before it can pass or fail.

### F4 / M1 — "Location information cannot be recovered indirectly"

Written as a scenario, but it is a **universal negative** over an open set of
channels (metadata, file names, paths, identifiers, aggregates, timing,
neighbouring records, ordering). No finite test proves it. It needs to become a
security requirement with a defined threat model and a review or pen-test
procedure, plus a stated definition of "precise location" versus the coarsened
location that unauthorized users *may* see. The scenarios listed under F4 are
the observable checks that can be automated; they are not the whole guarantee.

### F4 — "A single compromised or malicious account cannot expose sensitive locations beyond that account's authorized scope"

Expressed as a scenario, but it is an architectural property (authorization is
enforced at the data boundary, not the view), not something a behavioural test
demonstrates. Belongs in a **security architecture requirement**.

### F4 / M2 — "Original uploaded data cannot be destroyed or silently overwritten; changes are traceable to who made them"

Partly expressed (see F4 and H3). What cannot be expressed as user-visible
behaviour is the **retention and audit requirement** itself: how long originals
are kept, what an audit record must contain, who may read it, and whether it
too is immutable. That is an NFR plus a data-retention policy.

### F1 — "The upload can be started without a continuous connection during capture"

Scenario written, but the meaningful part is the **absence of a dependency**,
which no positive test observes directly. It really constrains architecture:
capture and preparation must work fully offline. Recommend an explicit
"offline-first" architectural constraint alongside the scenario.

### AL1 — "never in a silent, stuck state"

The scenario checks that a stopped upload says so. What it cannot check is the
timeliness — how long an upload may make no progress before it must declare
itself stopped. That threshold is an NFR.

### H2 / H3 — "visible to others with access"

Scenario written, but propagation delay is unstated: immediately, within
seconds, on next open? Needs a **consistency/latency NFR** before this is
testable.

## 2. Criteria deliberately not turned into scenarios here

- **F4's "the protection state is clear to Frank before he commits"** is
  transcribed, but *how* the protection state is determined (which species and
  which locations are sensitive, and who decides) comes from Story J1
  (administrator configures sensitivity). J1 is outside this batch, so the
  feature files assume sensitivity designations already exist.
- **M1 and M2 in full.** The brief asked for eleven story files, not misuse-case
  files. The observable guarantees from M1 and M2 that a legitimate user could
  check are folded into `F4-protect-sensitive-species-locations.feature`
  (`@security`). The adversarial framing, the threat model, and the
  law-enforcement / border-patrol open questions (M3, M4) are **not** covered
  by any feature file and still need their own treatment.

## 3. Scenarios that go beyond the agreed criteria

These are tagged `@unmapped` in the feature files. They read as obviously
correct behaviour but no agreed criterion states them, so they need the
project director's confirmation before being treated as requirements:

| File | Scenario | Why it is unmapped |
| --- | --- | --- |
| `A1-tag-species-before-upload.feature` | "Tags made before upload are attributed to Anita" | A1 says the tags travel with the upload, not that they are attributed. Attribution is stated only in H2, for a different actor. Confirm pre-upload tags carry the tagger's identity. |
| `H2-identify-species-in-new-uploads.feature` | "Only species valid for the collection can be assigned" | Inferred from J1 (administrator configures the species list). H2 itself does not constrain the choices. Confirm whether the species list is per-collection or global. |
| `H3-confirm-existing-identifications.feature` | "Harold can tell reviewed identifications from unreviewed ones" | H3 requires that a review is *recorded*; it does not require that the record is *visible* as a review state. Confirm whether identifiers need to see review status. |

## 4. Ambiguities found while transcribing — worth resolving before agreeing

1. **"Batch" is undefined.** F1 and F2 treat one SD card as one batch; AL2
   speaks of "one upload". If a field worker uploads several cards in one
   session, is that one upload with several batches, or several uploads? The
   scenarios assume one upload may contain several batches, each with its own
   location. Confirm.
2. **F3's announcement versus F4's protection.** F3 requires the announcement
   to identify the locations; F4 forbids disclosing sensitive locations. The
   scenarios resolve this by having the announcement omit precise sensitive
   locations for unauthorized recipients. Confirm that this is the intended
   resolution rather than, say, suppressing the announcement entirely.
3. **"Precise location" versus any location.** Both F4 and M1 protect the
   *precise* location, implying a coarsened location may be shown. Nothing
   defines the coarsening (region? county? nothing at all?). This is the single
   most load-bearing undefined term across the set.
4. **AL2's "no leftover partial data".** Cleaning up a failed attempt is a
   deletion, which brushes against M2's "original uploaded data cannot be
   destroyed". The scenarios assume partial data from a failed attempt is not
   "original uploaded data". Confirm.
5. **H3's "counts".** H3 says existing "species and counts" are shown, but no
   story in this batch says how a count is recorded in the first place. There
   is a missing story for entering the number of animals seen.
6. **A1 offline retention has no stated horizon.** "Retained without requiring
   a network connection" does not say for how long, or across what (app
   restart? device restart? weeks in the field?). The scenarios assume "until
   she uploads, however long that takes"; this needs an NFR.
