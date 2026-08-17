# DRAFT — for review. Generated 2026-08-06.

Open questions raised by the three use-case drafts, as a checklist for the
team's review. Each item names where it surfaces and what a decision would
unblock.

---

## 1. Replace / merge an upload vs. misuse case M2

Surfaces in: **UC1 extension 9b**, **UC2 extension 7a**.

The current wiki use case offers "replace the previous upload" when images
overlap an earlier one. M2 says original uploaded data cannot be destroyed or
silently overwritten and that changes must stay traceable. These conflict as
written.

- [ ] **Q1.1** When a new upload overlaps an existing one, what options exist?
      Add alongside / supersede-but-retain the original / refuse and require a
      new batch?
- [ ] **Q1.2** Is a "replace" ever a true delete, or always a supersede that
      retains the prior data and records who superseded it?
- [ ] **Q1.3** Who is allowed to choose? Uploader, collection lead, or
      administrator only?
- [ ] **Q1.4** Where is the boundary between clearing a *failed attempt's*
      partial data (needed by AL2 — "no leftover partial data") and destroying
      *completed* uploaded data (forbidden by M2)? A partial upload is never
      "complete", so the rule likely keys on completion state — confirm.
- [ ] **Q1.5** Does the same rule govern legacy data migrated from the previous
      system?

**Decision unblocks:** UC1 extension 9b, UC2 extension 7a, and the retention
model behind NFR-1.6, NFR-2.5, NFR-3.10.

---

## 2. Session lifetime and idle logout

Surfaces in: **UC1 extension 11c**, **UC2 extension 7c**, **UC3 extension 9c**.

The wiki use case has idle-logout steps in the main flow. The stories governing
session lifetime are still DRAFT, so those steps are unsupported. They are held
as blocked extensions rather than dropped.

- [ ] **Q2.1** Is there an idle timeout at all, and how long?
- [ ] **Q2.2** Does an in-progress upload survive an idle logout? AL1 —
      unattended overnight uploads — depends on this answer, and an idle timeout
      shorter than a night's upload would defeat the story.
- [ ] **Q2.3** What happens to unsaved identification work at logout (UC3)?
- [ ] **Q2.4** Does the requirement come from a security policy, and if so
      whose? Note the known tension: a persistent-login expectation exists on
      one side and idle-logout work on the other.
- [ ] **Q2.5** On returning after a logout, what does the uploader see —
      resumable upload, or a fresh start?

**Decision unblocks:** three blocked extensions, plus NFR-2.7 and NFR-2.9.

---

## 3. Notification / announcement mechanism

Surfaces in: **UC1 steps 13–14 and extension 14a**, **UC2 step 8**.

F3 requires the identification team to learn that new data is available, and
deliberately says nothing about how. The use cases keep that open, but several
properties need deciding before the flow can be specified.

- [ ] **Q3.1** Who exactly receives an announcement — everyone with identify
      permission on the collection, a named subscriber list, or a lead who
      forwards?
- [ ] **Q3.2** Push (email/message) or pull (a "new data" view the team checks)?
      Either satisfies F3; they differ in reliability and effort.
- [ ] **Q3.3** What is the guaranteed content? F3 requires collection,
      location(s), image count, upload date. Optional notes are additional.
- [ ] **Q3.4** How is a *sensitive* location represented in an announcement that
      must name location(s)? Coarsened, named without coordinates, or omitted
      with a marker? (F4, M1.)
- [ ] **Q3.5** Exactly-once delivery: is an announcement retried on failure, and
      what prevents a second announcement after a resume (UC2 extension 8a)?
- [ ] **Q3.6** Does the same mechanism serve H4 (identifier tells the maintainer
      the work is done) and the HA1–HA3 expert-help path, or are those separate?

**Decision unblocks:** UC1 steps 13–14, extension 14a, NFR-1.4, NFR-1.9.

---

## 4. Permission model

Surfaces in: **UC1 extensions 3a and 9a**, **UC2 extension 7b**, **UC3
extensions 2a and 2b**.

All three use cases assume named permissions (upload, identify, view precise
sensitive locations) that are not yet defined anywhere.

- [ ] **Q4.1** What is the set of permission levels, and what does each grant?
      T2 says a lead changes a user's permission level — the levels need names.
- [ ] **Q4.2** Is "may see precise sensitive locations" a separate grant from
      "may identify"? M1 says identify access alone must not carry it, so it
      appears to be separate — confirm.
- [ ] **Q4.3** Is that grant per-collection or per-location? A collection may
      mix sensitive and ordinary locations.
- [ ] **Q4.4** Are permissions re-checked at the moment of action, or only at
      session start? UC2 extension 7b (permission changed between attempts)
      depends on this.
- [ ] **Q4.5** What is the concrete meaning of "refused, not partially honored"
      mid-transfer — does a partly-transferred batch get cleared, and by whom?
- [ ] **Q4.6** How does administrator-acting-on-behalf-of-a-user (J3) appear in
      the records an upload or identification leaves?

**Decision unblocks:** all permission extensions, NFR-1.7, NFR-2.3, NFR-3.8.

---

## 5. Smaller items to confirm

- [ ] **Q5.1** *Concurrent identification* (UC3 extension 9b): may two people
      work the same upload at once, and what happens when both touch one image?
- [ ] **Q5.2** *"Image file"* (UC1 step 5): which formats count? Are videos
      excluded permanently or just for now? RAW files?
- [ ] **Q5.3** *Batch identity* (UC2): what makes a retry "the same upload" —
      the source card, the destination, or an identifier assigned at first
      attempt?
- [ ] **Q5.4** *Species list scope* (UC3 extension 5b): is the configured list
      global or per-collection?
- [ ] **Q5.5** *Counts* (UC3 step 5): H2 says one or more species per image; H3
      mentions counts. Is a per-species individual count required on new
      identifications, or optional?
- [ ] **Q5.6** *Untagged-forever* (UC3 extension 4a): is there a state for
      "reviewed and nothing identifiable", distinct from "not yet reviewed"?
- [ ] **Q5.7** Confirm the three use cases are the right first set, and which
      comes next — expert help (HA1–HA3), reporting (FR1–FR3), or collection
      administration (T1–T2, J1–J2).
