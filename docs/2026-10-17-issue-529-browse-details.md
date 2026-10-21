# Browse upload metadata review fixes (#529 / PR #563)

Collected dates are read from a delimited `collected YYYY-MM-DD` comment segment.
The parser verifies the exact UTC calendar date rather than accepting JavaScript
normalization of impossible days. Missing, malformed and impossible dates remain
unavailable; valid leap dates and generated comments with appended notes work.
PR #500 remains the source of generated upload comments.

Location names wrap in the existing column, with each ID displayed on its own
line. Multiple locations remain separate and complete; the existing summary
loader still deduplicates identical name/ID pairs. Missing IDs are identified
rather than displayed as empty parentheses.

Upload rows include field labels for screen readers and show those labels on
mobile. Missing collected dates have a row-level accessible description, visible
mobile wording, and a full-width explanation when the row receives keyboard
focus. Existing mouse hover guidance remains available. The progress bar is
visual decoration; the tagged and total counts remain readable text.

## Validation

- 315 Tagger unit tests passed, including 21 collected-date cases.
- TypeScript and the production build passed.
- All 257 Tagger BDD scenarios passed in independent Google Chrome on port 5339.
- Ten focused Browse cases passed; the full run also verified the strengthened
  real-Tab-order and mobile accessible-name assertions.
- Browser coverage includes impossible days, leap-year rules, appended notes,
  keyboard-visible missing-date guidance, and long/multiple locations across
  1600, 1350, 900, 390 and 320px viewport widths. Identical deployment rows remain
  deduplicated. Mobile field labels and page overflow are checked at 390/320px.
- Final desktop keyboard-focus and 320px screenshots were visually inspected.

The Chrome override and visual-review fixtures were temporary local files and
were removed after verification. The user's existing browser windows and app
servers were not reused.

## Legacy description regression follow-up

The collected-date parser accepts unknown metadata values and treats omitted or
non-string descriptions as unavailable without coercion. This preserves the
existing valid-string date parsing while preventing malformed UploadMeta.json
from crashing Browse.

Nine additional unit cases cover missing, null, numeric, boolean, array, object,
and boxed-string values. Six Browse BDD cases serve actual UploadMeta.json
fixtures with omitted, null, number, boolean, array, and object descriptions.
They verify unavailable-date guidance on keyboard focus, preserved location and
counts, another visible upload, and opening the affected upload for tagging.

Validation: all 324 Tagger unit tests, TypeScript, and the production build passed.
All 263 Tagger BDD scenarios passed in independent Google Chrome on port 5339
(6.0 minutes), including all six new regressions.
