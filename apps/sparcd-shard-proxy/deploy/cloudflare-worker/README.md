# Cloudflare Worker recipe

The serverless shape of the same idea: N hostnames on one Worker, each its own
browser origin, all forwarding to one S3 upstream. Nothing to operate, no VM,
no certificates to renew.

## The trade-off, up front

**A Worker cannot preserve the client's Host header on a cross-zone
subrequest.** Cloudflare rewrites it to the upstream's hostname. SigV4 signs
Host, so the browser's signature is invalid by the time the request lands —
signature passthrough is not available here, at any amount of cleverness.

So this Worker **verifies, then re-signs**, and it holds two credential pairs
to do it:

| | held by | signs / verifies |
|---|---|---|
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | the Worker only | the upstream request |
| `CLIENT_ACCESS_KEY_ID` / `CLIENT_SECRET_ACCESS_KEY` | the Worker and its browser clients | the inbound request |

Every request must arrive carrying a valid SigV4 signature over the client
pair. The Worker recomputes that signature and rejects a mismatch with 403
before the upstream credential is touched. **CORS does not substitute for
this**: it restrains browsers and nothing else, so a Worker that re-signs
whatever arrives is an open proxy for its own S3 credential, reachable by
`curl` from anywhere.

What that buys and costs:

- **The real S3 credential never leaves the Worker.** Browsers hold only the
  proxy-issued pair, which is scoped to this proxy and which you can rotate on
  its own — a leaked client pair is a `wrangler secret put` away from dead,
  with no involvement from whoever issued the underlying S3 key.
- **The Worker can act on the bucket by itself**, which the Caddy recipe's
  proxy cannot. Scope the upstream key tightly: one bucket, the operations you
  actually need.
- **Clients are unchanged.** A browser S3 client signs exactly as it does
  today, with the shard hostname as its endpoint and the proxy-issued pair as
  its credentials.
- **Replay inside the signature window is accepted.** The Worker requires
  `x-amz-date` within ±15 minutes and rejects anything older, which is the same
  posture S3 itself takes; it does not track nonces. Within that window a
  captured request can be sent again. See below for what that does and does not
  let an attacker change.
- **Request bodies are capped**: 100 MB on the free plan, 500 MB on paid.
  Camera-trap JPEGs and short MP4s are well under that; a multi-GB object is
  not.
