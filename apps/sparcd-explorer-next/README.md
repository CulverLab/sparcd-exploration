# SPARC'd Explorer (next)

A static web app for exploring one or more SPARC'd collections together: where
the cameras are, what they photographed and when, and what in the data needs a
second look. It reads the collections' Camtrap-DP-flavored files straight from
S3 with read-only credentials and keeps a local copy in IndexedDB, so a
collection opened before shows at once.

It is being built in phases. Today it signs in, opens collections (from the
local copy when there is one), and shows the filter bar, the In view summary,
Data checks and the Locations, Species and Photos tables with CSV export. The
map, the effort strip, the photo grid, charts and reports come next.

## Run

```sh
pnpm install            # from the repo root
pnpm --filter sparcd-explorer-next dev
```

Then open <http://localhost:5314/sparcd-exploration/explorer-next/>.

## Test

```sh
pnpm --filter sparcd-explorer-next check      # types
pnpm --filter sparcd-explorer-next test       # unit tests (vitest)
pnpm --filter sparcd-explorer-next test:bdd   # browser features (playwright-bdd)
```

The perf test builds a 200k-image model and asserts `applyFilters` stays under
100 ms. On a slow runner, scale the budget with `PERF_FACTOR=3`.

All test data is synthetic: made-up IDs, names and coordinates.

## Layout

- `src/data/` is the data layer: plain TypeScript over plain objects, no React.
  - `open.ts` and `cache.ts` read collections (ETag-checked, 8 requests in
    flight, cancellable) and cache them per account.
  - `model.ts` builds the model, `filters.ts` filters it, `views.ts` derives
    what each view shows, and `checks.ts` finds data problems.
  - `coords.ts` holds UTM, display precision and the exact-sites gate; `hex.ts`
    holds the hex grid.
  - `species.ts` and `locations.ts` read the species list and location registry.
- `src/lib/` holds sign-in helpers (endpoint checking, form prefill).
- `test/ported/` holds the old explorer's Python tests, ported case by case.
