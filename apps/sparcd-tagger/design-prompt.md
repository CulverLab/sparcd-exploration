# Claude Design prompt — sparcd-tagger

Paste into the **existing SPARCd Field Notebook v2 thread** in
[claude.ai/design](https://claude.ai/design) — it already has the locked
tokens, typography, and the existing Tagger screen in context. This prompt
asks to evolve that screen into a full tool and add new states, in the same
style, plus a dark variant. Expect Claude Design to ask clarifying
questions before it renders; answer them, then let it build the screens as
real HTML/CSS/JS.

---

Continuing in the **Field Notebook v2** style we've established (cream
paper, Newsreader serif + Inter Tight + JetBrains Mono for data, ink-blue
`#0b3358` accent, hairline `rule` dividers, sharp corners, 14px body floor,
32px hit targets, 2px accent focus ring, `mark` #ead8a3 active-row
highlight, WCAG AA), design the **new pages** for a separate tool:
**sparcd-tagger**.

We already have a Tagger screen in this thread — use it as the starting
point and evolve it into the full tool below, keeping its quiet active-row
treatment and image-only photo frame. Don't introduce a new palette or
typeface — extend the one we have.

This is a standalone static tool, so drop the cross-app SPARC'd tab bar
(Home/Collections/Search/Maps) — nothing should imply navigation this
single-purpose bundle can't perform. **Instead, reuse the same top-nav tab
component for the tool's own internal sections**, so it still reads as
family while giving the tool real internal navigation. Chrome: paw +
"SPARC'd · Tagger" wordmark, the tool's section tabs, and the sync-state
pill. Don't introduce a new palette or typeface — extend the one we have.

### Internal navigation (section tabs)

- **Browse** — choose a collection, then an upload to tag, with
  tagged/untagged counts. This is the entry point into the workspace.
- **Tag** — the three-pane tagging workspace (active once an upload is
  chosen).
- **History** — sync history across uploads, plus the per-upload version
  list (the recovery view, generalized): every prior synced version with
  timestamps, previewable, restorable into local.
- **Settings** — connection/credentials, connected-account attribution,
  burst-grouping threshold, dry-run default.

## The tool, the user, the job

A focused tool for tagging camera-trap images, used by **both experts and
volunteers**. A researcher tags several hundred to several thousand images
in a sitting — maybe 200 in 45 minutes on a 13–16" laptop. Keyboard fluency
matters for the experts; but volunteers don't know the species list cold —
**a core part of the real workflow is visually scanning the species list to
recognize or recall the right animal** (forgot the name, unsure which
variant). So the species selector must be *browsable*, not only
*type-to-filter*. Tagging is local-first; a manual "Sync" writes append-only
versioned files and never overwrites canonical data — nothing here is
destructive, and the UI should make that felt.

## New pages and states to render

### Connection (shared component)

Use the **shared credentials screen** — the same form for every JS tool. If
it already exists in this thread (e.g. from the uploader pass), reuse it
as-is; if not, create it once from this spec: endpoint, access key, secret
key, secure-HTTPS toggle, region, force-path-style toggle, and a backend
preset dropdown (MinIO / AWS S3 / Cloudflare R2) that fills region +
path-style, plus connected-account attribution and dry-run default. Either way,
don't fork it — the only per-tool change is the chrome label
("SPARC'd · Tagger"). It gates the tool on first run. The connected username is
shown read-only under Settings; disconnected local batches use a separate
session-scoped handoff identity.

### Browse (entry point)

Choose a collection, then an upload to tag — a list/table with
tagged/untagged counts per upload, sync status, and last-tagged time.
Selecting an upload opens the Tag workspace.

### Tag — the workspace states:

Keep the familiar three-pane shape (image overview · image area · tag
panel). The key change from the current screen: **the overview shows
thumbnails, not text rows, and supports tagging many images at once.**

1. **Overview / bulk-tag — the primary working state.** The image overview
   offers **two view modes, file-explorer style, switched by a segmented
   button group** in the overview header:
   - **Grid** — thumbnail cards.
   - **List** — denser rows, each with a **tiny thumbnail** plus metadata
     (filename, timestamp, current tags, deployment).
   Both views group images into **bursts** (frames within ~60s on one
   camera) as clearly delineated bands, and both support the same rich
   **multi-selection** — single, Shift-range, Cmd/Ctrl-add, and "select
   whole burst." The right tag panel applies a species/count/behavior to
   **all selected images at once** ("applies to N selected"). This is where
   a researcher clears most of an upload quickly; selected items use the
   `mark` highlight. Render both view modes.