- **The passthrough option is the VM.** If you need a proxy that holds no
  credential at all, use [Docker + Caddy](../../README.md#docker--caddy) or the
  [Jetstream2 image](../jetstream2/).

Everything else matches the Caddyfile: the Worker owns CORS, strips the
upstream's per-bucket CORS headers, removes the SDK's `?x-id=` param, and
buffers request bodies so a length-less body never reaches the upstream as
`Transfer-Encoding: chunked`.

## Protected coordinates

This legacy Worker has one proxy credential and no per-person collection
membership table, so it cannot enforce `exactLocations`. It refuses
`Settings/locations.json`, collection `locations.json`, and upload
`deployments.csv` requests rather than forwarding precise coordinates. Use the
[per-person access proxy](../../access/) when a deployment needs authorized
coordinate access or coordinate redaction.

## What a replayed request can change

Inside the 15-minute window, a captured request can be sent again. What an
attacker can *alter* while reusing the signature depends on how the client
declared its payload:

- **Nothing in the headers.** Every `x-amz-*` header must appear in the
  caller's `SignedHeaders` or the Worker rejects the request naming the
  offender. Adding `x-amz-acl: public-read` to someone else's captured PUT does
  not work, and neither does adding anything else — the Worker signs what it
  forwards, so an unsigned header would be laundered into an authentic upstream
  request.
- **Nothing in the body, when the client declared a real hash.** The Worker
  hashes the bytes it received and rejects a mismatch, so the signature is
  bound to the content.
- **The body, when the client declared `UNSIGNED-PAYLOAD`.** There is nothing
  to check the bytes against. This is a real gap and it is open by default,
  because the uploader uses it.

### Why `UNSIGNED-PAYLOAD` is accepted

The browser AWS SDK picks the mode from the body type
(`@smithy/signature-v4`'s `getPayloadHash`): a string or `ArrayBuffer` body is
hashed, anything else — `Blob`, `ReadableStream` — is declared
`UNSIGNED-PAYLOAD`. In this repo that splits cleanly:

| what | body type | declared |
|---|---|---|
| Camtrap CSVs, `UploadMeta.json` (`writeImmutable`, `replaceIfUnchanged`) | `Uint8Array` / `string` | real SHA-256 |
| images and video (`writeImmutableStream`, and its `Blob.slice` parts) | `Blob` | `UNSIGNED-PAYLOAD` |

Rejecting `UNSIGNED-PAYLOAD` would reject every image upload, which is the
entire workload. To close the gap instead, hand the SDK bytes rather than a
`Blob` — `await blob.arrayBuffer()` before the `PutObject` — and the SDK hashes
it, the Worker checks it, and the body is bound. The cost is the whole object
in memory per in-flight lane, which is exactly what the streaming path exists to
avoid; on a phone uploading a folder of images that is not a free trade. Weigh
it against your actual threat model: an attacker needs a captured signed request
and a 15-minute window to spend it in.

`STREAMING-AWS4-HMAC-SHA256-PAYLOAD` is rejected outright — verifying it means
implementing AWS's chunk framing, and nothing here emits it.

## Setup

1. **Install and configure.**

   ```sh
   npm install
   $EDITOR wrangler.toml    # UPSTREAM, S3_REGION, the shard hostnames
   ```

2. **Set the upstream credential.** Scope it to the bucket you are fronting.

   ```sh
   npx wrangler secret put S3_ACCESS_KEY_ID
   npx wrangler secret put S3_SECRET_ACCESS_KEY
   ```

3. **Mint and set the client-facing credential.** This pair is yours to invent
   — it is never sent anywhere but this Worker, so any random access-key-shaped
   string and any high-entropy secret will do:

   ```sh
   openssl rand -hex 10 | tr 'a-f' 'A-F'   # access key id
   openssl rand -base64 32                 # secret access key

   npx wrangler secret put CLIENT_ACCESS_KEY_ID
   npx wrangler secret put CLIENT_SECRET_ACCESS_KEY
   ```

   **The deployment is not complete until this step is done.** The Worker
   rejects every request while these are unset, which is the intended failure
   direction, but a Worker that verifies against a guessable pair is no better
   than one that does not verify at all.

4. **Deploy.**

   ```sh
   npx wrangler deploy --dry-run   # bundles and type-checks without publishing
   npx wrangler deploy
   ```

5. **Hand the client pair to the uploader**, together with the shard hostnames
   as its endpoints. Nothing else about the client changes.

Each `[[routes]]` entry with `custom_domain = true` gets its own DNS record in
a zone on your Cloudflare account. Four entries, four origins, four browser
connections — the whole mechanism.

This directory is a standalone npm project on purpose. It is deployed by
wrangler, not built by the repo's pnpm workspace, and it keeps its own
`node_modules` so `wrangler deploy` works from here with nothing else
installed.

## Verify it

Run the repo's smoke test **with the client-facing credentials** — that is what
a browser will present, and an unsigned run cannot tell a working Worker from a
broken one:

```sh
S3_ACCESS_KEY_ID=$CLIENT_ACCESS_KEY_ID \
S3_SECRET_ACCESS_KEY=$CLIENT_SECRET_ACCESS_KEY \
  node ../../smoke.mjs --origins https://shard1.example.org,https://shard2.example.org
```

Every origin should answer the signed checks with 2xx. A `SignatureDoesNotMatch`
means verification is rejecting your pair; the smoke test fails on it rather
than accepting it as "S3 answered".

### Against the local stack

`../../compose.dev.yaml` publishes MinIO on `localhost:9000` so the Worker can
be exercised end to end with no cloud resources:

```sh
docker compose -f ../../compose.dev.yaml up -d --wait

cat > .dev.vars <<'EOF'
UPSTREAM=http://localhost:9000
S3_ACCESS_KEY_ID=smokekey
S3_SECRET_ACCESS_KEY=smokesecret
CLIENT_ACCESS_KEY_ID=CLIENTKEY
CLIENT_SECRET_ACCESS_KEY=clientsecret
EOF

npx wrangler dev --local --port 8787

# in another shell
S3_ACCESS_KEY_ID=CLIENTKEY S3_SECRET_ACCESS_KEY=clientsecret \
  node ../../smoke.mjs --base http://localhost --ports 8787 --bucket smoke-test \
    --sign-host shard1.example.org
```

`wrangler dev` presents the request as having arrived at the first hostname in
`[[routes]]`, not at `localhost:8787`, and the Worker verifies against the
hostname the client signed. `--sign-host` matches the two up. In a real
deployment the two are the same name and the flag is unnecessary.

`.dev.vars` is untracked. Re-run with a wrong `S3_SECRET_ACCESS_KEY` on the
smoke side and every signed check comes back 403 `SignatureDoesNotMatch` — that
is the verification path doing its job.
