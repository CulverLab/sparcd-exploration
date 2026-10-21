# Browse upload filter review (#530 / PR #564)

Updated the stacked branch onto PR #563 commit df8edf4, retaining its date
validation, malformed-description guard, mobile labels, location wrapping,
and keyboard guidance alongside the upload filter and its three BDD scenarios.

The collected-date helper accepts both generated YYYY-MM-DD dates and the
MM-DD-YYYY example documented by older Uploader guidance. Both normalize to
YYYY-MM-DD and undergo the same exact calendar validation. Added unit cases
for normalization, leap dates, impossible dates, and malformed suffixes, plus
Browse coverage for the documented 03-28-2000 example and invalid dates.

Corrected the container-width comment to include the 70px Open track; the
configured thresholds and layout behavior remain unchanged.

Validation: 335 unit tests, TypeScript, and production build passed. All 32
Browse BDD scenarios passed in independent Google Chrome on isolated port 5339,
including filter composition, delayed summaries, and inherited regressions.
