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
admins included.

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

## Tests

```sh
pnpm --filter sparcd-shard-proxy test              # unit, no sockets
pnpm --filter sparcd-shard-proxy test:integration  # starts MinIO on loopback
```

The integration run brings up MinIO from Quay on a Docker-chosen loopback port,
seeds a namespace plus a bucket outside it holding a canary object, starts the
proxy on an ephemeral port, and drives it with `@aws-sdk/client-s3` holding
proxy-issued keys.
