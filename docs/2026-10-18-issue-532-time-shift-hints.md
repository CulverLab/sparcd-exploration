# Issue #532: compact disabled time-shift explanations

PR #567 removes the inline explanations beside Time shift and Time shift selection. Disabled actions retain native disabled semantics and their existing reasons, with a focusable wrapper and an accessible description. A compact portal tooltip shows on mouse hover, keyboard focus, or touch, without adding toolbar text.

Tooltips stay within the viewport, remain hoverable, dismiss with Escape or an outside interaction, and show only one explanation at a time. Enter and Space on an explanation cannot activate the disabled action or navigate images. If keyboard selection enables the action while its explanation has focus, focus transfers to the enabled button.

## Validation

- TypeScript check passed.
- All 294 Tagger unit tests passed.
- Production build passed (existing bundle-size warning).
- All 16 capture-time BDD scenarios passed in independent Google Chrome on port 5339. Coverage includes accessible descriptions, Tab access, hover, Escape, Enter/Space suppression, no-timestamp and no-selection reasons, touch and narrow viewport bounds, one visible tooltip, and focus transfer on enablement.
- Existing capture-time scenarios continue to cover signed offsets, one-image selection, skipped untimestamped frames, clearing active shifts, sync persistence, and burst grouping.

The full Tagger BDD suite was not rerun for this update.
