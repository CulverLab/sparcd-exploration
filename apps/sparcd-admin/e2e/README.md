# The Admin app end to end

One ordered story, run in a real browser against a real access proxy and real
storage: an administrator signs in, invites three people, narrows and widens
what they can do, and every step is checked twice — once on screen, once with
an S3 client holding that person's own key.

```sh
pnpm --filter sparcd-admin e2e
```

That is all it takes locally. The run brings up its own MinIO on loopback,
seeds it, creates the first administrator, starts the access proxy on
`127.0.0.1:8797`, and builds and serves three apps: the Admin app on
`127.0.0.1:5411`, the Uploader on `5413` and the Tagger on `5414`. Everything
it started is stopped again when it finishes, and the MinIO volume goes with
it. Playwright's browser comes from `pnpm exec playwright install chromium` if
this machine has not got one yet.

The Uploader and the Tagger are there because the people this suite invites do
not stop at the Admin app. A "Can upload" person completes a real upload of
real JPEGs through the Uploader, a "Can identify" person tags one of those
images in the Tagger and saves it, and a "Can look" person is refused — all of
it through the same access proxy, with logins the Admin app handed out.

## What it covers

Strictly: a row is *covered* only when a spec does the thing through the user
interface and then checks the result, either on screen or with an S3 client
holding that person's own key.

### Signing in, and the chrome around everything

