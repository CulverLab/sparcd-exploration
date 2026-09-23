# sparcd-tagger

A static, browser-based tagging interface for SPARC'd camera-trap images. It
reads the same MinIO/R2/S3 buckets the other SPARC'd readers use and writes
back the canonical Camtrap-DP metadata the Java app, `sparcd-web`, and the
marimo explorer already read. See [`plan.md`](./plan.md) for the full design
and phase breakdown.

## Status

**P0–P6 complete, plus a time-correction pass** — the full tagging loop ships.

- The v016 data contract lives in `@sparcd/camtrap` (readers, tagger merge,
  UploadMeta delta, time-shift, tag-marker grammar) and is proven by the shared
  Vitest harness in `packages/camtrap/test` against golden fixtures.
- The app connects (shared `@sparcd/auth-ui`), discovers collections and uploads
  the same way the uploader does, and renders an upload's images from presigned
  GET URLs. Species vocabulary loads from `Settings/species.json`.
- Tagging works end-to-end: Overview/Focus workspaces over a virtualized grid,
  species panel with keybindings, local drafts, burst grouping, batch
  selection, image adjustments, and a time-shift UI.
- Writes go to S3 through the reviewed sync path — ETag-gated canonical
  replacement (`replaceIfUnchanged`) with immutable snapshots, a sync journal,
  and a recovery screen for interrupted syncs.

## Develop

Grid tiles request `Media/<sha256>/preview-640.jpg` when the image uses the hashed layout, then fall back to the original if the preview fails. Focus view always loads the original.

```sh
pnpm install
pnpm --filter sparcd-tagger dev      # Vite dev server
pnpm --filter sparcd-tagger build    # tsc --noEmit && vite build
pnpm test                            # workspace suites (camtrap, s3-safe, uploader, tagger)
```

Dev prefill: set `VITE_SPARCD_S3_ENDPOINT` in `apps/sparcd-tagger/.env`
(gitignored) to prefill the endpoint field. Credentials are never prefilled and
are entered at runtime — this is a BYO-S3 static app (see the security contract
in `plan.md`).
