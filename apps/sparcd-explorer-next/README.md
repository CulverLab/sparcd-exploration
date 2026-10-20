# SPARC'd Explorer (next)

A static web app for exploring one or more SPARC'd collections together: where
the cameras are, what they photographed and when, and what in the data needs a
second look. It reads the collections' Camtrap-DP-flavored files straight from
S3 with read-only credentials and keeps a local copy in IndexedDB, so a
collection opened before shows at once.

It signs in once with the Tagger and Uploader, opens several collections
together, and shows a map of hexes (or exact sites where allowed), the camera
effort per month, an In view summary with data checks, and Locations, Species
and Photos tables, a photo grid with a detail view, and charts. Every part
follows one filter bar with Reset and Undo. Report prints what is in view or
saves it as a PDF, and downloads it as a spreadsheet, CSV files or a Camtrap DP
package. Coordinates are never shown or exported more exact than the Display
precision.

## Beside today's explorer

Today's explorer (the marimo app in `apps/sparcd-explorer`) stays at
`/explorer/`. This one deploys beside it at `/explorer-next/` and replaces it
once it covers everything; until then both read the same collections and
neither writes anything.

## Run locally

```sh
pnpm install                              # from the repo root
pnpm --filter sparcd-explorer-next dev    # http://localhost:5314/sparcd-exploration/explorer-next/
```

### Against the test mock

The BDD suite runs the app against an in-page S3 mock with synthetic
collections (`features/steps/support/`), so `pnpm test:bdd` needs no server or
credentials. To click through the same data by hand, run one scenario headed
and pause it:

```sh
pnpm exec bddgen
pnpm exec playwright test --headed --debug -g "two collections"
```

### Against a real server

The app talks to S3 straight from the browser, the same way the Tagger does:

1. `cp .env.example .env` and set `VITE_SPARCD_S3_ENDPOINT` to the server,
   e.g. `https://server.example.org`. It only prefills the sign-in form; the
   username and password are typed at sign-in and never saved to a file.
2. `pnpm --filter sparcd-explorer-next dev` and sign in.

The server's CORS policy must allow the dev origin (`http://localhost:5314`,
or `http://localhost:5310` through the dev proxy below), as it must for the
Tagger and Uploader.

To sign in once for all three tools, run them on one origin through
`apps/sparcd-dev-proxy`: `pnpm dev` from the repo root starts every app and the
proxy, then open
<http://localhost:5310/sparcd-exploration/explorer-next/> (the Tagger and
Uploader sit at `/tagger/` and `/uploader/` on the same port).

## Test

```sh
pnpm --filter sparcd-explorer-next check      # types
pnpm --filter sparcd-explorer-next test       # unit tests (vitest)
pnpm --filter sparcd-explorer-next test:bdd   # browser features (playwright-bdd)
pnpm --filter sparcd-explorer-next build      # tsc --noEmit && vite build
```

The perf test builds a 200k-image model and asserts `applyFilters` stays under
100 ms. On a slow runner, scale the budget with `PERF_FACTOR=3`.

All test data is synthetic: made-up IDs, names and coordinates in open ocean,
generated JPEGs and a two-second test-pattern video.

## Deploy

`.github/workflows/pages.yml` builds the app on every push to `main` that
touches it and publishes `dist/` at
<https://culverlab.github.io/sparcd-exploration/explorer-next/> (the Vite
`base` is `/sparcd-exploration/explorer-next/`). `.github/workflows/bdd-tests.yml`
runs the unit and BDD suites on pull requests.

## Layout

- `src/data/` is the data layer: plain TypeScript over plain objects, no React.
  - `open.ts` and `cache.ts` read collections (ETag-checked, 8 requests in
    flight, cancellable) and cache them per account.
  - `files.ts` lists every upload folder in the background for the photos
    media.csv lists but storage lacks, cached by media.csv's ETag.
  - `model.ts` builds the model, `filters.ts` filters it, `views.ts` derives
    what each view shows, and `checks.ts` finds data problems.
  - `coords.ts` holds UTM, display precision and the exact-sites gate; `hex.ts`
    holds the hex grid.
  - `thumbs.ts` loads thumbnails, originals and video frames, six at a time.
  - `export.ts` and `exportCamtrap.ts` build the report's tables, the CSV
    files and the Camtrap DP package; `exportFiles.ts` writes the `.xlsx` and
    `.zip` files with libraries loaded only on download.
- `src/lib/` holds what the components share: labels, columns, CSV, charts.
- `src/components/` holds the screens. `later.ts` loads Charts, the photo
  panel and the report after the workspace has drawn.
- `test/ported/` holds the old explorer's Python tests, ported case by case.

## Run-through checklist

A pass by hand before a review, against a real server with at least two
collections:

1. Open the app, sign in with your username and password, and see "Choose
   collections" with nothing ticked.
2. Tick two collections; the button reads "Open 2 collections together". Open
   them and watch each one's steps; a collection opened before says it is
   instant.
3. Check the header reads "<first> + 1 more", the filter bar has a Collections
   filter, and In view has a By collection list.
4. Filter Species to one animal, then Dates to a few months. Each button shows
   its value with a ×, and the count reads "N of M photos". Press Reset
   filters, then Undo in the note, and see both filters come back.
5. Click a hex on the map, then use Select area to drag over a few more; an
   Area filter appears. Press Esc mid-drag to cancel, and "× Clear" to drop the
   area.
6. Drag across a few months of the Camera effort strip; Dates follows. Clear it
   with its "× Clear".
7. Open Data checks: read each problem, press one button (for example "Show
   these photos"), and Undo it. Turn on "Show each location ID separately" and
   off again. Where photos' files are missing, turn on "Include photos whose
   files are missing" and see the photo count grow.
8. In Locations, Species and Photos, sort a column, hide one in Columns, and
   Export CSV; the rows come in the table's order and the coordinates match
   the Display precision.
9. In Photos, switch Grid and List and Tagged / Untagged / All while scrolled
   far down: the controls stay under the filter bar and each layout keeps its
   place. Videos show a first frame.
10. Open a photo, step with the arrow keys, open full size, and close with Esc;
    the page has not moved and focus is back on the photo.
11. In Charts, click a species, an hour and a month bar; each sets its filter,
    and a second click clears it.
12. Set Display to UTM and 2 decimals, then press Report. Untick Map, check the
    header reads your filters, "Prepared … by <you>" and "UTM, rounded to
    1,000 m". Press Print or save as PDF and look at the preview: only the
    report, on white paper.
13. Download the spreadsheet, then CSV files (.zip) and Camtrap DP package
    (.zip) from More formats. Open each: the sheets are Summary, Locations,
    Species, Photos, Detections, in the tables' order, and no coordinate or
    elevation is more exact than the Display setting, the package's
    deployments.csv included. With Photos showing "Tagged", every download
    holds tagged photos only.
14. Close the report with Esc; the page is where it was and focus is on Report.
15. Sign out from the account menu, and see the Tagger in another tab sign out
    too (through the dev proxy).
