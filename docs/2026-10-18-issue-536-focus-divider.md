# Issue #536: Focus divider correctness and accessibility

The divider consumes resize keys without navigating images, supports Home/End, and exposes its orientation, current pixel value, bounds, instructions, and controlled pane to assistive technology.

Saved width and height preferences remain independent. A ResizeObserver clamps the displayed size to the current container without overwriting the preferred size during viewport changes. When a short window cannot fit both pane minimums, the split scrolls; the species viewport also scrolls at its minimum size so controls remain reachable.

Pointer capture keeps each drag local to its initiating pointer. Touch scrolling is disabled on the divider itself. Pointer cancellation, lost capture, breakpoint changes, and unmount stop the drag without leaving global pointer listeners behind.

Coverage includes mouse bounds, keyboard image-identity preservation, horizontal scrolling at minimum width, independent preferences across viewport changes and reload, short-window scrolling, real Chrome touch input, cancellation, and Focus closing during a drag.

## Validation

- All 33 H1 browser scenarios passed in independent Google Chrome on port 5339.
- The final two keyboard/pointer tests also passed after adding all-four-arrow, unrelated-pointer, and lost-capture assertions.
- All 294 Tagger unit tests, TypeScript, production build, and diff checks passed (existing bundle-size warning).
- The full Tagger BDD suite was not rerun for this follow-up.

## Main integration and duplicate step — October 20, 2026

Merged main through `7f7c1e9`, including the Adjust placement and Keep values
changes from #569/#570. BDD generation reproduced Juli4nG’s reported ambiguous
phone-size step. Removed #571’s duplicate Given definition and retained main’s
identical shared When definition; both scenarios continue to use it.

BDD generation now passes. All 49 H1 scenarios passed without retries in
independent actual Google Chrome on isolated port 5357 (1.3 minutes), covering
the divider together with responsive Adjust placement, image refitting and
Keep values keyboard behavior. All 347 Tagger unit tests, TypeScript, production
build and diff checks passed. Temporary Chrome configuration was restored.
The full Tagger BDD suite was not rerun for this integration.
