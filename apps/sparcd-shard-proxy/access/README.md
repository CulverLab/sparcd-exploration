# Access proxy

Per-person access for SPARC'd on storage that offers one S3 identity per
project. Each person holds a key pair the proxy issued them. The proxy verifies
the SigV4 signature on every request, decides what that person may do from the
collection memberships, then re-signs with the single upstream credential —
which never leaves the process.

The wire contract is [`CONTRACT.md`](./CONTRACT.md) and it is authoritative.
This file is how to run the thing.

Apps keep their login: endpoint, access key, secret. The only difference is
which key pair a volunteer is given.

## Layout

| file | what it holds |
|---|---|
| `server.mjs` | the `node:http` server: verify, decide, re-sign, stream back |
| `sigv4.mjs` | signature verification, shared with the Cloudflare Worker recipe |
| `namespace.mjs` | invariant 1 — the bucket mapping and the allow-glob guard |
| `rules.mjs` | request → S3 operation, and the access table |
| `store.mjs` | people and memberships, cached, reloaded on generation change |
| `activity.mjs` | the batched NDJSON writer and the two activity queries |
| `api.mjs` | the `/-/` JSON API |
| `cli.mjs` | `init`, which writes the first admin |
| `upstream.mjs` | the one upstream client |

## Run it locally

```sh
export UPSTREAM=http://127.0.0.1:9000
export S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
export ACCESS_MASTER_KEY=$(head -c 32 /dev/urandom | base64)
export BUCKET_NAMESPACE=            # empty against a store you own outright
export PUBLIC_ENDPOINT=https://proxy.example.org
export ALLOWED_HOSTS='proxy.example.org, proxy.example.org:8443'

node access/cli.mjs init --name "Your Name" --email you@example.org
node access/server.mjs
```

`init` prints an access key and secret once and refuses to run again as soon as
an admin exists. Everyone after that is invited through
`POST /-/admin/people`, and joins with `POST /-/join`.

## Environment

| variable | default | meaning |
|---|---|---|
| `UPSTREAM` | — | the one S3 endpoint, fixed at start |
| `PUBLIC_ENDPOINT` | **required** | what `/-/join` hands a new person |
| `ALLOWED_HOSTS` | **required** | comma list of Hosts this process answers for, shard ports included |
| `S3_REGION` | `us-east-1` | signing region for the upstream |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | the upstream credential |
| `BUCKET_NAMESPACE` | `` | prefix every upstream bucket carries |
| `BUCKET_ALLOW` | `sparcd,sparcd-*` | globs a client bucket must match |
| `ACCESS_MASTER_KEY` | — | 32 bytes, base64; wraps the issued secrets |
| `PORT` | `8787` | loopback listen port |
| `PUBLIC_ENDPOINT` | `UPSTREAM` | what `/-/join` hands back to a new person |
| `ALLOW_ORIGINS` | `*` | CORS; a comma-separated list pins it |
| `MAX_BODY_BYTES` | `67108864` | request bodies are buffered up to this |

`BUCKET_NAMESPACE` plus `BUCKET_ALLOW` are the containment boundary. Nothing
outside that set is read, written, listed, or named in a response, for anyone,
admins included. Responses that could name a bucket — the service root, and any
listing of the settings bucket — are rebuilt here rather than filtered, so
there is no shape of upstream answer that carries a name out.

`ALLOWED_HOSTS` is the other half of the signature check. SigV4 binds a
signature to the Host the caller dialled, so this is the list of Hosts this
process will answer for at all; a request arriving with anything else is
refused before its signature is even read. It has to include every shard port
Caddy publishes.

## Behind the Caddy shard front

The proxy listens on loopback and does no TLS. On Jetstream2 it sits behind the
existing [`Caddyfile`](../Caddyfile): Caddy keeps the certificates and the shard
ports, and reverse-proxies to `127.0.0.1:8787`.

The one thing that has to be right is the Host header. SigV4 signs it, a
volunteer's client signs the shard hostname and port it dialled, and this
process verifies against the Host it receives. So the shard sites pass
`{http.request.hostport}` and the `:443` site passes `{host}`, exactly as they
already do for the passthrough recipe. `header_up Host {upstream_hostport}`
breaks every signature silently.

`request_buffers` stays, for the same reason it always did: a length-less body
reaches an HTTP/1.1 upstream as `Transfer-Encoding: chunked`, and RGW answers
501. This process buffers too, because it has to hash the body to check it
against `x-amz-content-sha256`.

RGW also refuses a PUT that carries a `content-type` the signature does not
cover, with 403 AccessDenied; the same request signed, or with no
`content-type` at all, succeeds, and MinIO accepts either, which is why the
suites here never caught it. So every upstream request signs all its headers
(`aws: { allHeaders: true }`) and every body goes out as bytes, because Node's
fetch attaches `content-type: text/plain;charset=UTF-8` to a string body after
signing.

RGW also answers 412 to any PUT whose `If-Match` carries the double quotes S3
documents, current tag or not, while the same tag unquoted compares correctly —
current 200, stale or bogus 412. The AWS SDK sends the quoted form, so the
proxy strips the quotes off every `If-Match` it sends upstream (its own
metadata writes, and proxied client traffic after the caller's signature has
been verified); `If-None-Match` is left alone, and MinIO enforces the unquoted
form the same way.

No deployment automation ships here.

## Client notes

- **Path-style only.** The apps already use path-style for custom endpoints.
- **Strip `?x-id=`.** The AWS SDK appends it, and it is inside the signed
  canonical request, so it has to go client-side. `@sparcd/s3-safe` does it in a
  `build`-step middleware.
- **Turn the flexible checksum default off** on the Node SDK
  (`requestChecksumCalculation: 'WHEN_REQUIRED'`). The default wraps bodies in
  `aws-chunked` framing with a streaming payload hash, and a streaming hash
  carries per-chunk signatures this proxy does not verify — so it refuses them.
  Browser clients do not hit this.
- **`UNSIGNED-PAYLOAD` is accepted on S3 requests** because the browser SDK
  declares it for Blob bodies. The consequence is real: for those requests the
  body is not bound to the signature, so a captured PUT can be replayed with
  different contents until `x-amz-date` ages out. API calls under `/-/` do not
  get that latitude — their bodies must be hashed.
- **`x-amz-*` is an allowlist.** `x-amz-meta-*`, `x-amz-checksum-*` and
  `x-amz-sdk-checksum-algorithm` travel; `x-amz-content-sha256`, `x-amz-date`,
  `x-amz-security-token` and `x-amz-user-agent` are consumed here; anything
  else is a 403 rather than a silent strip, so a client that grows a header
  finds out.
- **Presigned URLs are GET and HEAD only**, capped at an hour, and never at the
  service root.

## Tests

```sh
pnpm --filter sparcd-shard-proxy test              # unit, no sockets
pnpm --filter sparcd-shard-proxy test:integration  # starts MinIO on loopback
```

The integration run brings up MinIO from Quay on a Docker-chosen loopback port,
seeds a namespace plus a bucket outside it holding a canary object, starts the
proxy on an ephemeral port, and drives it with `@aws-sdk/client-s3` holding
proxy-issued keys.