2. **Focus — the single-image detail view.** Drilling into one thumbnail
   opens the big single-image view (the familiar one): large photo, zoom,
   tag chips overlaid. Image-adjustment controls (brightness/contrast for
   hard night frames) live in a **collapsible inspection rail or compact
   toolbar — never occluding the subject by default.** `J`/`K` step through
   images; this is for careful IDs, not bulk work. Make the overview↔focus
   transition obvious and keyboard-driven (a breadcrumb / back affordance).
3. **Species / label panel — persistent, browsable, with example
   thumbnails.** This is the most important correction to the current
   build: the species selector must be an **always-visible, scrollable
   list**, not only a type-to-filter popover. Each row carries an **example
   thumbnail of the animal** (so a volunteer can recognize it without
   knowing the name), the common name, and the scientific name in
   Newsreader italic, plus its quick key if any. A filter box sits at the
   top; recent / numeric-key species pin above the full scrollable list;
   Genus→Species hierarchy drill stays available. The fast keyboard path
   (type-to-filter, `1`–`9`) layers on top — additive, the browse list
   never goes away. A free-text "request species" row handles species not
   in the registry (encoded downstream as `[REQUESTED_SPECIES:…]`). The
   vocabulary includes non-animal labels — notably **Ghost** (empty /
   false-trigger frame), shown as a text chip rather than a photo — applied
   exactly like a species; Ghost pins near the top with a quick key, is
   **not** a separate mechanism, and there is no automated ghost detection.
   (The example-image source is a build concern — a per-species reference
   image or a representative tagged frame, sourced upstream; in the mock,
   use placeholders.)