| feature | spec | status |
|---|---|---|
| the connect form, and the lists behind it | `s1-sign-in` | covered |
| joining from an invite link, once | `s2-invite-ana` | covered |
| a link that has been used, or has been reset out from under someone | `s2-invite-ana`, `s4-pause-resume-reset` | covered |
| a login that cannot manage SPARC'd | `s9-not-an-admin` | covered |
| logging out, as an administrator and as everyone else | `s7d-settings-theme-logout`, `s9-not-an-admin` | covered |
| the light and dark switch | `s7d-settings-theme-logout` | covered |
| a malformed invite link | — | not covered ([why](#not-covered-and-why)) |
| the four-section shape storage without an access service gets | — | not covered ([why](#not-covered-and-why)) |

### Species and Locations

| feature | spec | status |
|---|---|---|
| the list, and its count sentence | `s1-sign-in`, `s6b-registry` | covered |
| the search box, and "Nothing matches that search." | `s6b-registry` | covered |
| adding a species | `s6b-registry` | covered |
| adding a location | `s6b-registry` | covered |
| changing a record and saving it into `Settings/species.json` / `locations.json` | `s6-lists`, `s6b-registry` | covered |
| the count of changed records | `s6-lists`, `s6b-registry` | covered |
| the history entry beside every save, prepared and applied | `s6-lists` | covered |
| retiring, and bringing back | `s6-lists` | covered |
| the Active / Retired pill | `s6-lists`, `s6b-registry` | covered |
| the Protected location box, stored as `sensitive`, and its shield | `s6b-registry`, `z-shots` | covered |
| a latitude that is not a plain decimal, refused where it was typed | `s6-lists` | covered |
| a location ID moved somewhere free | `s6b-registry` | covered |
| a location ID moved onto one another location holds | `s6b-registry` | covered |
| the two sites legacy data gave one ID, still editable | `s6b-registry` | covered |
| "Someone else changed this list", with the draft kept | `s6c-two-administrators` | covered |
| saving on top of someone else's save | `s6c-two-administrators` | covered |
| a history entry that did not go through, and "Retry history entry" | `s6c-two-administrators` | covered |
| a duplicate scientific name | — | not covered ([why](#not-covered-and-why)) |
| Close | — | not covered ([why](#not-covered-and-why)) |

### Collections

| feature | spec | status |
|---|---|---|
| the collection list and its search | `s6d-collection-details` | covered |
| a collection's details, saved into its `collection.json` | `s6d-collection-details` | covered |
| a required field left empty | `s6d-collection-details` | covered |
| the collection's ID, shown and unchangeable | `s6d-collection-details` | covered |
| "Someone else changed this collection", with the draft kept | `s6c-two-administrators` | covered |
| the members table, and the change reaching storage | `s5-collection-members` | covered |
| the rule that somebody has to run the collection | `s5-collection-members` | covered |
| adding a person to the members table | `s5-collection-members` | covered |
| the checklists, open, with their count sentence | `s6e-checklists`, `z-shots` | covered |
| ticking and unticking, saved into the collection's `species.json` / `locations.json` | `s6e-checklists` | covered |
| the rule that a collection keeps at least one | `s6e-checklists` | covered |
| Undo, once | `s6e-checklists` | covered |
| "out of date with the shared list", one by one and "Update them" | `s6e-checklists` | covered |
| the Retired and "Not in the shared list" labels | `s6e-checklists` | covered |
| the checklists' own search | `s6e-checklists` | covered |
| Remove and the exact-locations box *in the members table* | — | not covered ([why](#not-covered-and-why)) |

### People

| feature | spec | status |
|---|---|---|
| the list, its count, the status pills and last-active | `s2-invite-ana`, `s4-pause-resume-reset`, `s7b-people-panel` | covered |
| the search box, and "Nobody matches that search." | `s7b-people-panel` | covered |
| Add a person, with a collection and without one | `s2-invite-ana`, `s3-look-and-identify`, `s7b-people-panel`, `sa-real-apps` | covered |
| the invite link, Copy, and Add another person | `s7b-people-panel` | covered |
| the mail behind "Email it instead" | `s7b-people-panel` | covered |
| a person's access rows | `s2-invite-ana`, `s7b-people-panel` | covered |
| Add to a collection | `s7b-people-panel` | covered |
| Change, including the exact-locations box | `s7b-people-panel` | covered |
| Remove | `s7b-people-panel` | covered |
| Pause, resume, and reset | `s4-pause-resume-reset` | covered |
| backing out of either confirmation | `s7b-people-panel` | covered |
| making someone an administrator | — | not covered ([why](#not-covered-and-why)) |

### Activity

| feature | spec | status |
|---|---|---|
| the timeline, as sentences | `s7-activity` | covered |
| each of the six kind chips | `s7c-activity-filters` | covered |
| the person filter | `s7c-activity-filters` | covered |
| the collection filter | `s7c-activity-filters` | covered |
| the time range | `s7c-activity-filters` | covered |
| a burst of the same thing, collapsed to one line with a count | `s7c-activity-filters` | covered |
| what comes out of "Download as spreadsheet" | `s7c-activity-filters` | covered |
| "Who downloaded this image?" | `s7-activity` | covered |

### Settings

| feature | spec | status |
|---|---|---|
| the name, and it turning up as the actor on a history entry | `s7d-settings-theme-logout` | covered |
| the warning that a change with no name is recorded under the login ID | `s7d-settings-theme-logout` | covered |

### The other two apps, through the same proxy

| feature | spec | status |
|---|---|---|
| "Can upload" signs in to the Uploader and completes a real upload | `sa-real-apps` | covered |
| that person is offered their own collection and no other | `sa-real-apps` | covered |
| the objects, all eight of them, in storage under that collection | `sa-real-apps` | covered |
| the upload on the administrator's Activity screen | `sa-real-apps` | covered |
| the shard probe staying quiet against an endpoint with a port | `sa-real-apps` | covered |
| "Can look" tries the same and is refused, in readable words | `sa-real-apps` | covered |
| "Can identify" opens that upload in the Tagger, tags an image, saves | `sa-real-apps` | covered |
| `observations.csv` changing in storage as a result | `sa-real-apps` | covered |
| that person still cannot add a photo | `sa-real-apps` | covered |

### The run itself

| feature | spec | status |
|---|---|---|
| the guard on what storage this run may write to | `s0-guard` | covered |
| a bucket outside the namespace, invisible and unreachable | `s8-canary` | covered |
| a picture of every screen, at two sizes, and no sideways scroll at 390px | `z-shots` | covered |

### Not covered, and why

- **Making someone an administrator.** The People screen offers no control for
  it. `s6c-two-administrators` makes a second administrator through the JSON
  API instead, then signs in as them and drives the screens, so the *state* is
  covered even though the button does not exist to press.
- **Remove and the exact-locations box inside the members table.** They call
  the same two endpoints as the People panel's Change and Remove, on the same
  rows, and `s7b-people-panel` drives both of those through the interface and
  checks the effect with the person's own key. Adding them here would repeat
  that without testing anything new.
- **A duplicate scientific name.** Same rule and same code path as a duplicate
  location ID (`validation.ts`), which `s6b-registry` drives both ways —
  refused on a conflict, allowed onto a free value.
- **Close** on a record. It clears the open record and touches nothing else.
- **A malformed invite link.** The join page's "This link is missing
  something." branch needs a link this suite never produces.
- **The four-section shape.** Storage with no access service gets Species,
  Locations, Collections and Settings and no People or Activity. This stack is
  built around the access proxy, so there is nothing here to point at that
  answers plain S3 and nothing else.

### Ordering

The scenarios build on one another — S5 rearranges the people S2 and S3
invited, S6e reads the lists S6b changed, `sa-real-apps` uploads as somebody it
invited itself — so they run in order on one worker, and a single spec cannot
be run on its own once it depends on an earlier one.

Screenshots land in `shots/desktop/` and `shots/phone/` and are committed. They
are taken at twice the pixel density, so a desktop picture is 2880px wide.
They are there to be looked at.

## Pointing it somewhere else

Configuration is environment variables only; nothing here reads a `.env`.

| variable | default | meaning |
|---|---|---|
| `E2E_UPSTREAM` | *(unset)* | the S3 endpoint. Unset means "start MinIO on loopback" |
| `E2E_S3_ACCESS_KEY_ID` | `admine2ekey` | the credential the run seeds and re-signs with |
| `E2E_S3_SECRET_ACCESS_KEY` | `admine2esecret` | " |
| `E2E_NAMESPACE` | `e2e-` | prefix every upstream bucket carries |
| `E2E_CREATE_BUCKETS` | on locally | whether the run may create its own buckets |
| `E2E_KEEP` | off | leave the data and the container in place afterwards |
| `E2E_PROXY_PORT` | `8797` | where the access proxy listens |
| `E2E_APP_PORT` | `5411` | where the built Admin app is served |
| `E2E_UPLOADER_PORT` | `5413` | where the built Uploader is served |
| `E2E_TAGGER_PORT` | `5414` | where the built Tagger is served |
| `E2E_LATENCY_MS` | `0` | hold every proxy-to-storage request this many ms, plus up to 50% jitter |

All three apps are built with `VITE_SPARCD_S3_ENDPOINT=''` and
`VITE_SPARCD_S3_WRITE_SCOPE='*'` set in the environment, which Vite gives
precedence over any `.env` file, so a developer's pinned endpoint or write
scope cannot narrow what the run exercises.

### Running it against slow storage

```sh
pnpm --filter sparcd-admin e2e:slow      # the same suite at 150 ms per request
E2E_LATENCY_MS=400 pnpm --filter sparcd-admin e2e
```

Loopback MinIO answers in well under a millisecond; real storage takes 100–200
ms per request, and that gap is where the app's races with its own reloads
live. With `E2E_LATENCY_MS` set, `stack.mjs` starts a small forwarder on
loopback (`latency.mjs`) and points the access proxy at it instead of straight
at MinIO. It passes the host header and the body through byte for byte, so the
signatures the proxy makes still verify upstream. Seeding keeps the direct
endpoint: only the traffic a person waits on is slowed.

Both ports differ from the ones the access proxy's own integration run and the
other apps use, so two suites can run side by side.

### The guard

`target.mjs` decides, before a byte moves, whether the upstream is one this run
may write to. Loopback is storage the run owns: it creates buckets, seeds them
and drops them again. Anything else has to be provably contained, or the run
refuses to start:

- `E2E_NAMESPACE` must be set, so every bucket the run touches carries a prefix
  of its own;
- it must not start with `sparcd`, which is what real collection and settings
  buckets carry;
- `E2E_CREATE_BUCKETS` must be off, so the buckets have to exist already.

In that mode no MinIO is started, no bucket is created or dropped, and cleanup
removes only the keys this run wrote. `specs/s0-guard.spec.ts` is the test of
that decision, and it needs no browser and no sockets.

```sh
E2E_UPSTREAM=https://storage.example.org \
E2E_NAMESPACE=scratch- \
E2E_S3_ACCESS_KEY_ID=... E2E_S3_SECRET_ACCESS_KEY=... \
pnpm --filter sparcd-admin e2e
```
