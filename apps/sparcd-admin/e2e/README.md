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
`127.0.0.1:8797`, builds the app and serves it on `127.0.0.1:5411`. Everything
it started is stopped again when it finishes, and the MinIO volume goes with
it. Playwright's browser comes from `pnpm exec playwright install chromium` if
this machine has not got one yet.

## What it covers

| file | what it proves |
|---|---|
| `specs/s0-guard.spec.ts` | the run refuses storage it cannot prove it owns |
| `specs/s1-sign-in.spec.ts` | the administrator signs in; the seeded lists are there |
| `specs/s2-invite-ana.spec.ts` | an invite works once; "Can upload" means exactly that |
| `specs/s3-look-and-identify.spec.ts` | "Can look" and "Can identify", down to the Tagger's own files |
| `specs/s4-pause-resume-reset.spec.ts` | pause, resume and a fresh sign-in all take effect |
| `specs/s5-collection-members.spec.ts` | the members table, its one rule, and the change reaching storage |
| `specs/s6-lists.spec.ts` | a rename with a history behind it, retiring, and a refused latitude |
| `specs/s7-activity.spec.ts` | activity as sentences, and who downloaded a given image |
| `specs/s8-canary.spec.ts` | a bucket outside the namespace stays invisible and unchanged |
| `specs/s9-not-an-admin.spec.ts` | a login that cannot manage gets one plain screen |
| `specs/z-shots.spec.ts` | a full-page picture of every screen, desktop and phone, and that none of them scrolls sideways at 390px |

The scenarios build on one another — S5 rearranges the people S2 and S3
invited — so they run in order on one worker, and a single spec cannot be run
on its own once it depends on an earlier one.

Screenshots land in `shots/desktop/` and `shots/phone/` and are committed.
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
| `E2E_APP_PORT` | `5411` | where the built app is served |

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