4. **Keyboard cheatsheet modal** (`?`) — grouped shortcuts in mono kbd
   tokens: `J`/`K` image nav, `Shift+J`/`Shift+K` burst nav, `Space`
   species, `1`–`9` recent species, `G` quick-tag **Ghost** (empty frame —
   a normal label, fast key because it's common), `X` questionable,
   `Cmd/Ctrl+A` select burst.
5. **Sync confirmation dialog** — "N additions · M modifications · 0
   deletions", with a clearly distinct **dry-run** state vs. live.
6. **Recovery view** — lives under the **History** section: every prior
   synced version for an upload (timestamps in mono), previewable, each
   with "restore into local".
7. **Sync-state pill** in the top nav, all states: `local-only` (nothing
   synced yet, no pending edits), `unsynced edits` (dirty local drafts not
   yet pushed — distinct from `local-only`), `syncing…`, `synced @ <time>`,
   `conflict`, `dry-run`, `error`. Distinct by shape + icon, not color
   alone.
8. **Failure and empty states** — these are common enough to design
   explicitly, in the Field Notebook language (not generic error cards):
   - image fails to load / **expired presigned URL** (with a re-fetch
     affordance);
   - **no species file** available (autocomplete can't load — degrade to
     free-text request entry);
   - **no local drafts yet** (fresh upload, nothing tagged);
   - an upload with zero images / all images already tagged.

## Dark mode

**Reuse the walnut/leather dark token set already established in this
thread for the uploader — same values, don't re-derive them.** Cross-tool
consistency depends on the tagger and uploader sharing the exact dark
palette (paper `#1d1812`, panel `#2a221a`, ink `#f1e9d4`, rule `#7a6e57`,
accent `#7cb5e8`, etc.). Render every tagger page in both themes as a token
swap on the same component tree — light is the locked Field Notebook v2
set, dark is that established walnut set. Newsreader / Inter Tight /
JetBrains Mono unchanged. WCAG AA on both.

## Design requirements

- Information density like a code editor, but warm, per the Field Notebook
  paper aesthetic.
- The **dry-run vs live** distinction is the most important safety signal;
  make it unmistakable in both themes.
- Keyboard focus must be visible and obvious at every step. In at least one
  state (the main working state is the richest), show the **intended tab
  order and the active focus target** explicitly, so the keyboard path is
  unambiguous for implementation.
- **Viewport check (main screens only, light mode):** design and verify the
  Overview (list + grid) and Focus at **1280×800 and 1440×900**. At
  1280×800 the three panes + thumbnails must not overlap, clip, or force
  horizontal scroll. No need to re-render every state at every size, and no
  need to verify dark mode at each viewport — assume it follows the light
  layout.

## Component inventory

**Reuse the shared components already built in this thread** for the
uploader — don't redraw them, just re-skin per tagger context:

- section-tab nav / tool chrome
- credentials form + backend-preset dropdown (the shared Connection screen)
- state pill (same chrome treatment; tagger's states are
  `local-only` / `unsynced edits` / `syncing…` / `synced` / `conflict` /
  `dry-run` / `error`)
- dry-run banner
- dialog / modal shell

**New tagger-specific components** to add (light + dark), so the build
consumes parts, not just pages:

- browse row (collection / upload, with tagged/untagged counts)
- **view-mode switch** — list / grid segmented button group
- **grid thumbnail card** (unselected / selected / tagged)
- **list row** with a tiny thumbnail + metadata (unselected / selected / tagged)
- **burst band** header/grouping (shared by both views)
- multi-select + "applies to N selected" bulk-tag affordance
- overview↔focus toggle / breadcrumb (back to overview)
- photo frame (loaded / loading / failed / expired-URL) — the focus view
- image-adjustment controls (collapsible inspection rail / compact toolbar)
- **persistent species/label list** (scrollable) + filter box
- **species/label row** = example thumbnail + common name + scientific name
  (Newsreader italic) + quick key; selected / hover / Ghost (text-chip) variants
- recent-species chip strip and `1`–`9` keyboard hints
- **count stepper** on the applied label (set N individuals explicitly)
- behavior field
- keyboard cheatsheet modal
- sync confirmation dialog (additions / modifications / 0 deletions)
- recovery-version list row
- empty / failure state block

## Out of scope (don't design these)

Image upload (separate tool), user management, species-hierarchy editing,
server-rendered anything, analytics/leaderboards/gamification, mobile or
tablet layouts.

## Framing

Describe the tool by what it **is** and **does**, alongside SPARC'd. Avoid
positioning it relative to other systems.

---
---

# Follow-up prompt · revision 1 — species browse list

> Send this as the **next message in the same Claude Design thread**, after
> the first Tagger build. Do **not** re-send the prompt above — the Tagger
> page already exists; this asks for targeted changes, not a rebuild.
> Everything below paraphrases cleanly into one chat message.

---

The Tagger page is close. One important change plus two small ones — keep
everything else exactly as built, in both light and dark.

**1. Make the species selector browsable, with example thumbnails.** Right
now it's type-to-filter (combobox + numeric keys) — great for experts, but
not for volunteers, and visually scanning the species list to *recognize*
an animal is core to this workflow. Turn the species selector in the tag
panel into a **persistent, always-visible, scrollable list**:

- Each row: an **example thumbnail of the animal** (placeholder is fine in
  the mock), the common name, the scientific name in Newsreader italic, and
  the quick key if it has one.
- Filter box stays pinned at the top; recent / numeric-key species pin above
  the full scrollable list; the Genus→Species hierarchy drill stays
  available.
- Keep the keyboard fast path (type-to-filter, `1`–`9`) — this is additive;
  the browse list just becomes always-visible instead of a popover.
- **Ghost** stays a text chip (no photo), pinned near the top with its key.

(The real example-image source is a build concern — a per-species reference
image or a representative tagged frame, sourced upstream. Placeholders are
fine here.)

**2. Count stepper.** Make it explicit *where* you set the number of
individuals on an applied label (e.g. "Mule Deer × 3") — a small stepper on
the selected row, not just a displayed number.

**3. Behavior field.** Confirm the behavior field is reachable in the tag
panel (progressive disclosure is fine).

Everything else — the overview list/grid, focus view, history, settings,
chrome, dry-run treatment — stays as built. Apply these changes in both
themes, reusing the established walnut dark tokens.

---
---

# Follow-up prompt · revision 2 — species keybindings (drop rotating 1–9)

> Send as the **next message in the same thread**. Targeted change to the
> species panel only — everything else stays.

---

The "RECENT · NUMERIC KEYS" 1–9 chip block isn't pulling its weight. The
real species list is large, and auto-rotating numeric keys can't build
muscle memory (the number for a species keeps changing as recents shift),
while the block competes with the browsable list for space. Switch to the
model the existing workflow already uses:

- **Per-species, user-assignable, persistent keybindings.** Each row in the
  species list can carry a key the user assigns once (any key), shown as a
  small kbd badge on that row. Pressing it tags that species. Bindings are
  **stable — they don't rotate** — so muscle memory works. Most species have
  no binding, and that's fine.
- **"Assign key" affordance per row** — a small control revealed on
  hover/focus to set or clear a row's binding.
- **Type-to-filter stays the default** and scales to any number of species.
  Suppress keybindings while the filter box is focused, so typing a species
  name never fires a tag.
- **Remove the separate 1–9 recents chip block.** Instead, sort
  recently/frequently-used-this-session species to the **top of the
  scrollable list** (ordering only — no numeric keys), so the local fauna is
  one glance away.
- **Ghost** keeps a default binding (`G`) as a normal pre-bound row,
  consistent with the model — not a special case.

Everything else in the tag panel (thumbnails, scientific names, count
stepper, behavior, the persistent scrollable browser) stays. Apply in both
themes.

(This mirrors the SPARC'd Java app: each species carries a user-assigned
`keyBinding` and bindings are suppressed while searching. The `keyBinding`
field already exists per species in `species.json`, so this is
data-compatible.)

---
---

# Follow-up prompt · revision 3 — remove the behavior field

> Send as the **next message in the same thread**. Small, surgical change to
> the tag panel only.

---

Remove the **Behavior** field from the tag panel everywhere it appears (the
applied/pending rows and the bulk "Will apply" row). It was a mistake on my
side: a SPARC'd tagged observation is **species + count only** — there is no
behavior value in the dataset or the app's data model. An applied row should
read just **species (common + scientific) + a count stepper** (and Remove).

Keep everything else exactly as built — the persistent species browser with
thumbnails, scientific names, assignable keybindings, count steppers, the
overview/focus/history/settings, chrome, and dry-run treatment. Apply in
both themes.

---
---

# Follow-up prompt · revision 4 — time correction + simplified login

> Send as the **next message in the same thread**. Two changes in one
> message: timestamp correction in the tagger, and a simplified Connection
> screen (which is shared, so it updates the Uploader too). Everything else
> stays. Apply both in light and dark.

---

## Change 1 — Timestamp correction (tagger)

Camera clocks are often wrong (DST, timezone, drift), and corrected
timestamps matter (they drive activity analysis). The tagger needs
timestamp correction at two levels — mirroring the SPARC'd Java app's "time
shift" (signed offsets in year / month / day / hour / minute / second with a
live before→after preview):

