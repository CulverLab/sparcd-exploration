# sparcd-explorer

A focused exploration tool for the SPARC'd camera-trap collections. It signs
in to the MinIO/S3 backend, loads a collection's Camtrap-DP CSVs, and renders
a Field Notebook view: a hex-binned map, a species dashboard, stat cards, and
drill-in tabs for images, detections, and locations. Built as a single
[marimo](https://marimo.io) notebook that runs locally or ships as a static
Pyodide (WASM) bundle that runs entirely in the browser.

## Setup

```sh
# from repo root
pnpm install                  # installs turbo
cd apps/sparcd-explorer
pnpm install:py               # → uv sync (creates .venv with marimo + deps)
```

## Run

From this directory:

```sh
pnpm start    # marimo run notebooks/hello.py --no-token   (app view)
pnpm dev      # marimo edit notebooks/hello.py --watch     (edit / pairing)
pnpm edit     # alias of dev
```

Or from the repo root:

```sh
pnpm start --filter @sparcd/sparcd-explorer
pnpm dev --filter @sparcd/sparcd-explorer
```

`pnpm start` is the normal way to view the app read-only; `pnpm dev` / `edit`
run the edit server with `--watch` for development and live pairing.

## Using the app

The sidebar holds the whole control surface, top to bottom:

- **Connection** — S3/MinIO sign-in form. Fields prefill from a local `.env`
  for local dev; the deployed bundle has no `.env`, so users sign in through
  the form. Checking **Remember endpoint & access key on this device**
  persists those two fields (never the secret key) to this browser's
  localStorage and prefills them on a later visit. Submit **Connect** to
  build the client.
- **Collection** — pick a collection and press **Load selected collection**.
  Collections load on demand and are cached in memory, so re-selecting one is
  instant.
- **Query filters** — mountain range, site code, year, month, start/end date,
  species include/exclude, and elevation range. Filters apply only when you
  press **Search**; adjusting a control recomputes nothing until then.
- **Display options** — live-reactive view settings that change presentation,
  never which rows return: lat/long vs UTM, coordinate rounding or truncation
  (for location security), meters vs feet, and the species-columns toggle.

The main column shows:

- A **hex-binned map** (pure-Python hex binning) with a basemap dropdown —
  USGS Topo (default), Esri Imagery, Shaded relief, Stewardship, OpenStreetMap,
  Carto Light. An **Exact sites** point mode is available only on the
  `wildcats.sparcd.arizona.edu` endpoint, where precise coordinates are in
  scope.
- A **species dashboard** of detections alongside the map.
- **Stat cards** — Sites, Images, Tagged, Species — reflecting the current
  search.
- Drill-in tabs — **Images** (paginated grid of presigned full-res originals),
  **Detections** (per-image event table with a species filter), and
  **Locations** (site table).

## Agent workflow

Use the [marimo-pair](https://github.com/marimo-team/marimo-pair) Claude Code
plugin for live, two-way pairing — the agent runs cells in the active kernel
and sees results, instead of just editing files on disk.

Install once in Claude Code:

```
/plugin marketplace add marimo-team/marimo-pair
/plugin install marimo-pair@marimo-pair
```

The `--no-token` flag lets marimo-pair auto-discover the running server, and
`--watch` reloads on any file-based edit to `notebooks/*.py`.

See: <https://marimo.io/blog/claude-code>

## Notebooks

- `notebooks/hello.py` — the explorer app (the one `dev` / `start` run).
- `notebooks/hello_wasm.py` — **generated**. CI prepends a PEP 723 dependency
  header to `hello.py` to produce it for the WASM export. Never hand-edit it.
- `notebooks/sparcd_preview.py` — connect to the SPARC'd MinIO/S3 + (optional)
  SQLite backends and preview buckets, objects, and tables. Run with
  `pnpm preview`.

## Connecting to SPARC'd data

The backend stores data in a MinIO/S3 object store (image collections,
uploads) plus a small SQLite app-state DB. All access is read-only — the app
only lists, gets, stats, and presigns. For local dev, put credentials in a
gitignored `.env`:

```sh
cp .env.example .env
$EDITOR .env   # SPARCD_S3_ENDPOINT, SPARCD_S3_ACCESS_KEY,
               # SPARCD_S3_SECRET_KEY, SPARCD_S3_SECURE
```

The endpoint can be a bare `host[:port]` or a full URL — the loader normalizes
either. In practice, access is scoped to the Educational Test collection.

## Deploy

`.github/workflows/pages.yml` exports the WASM bundle
(`marimo export html-wasm`) and assembles the combined site: landing page at
`/`, explorer at `/explorer/`, plus the uploader and tagger. The deployed
explorer runs Python via Pyodide in the visitor's browser and talks to S3
directly — no server, no `.env`, no server-side secret. The S3/MinIO endpoint
must permit CORS from the Pages origin.
