# sparcd-uploader

A static, browser-based tool for preparing and uploading SPARC'd camera-trap
image batches. Sits alongside SPARC'd. See [`plan.md`](./plan.md) for the full
design and phase breakdown.

## Status

Runtime-discovered BYO-S3 uploader.

- Shared Connection gate (`@sparcd/auth-ui`) — three fields, endpoint-inferred
  region / path-style / secure behind "Advanced".
- Tool chrome with section tabs (New upload · History · Settings), upload-state
  pill, and a light/walnut-dark theme toggle.
- Four-step flow: Drop, Inspect, Assign, Upload.
- Drag-and-drop a folder (or "Choose folder"); recursive JPEG + MP4 scan via
  the File System Access entries API / `webkitdirectory`.
- EXIF, SHA-256, and thumbnails run in Web Workers; validation runs on the
  results in the main thread.
- The app discovers readable settings buckets by probing for
  `Settings/locations.json`, and discovers target collections from
  `Collections/<uuid>/collection.json`.
- Dry-run is on by default. Wet uploads use the connected credentials directly;
  IAM and bucket CORS are the real access gates.
- Blob lanes stripe across the shard origins the endpoint implies: same host,
  https, every port up to 8462 — the range `apps/sparcd-shard-proxy` publishes
  from. All of them are probed once per session and the lanes use whichever
  answered, so the proxy operator sets the shard count (7 on the deployed one)
  and an endpoint with none uploads over the single connection. Nothing to
  configure.
- History lists prior runs and resumes interrupted uploads from the ledger.
- Published uploads can be edited after the fact (description, deployment
  reassignment) through the single reviewed conditional-replace path, with
  immutable pre-change snapshots.

## Static BYO-S3 Contract

Fact: this app is a static SPA. It has no backend service, no server-side
session, and no trusted server-side environment variables.

Decision: users bring their own S3-compatible endpoint, credentials, settings
bucket, and collection bucket. The app discovers usable buckets at runtime from
the permissions granted to those credentials.

Security controls:

- IAM or provider policy limits which buckets, prefixes, and S3 actions the
  credentials can use.
- Bucket CORS controls whether this hosted web origin can call S3 from the
  browser.
- `@sparcd/s3-safe` is the only S3 client boundary in the app. It exposes read
  methods, immutable append-only writers, and one reviewed ETag-gated
  conditional-replace method (`replaceIfUnchanged`). It exposes no delete or
  copy API.
- Conditional writes, `HEAD` verification, dry-run-by-default, and completion
  sentinels reduce accidental publish risk.
- The secret key never reaches `localStorage`; only the endpoint, access key
  and region go there, to pre-fill the Connect form. The full credentials live
  in a tab-scoped `sessionStorage` stash, so switching between SPARC'd tools in
  the same tab and reloading keep the session, and closing the tab ends it.

Non-controls:

- Build-time `VITE_*` bucket allowlists are not used for authorization.
- Client-side bucket discovery is not authorization. It only finds buckets the
  supplied credentials and CORS policy already expose.
- Official SPARC'd hosting follows the same model. Official credentials must be
  scoped by IAM/provider policy, not by static app configuration.

## Develop

```sh
pnpm install          # from the repo root
pnpm --filter sparcd-uploader dev
```

Optional dev prefill: copy `.env.example` to `.env` and set
`VITE_SPARCD_S3_ENDPOINT` (endpoint only — never secrets).

## Shared packages

This app established the workspace's shared packages, all consumed as
TypeScript source (no `dist/`):

- `@sparcd/types` — `S3Config`, `Collection`, `Species`, `UserSession`, and the
  pure `detectBackendDefaults` endpoint inference.
- `@sparcd/s3-safe` — the single blessed S3 boundary (runtime scope + read
  methods + immutable writers).
- `@sparcd/auth-ui` — the shared Connection screen.
- `@sparcd/camtrap` — Camtrap-DP types and CSV/metadata writers.