1. **Upload-level time offset.** A "Time shift" control for the whole upload,
   reachable from the Tag workspace (e.g. a button near the breadcrumb /
   upload context, and/or in upload-scoped Settings). Signed spinners for
   y / mo / d / h / m / s with a live "original → corrected" preview on a
   sample timestamp. Applying it shifts **every image in the upload** by
   that delta (the "+1 hour" case). Show a persistent indicator when an
   offset is active (e.g. a small `clock +1h` chip) so it's never silently
   on.
2. **Per-image timestamp edit.** In the **Focus** (single-image) view, make
   the timestamp editable — an "adjust time" affordance that overrides that
   one image's time on top of any upload offset. Show the corrected time
   prominently and the original subtly beneath.

Both are **non-destructive corrections** — they never overwrite the original
EXIF. They're stored as a correction (upload offset + optional per-image
override) and surface as the displayed and synced timestamp. (How the
corrected time is written follows the upstream SPARC'd convention; the
implementer confirms it — preview/placeholder only in the mock.)

## Change 2 — Simplify the Connection screen (shared, both tools)

The Connection screen has too many fields. Pare it down to the **three that
matter: Endpoint, Access key, Secret key.** Everything else is inferred, not
asked:

- **Secure (HTTPS)** comes from the endpoint scheme (`https://` → secure;
  default secure when no scheme).
- **Region and path-style** are auto-detected from the endpoint host
  (`*.r2.cloudflarestorage.com` → region `auto`, path-style off;
  `*.amazonaws.com` → region from the URL, path-style off; otherwise MinIO
  defaults). Remove the backend-preset dropdown, the region field, and the
  path-style toggle from the main screen.
- If a rare mismatch needs a manual region / path-style, tuck those behind a
  collapsed **"Advanced"** disclosure — hidden by default.
- Keep the connected username out of the login gate: derive it from the access
  key and show it read-only under **Settings**. A disconnected local batch may
  collect its separate session-scoped handoff identity there.

Result: the first-run gate is **three fields + a Connect button**, in the
Field Notebook style. Because the Connection screen is shared, this updates
both the Uploader and the Tagger; the chrome label still says which tool
you're connecting to ("SPARC'd · Uploader" / "· Tagger").
