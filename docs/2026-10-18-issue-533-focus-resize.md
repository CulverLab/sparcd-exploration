# Issue #533: Focus resize regression coverage

PR #568 allows Focus and fullscreen image panes to shrink and refits images after resizing. The follow-up also resets zoom when pane width or height changes without changing the fitted image dimensions, as can happen with a height-constrained portrait.

The fitted-view helper now requires strict image containment rather than accepting centered overflow. Resize assertions separately constrain the zoom wrapper to the independently sized Focus canvas or fullscreen pane, verify a scale of 1, and verify the Reset control disappears. Focus canvas padding remains intentional.

Browser coverage includes fitted and zoomed Focus, a portrait whose fitted dimensions remain unchanged while the pane narrows, and fitted and zoomed fullscreen. Every resize case also restores the original viewport and checks the fitted view again.

## Validation

- All 29 H1 browser scenarios passed in independent Google Chrome on isolated port 5339.
- All 294 Tagger unit tests passed.
- TypeScript and production build passed; the existing bundle-size warning remains.
- The full Tagger BDD suite was not rerun for this follow-up.
