# DRAFT — for review, not yet agreed. Generated 2026-08-06.

Requirements drafts for review. Nothing here is agreed; nothing here is wired
into a test runner yet. The set exists to be read, discussed by the team, and
then dispersed to its permanent homes.

Drafted with AI assistance (generated from the wiki user stories and the app
source, then human-reviewed); each file's DRAFT header names its source.

---

## What is here

| Directory | Contents | Size |
| --- | --- | --- |
| `spec-features/` | BDD transcription of the agreed acceptance criteria for stories F1–F4, A1, A2, AL1, AL2, H1–H3, plus `NOTES.md` on what would not fit into a scenario | 11 `.feature` files, 73 scenarios |
| `use-cases/` | Three Cockburn-style use cases (UC1 upload, UC2 resume/retry, UC3 identify) carrying 41 NFRs, plus `NOTES.md` with 29 numbered open questions | 3 use cases |
| `gap-report.md` | The diff between the two BDD sets: per-story coverage, 10 draft GitHub issues, 18 groups of unmapped as-built behavior, and the residue that BDD cannot express | 1 document |

The team-facing digest of this set (Start Here, Where We Stand, Questions To
Decide) lives only on the
[sparcd-requirements wiki](https://github.com/CulverLab/sparcd-requirements/wiki/Start-Here)
— edit it there.

Every file carries a DRAFT header on its first lines.

## How the two BDD sets relate

They are deliberately two sets, written from opposite ends, in the same
notation so they can be compared line by line.

- **`spec-features/` is the target.** Each file is one agreed story. Scenarios
  are written in the story's own vocabulary (Frank, Anita, Alice, Harold) and
  say nothing about buttons, steps or storage. They describe behavior nobody
  has committed to building yet.
- **The as-built set is the present.** Each file is one coherent flow of a
  shipped app, describing what the code does — deviations from a story are
  written into a trailing `#` comment rather than smoothed over. These files
  now live with their apps (`apps/sparcd-uploader/features/`,
  `apps/sparcd-tagger/features/`) as executable playwright-bdd suites: PR #25.
- **`gap-report.md` is the subtraction.** For each story it names which
  as-built scenarios satisfy which criteria, what is unmet, and what is met
  only vacuously (A1's "untagged images are accepted" passes because the
  uploader has no tagging surface at all). It also runs the subtraction the
  other way: 165 as-built scenarios carry `@unmapped` because no story
  describes them, grouped into 18 candidates for new stories.

**Tag vocabulary.** Scenarios carry a story ID (`@F1` `@F2` `@F3` `@F4` `@A1`
`@A2` `@AL1` `@AL2` `@H1` `@H2` `@H3`), `@unmapped` where no agreed criterion
covers the behavior, and `@security` on scenarios that state a guarantee rather
than an interaction. The two sets are told apart by directory, not by tag — no
`@as-built` tag is in use.

## Recommended final homes after review

| Set | Home | Why |
| --- | --- | --- |
| as-built features | `apps/<name>/features/` | Done — moved and made executable in PR #25. |
| `spec-features/*.feature` | Requirements wiki, one DRAFT-prefixed page per story, alongside the story it transcribes | They are requirements, not tests. They become executable only once a story is agreed and scheduled — at which point the relevant file follows the story into the owning app's `features/`. |
| `use-cases/*.md` | Requirements wiki, DRAFT-prefixed pages | They restructure existing wiki use cases and carry the NFRs, which have no home in a `.feature` file. |
| `NOTES.md` (all four) | Travel with their set | Each records what its author could not express and what a reviewer must decide. They are the most perishable and most valuable part of this drop. |
| `gap-report.md` | Consumed, not filed | §2 becomes 10 GitHub issues, §3 becomes candidate wiki stories, §4 becomes SRS/NFR entries. Once dispersed the report is a point-in-time snapshot and should not be maintained. |

Keep the DRAFT prefix on wiki pages until the project director signs off. Drop
the prefix per page, not in a batch.

## Review checklist

Work down this list; each item is a decision someone has to make, not a
document to admire.

- [ ] **Confirm the three `@unmapped` spec scenarios** in `spec-features/NOTES.md` §3
      (pre-upload tag attribution, per-collection species list, visible review
      state). These went beyond the agreed criteria and need the director's
      yes or no before they count as requirements.
- [ ] **Answer the 29 open questions** in `use-cases/NOTES.md`. Q1.4
      (failed-attempt cleanup vs. M2), Q3.2 (push or pull announcement), Q4.1–Q4.3
      (the permission model) and the definition of "precise location" block the
      most downstream work.
- [ ] **Define "precise location" versus a coarsened one.** Flagged in
      `spec-features/NOTES.md` §4.3 as the single most load-bearing undefined
      term in the set. F4, M1, F3 and H2 all depend on it.
- [ ] **Rule on F3's announcement content versus F4's protection.** They are
      stated as opposing requirements in the same feature file; see below.
- [ ] **Decide who owns pre-upload tagging (A1) and the announcement (F3).**
      Neither has an owning app today. Uploader, tagger-over-a-local-batch, or
      deferred.
- [ ] **Accept or reject the F2/A2 location deviation.** As-built any registry
      location is assignable; the story says only locations valid for the
      chosen collection. This is a real behavior change if the story stands.
- [ ] **Decide whether a pure confirmation must leave a trace (H3).** The
      tagger's diff is content-based, so re-applying an identical
      identification records nothing. Satisfying H3 needs a new mechanism.
- [ ] **Set thresholds for the performance criteria.** H1's "responsive on a
      small, low-powered laptop" and "legible well beyond fit-to-screen" are
      untestable until a device class, a maximum input-to-paint delay, and a
      minimum magnification exist. As-built is 6× fitted, 10× fullscreen.
- [ ] **Triage the 18 unmapped groups** in `gap-report.md` §3 into
      propose-new-story / spec-later / out-of-scope. Groups 9, 14 and 15
      (correcting a published upload, sync, snapshot-and-restore) are the M2
      mechanism and are the highest-value new stories.
- [ ] **Confirm the two disconnect paths** in the uploader behave differently
      on purpose (Settings wipes local records with a guard; the header
      disconnect neither wipes nor guards). `gap-report.md` §3 group 10 calls
      this a defect.
- [ ] **Confirm the three use cases are the right first set** and pick the next
      (Q5.7).

## Substantive inconsistencies found and not fixed

Mechanical repairs were applied in place (see below). These are judgment calls
and were left alone.

1. **F3 and F4 state opposing requirements with no precedence rule.**
   `F3-announce-new-data-ready-for-tagging.feature` requires the announcement
   to identify "the location or locations the data came from"; the `@security`
   scenario two below it requires that it "does not disclose the precise
   sensitive location". `spec-features/NOTES.md` §4.2 proposes the resolution
   (omit precise sensitive locations for unauthorized recipients) but the
   feature file itself does not encode which rule wins. Needs Q3.4 answered,
   then one of the two scenarios rewritten.

2. **AL2's cleanup requirement brushes against M2.** "No leftover partial data
   from the failed attempt remains" is a deletion; M2 forbids destroying
   original uploaded data. The scenarios assume partial data from a failed
   attempt is not "original uploaded data". That assumption is stated in
   `spec-features/NOTES.md` §4.4 and raised as Q1.4, but it is an assumption,
   not an agreed rule.

3. **The `@F4` tag is load-bearing in two contradictory directions.**
   `as-built/tagger/F4-location-visibility.feature` is tagged `@F4` and every
   scenario in it asserts the *absence* of F4 behavior ("no location is
   hidden, coarsened or withheld from any connected user"). `gap-report.md`
   §2 states the definition of done for each story as "BDD scenarios tagged
   `@F4` pass" — which the as-built file satisfies today, while F4 is
   unimplemented. Once these files are executable, the two sets need separate
   tag namespaces or separate runner profiles. Same hazard for `@F1`, `@F2`,
   `@A1`, `@AL1`, `@AL2`, `@H1`, `@H2`, `@H3`.

4. **`as-built/tagger/H3-review-existing-identifications.feature` carries a
   scenario that is `@H3`-tagged but unmapped in substance** — "An image can be
   flagged as questionable for a second opinion" describes a local-only flag
   that never syncs, so it does not reach a second opinion at all.
   `gap-report.md` §3 group 17 makes the same observation. Retagging it is a
   judgment call, not a typo.

5. **Header conventions differ across the four `NOTES.md` files** — one HTML
   comment plus a blockquote, one `#` heading, one title-then-DRAFT-paragraph,
   one plain `#` line. All carry the DRAFT marker, so nothing is missing; they
   just will not render alike when they reach the wiki.

## Mechanical repairs already applied

- **27 dangling lines** in `.feature` files: wrapped step text was continued on
  an unkeyworded following line, which is a Gherkin parse error. Continuations
  were joined onto their step; no wording changed. All 27 were in
  `as-built/uploader/`.
- **One invalid step keyword**: `AL1-uploads-survive-unreliable-connection.feature`
  used `Or`, which Gherkin does not recognize. Merged into the preceding `Then`
  with the wording preserved.
- **Two wrong file counts**: `as-built/uploader/NOTES.md` said eight feature
  files (there are nine); `as-built/tagger/NOTES.md` said ten (there are
  eleven).
- **Three markdown headings** in `spec-features/NOTES.md` §1 broken across two
  lines, so the second half rendered as body text.

Verified clean afterwards: 301 scenarios across 31 feature files parse
structurally, every tag is from the sanctioned set, every scenario name quoted
in `gap-report.md` resolves to a real scenario, every `NFR-x.y` and `Qx.y`
citation resolves to a defined item, and the counts in the gap report's header
(11/73, 9/106, 11/122, 41 NFRs) match the files.
