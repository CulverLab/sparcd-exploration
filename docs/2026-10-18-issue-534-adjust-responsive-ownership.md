# Issue #534: responsive Adjust ownership

PR #569 positions Adjust below the zoom controls on wide screens and at the top-left on phones. The follow-up renders one ImageAdjustments instance, using responsive CSS to place the same trigger in both layouts. Its portalled popup, slider values, and keyboard focus survive breakpoint changes without hidden duplicate triggers or a hidden focus-restoration target.

Placement coverage checks top-left offsets relative to the Focus canvas, viewport containment, and the gap below the zoom column with Reset both absent and present. Interaction coverage opens Adjust, changes brightness, crosses 1023px/1024px and phone/desktop widths, and verifies one trigger and popup, preserved slider focus and values, popup bounds, Escape restoration, and keyboard reopening.

## Validation

- All 28 H1 scenarios passed in independent Google Chrome on isolated port 5339.
- All 294 Tagger unit tests passed.
- TypeScript and production build passed (existing bundle-size warning).
- The full Tagger BDD suite was not rerun for this follow-up.
