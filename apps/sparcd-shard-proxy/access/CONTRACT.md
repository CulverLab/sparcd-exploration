# Access proxy contract — version 1.1

Per-person access for SPARC'd on storage that offers one S3 identity per project
(Jetstream2 Ceph RGW). The proxy verifies each request's SigV4 signature against a
key it issued to that person, checks what the person may do, then re-signs with the
one upstream credential. Apps keep their login: endpoint, access key, secret.

This file is the wire contract. The admin app's People and Activity screens and the
proxy are built against it independently.

## Safety invariants (enforced in code, covered by tests)

1. **Namespace.** `BUCKET_NAMESPACE` (may be empty) plus `BUCKET_ALLOW` (globs, default
   `sparcd,sparcd-*`) define every upstream bucket the proxy can touch. A client bucket
   `B` maps to upstream `${BUCKET_NAMESPACE}${B}` and must match `BUCKET_ALLOW` first.
   ListBuckets returns only upstream names carrying the namespace, with it stripped.
   Nothing outside this set is ever read, written, listed or named in a response.
2. **One upstream.** `UPSTREAM` is fixed at start. Redirects are not followed. The
   upstream credential never leaves the process and is never logged.
3. **Fail closed.** Unknown key, paused person, unreadable access data, unknown S3
   operation, or any rule doubt is a 403 in S3 XML shape. No request reaches the
   upstream before signature and rule checks pass.
4. **Access data is written only by the proxy.** Direct S3 writes to
   `Settings/access/**`, `Settings/activity/**` and `Collections/*/members.json` are
   403 for everyone, admins included. Direct reads of `Settings/access/**` are 403
   for everyone (it holds wrapped secrets); admins read people through the API.
5. Signature rules are those of `deploy/cloudflare-worker/worker.js`: required signed
   headers, every `x-amz-*` signed, 15 minute window, payload hash checked unless
   `UNSIGNED-PAYLOAD`, streaming payloads rejected. Presigned query-string requests
   are verified the same way, for **GET and HEAD only**, with `X-Amz-Expires` capped
   at 1 hour, and never at the service root.
6. **Nothing is forwarded that was not asked for.** Only the `x-amz-*` headers on the
   allowlist below reach the upstream; any other `x-amz-*` header on the request is a
   403, so a client that grew a new one fails loudly instead of being silently
   stripped. A header from the ordinary forward list travels only if it is in
   `SignedHeaders`. Responses that name a bucket are **rebuilt**, not filtered.

## Layout in storage

Buckets follow today's layout: a settings bucket (`sparcd-settings-*`, or legacy
`sparcd`) and one bucket per collection `sparcd-<uuid>` holding `Collections/<uuid>/...`.

Settings bucket:
- `Settings/access/people/<personId>.json`
  `{ schemaVersion: 1, id, name, email, status: "invited"|"active"|"paused", admin: boolean,
     keys: [{ accessKeyId, wrappedSecret, createdAt, retiredAt? }],
     invite?: { tokenHash, expiresAt }, createdBy, createdAt, updatedAt }`
  `wrappedSecret` is AES-256-GCM under `ACCESS_MASTER_KEY` (base64, 32 bytes):
  `v1.<iv b64url>.<ciphertext+tag b64url>`. Access key ids are `SPK` + 17 base32 chars.
- `Settings/access/generation.json` `{ generation: <int> }`, bumped on every access change.
- `Settings/activity/<YYYY-MM-DD>/<epochMs>-<8 hex>.ndjson`, immutable, one object per
  flush (every 5 s or 200 lines, and on shutdown).

Collection bucket:
- `Collections/<uuid>/members.json`
  `{ schemaVersion: 1, members: [{ personId, access: "look"|"identify"|"upload"|"run",
     exactLocations: boolean, grantedBy, grantedAt }] }`

## What each access level allows (S3 requests on the collection bucket)

| level | allows |
| --- | --- |
| look | GetObject, HeadObject, ListObjectsV2, HeadBucket, GetBucketLocation |
| identify | look, plus PutObject on the files the Tagger writes (see `rules.js`) |
| upload | identify, plus PutObject and multipart create/part/complete/abort/list-parts under `Collections/<uuid>/Uploads/` |
| run | upload, plus DeleteObject under `Collections/<uuid>/Uploads/`, PutObject on `Collections/<uuid>/collection.json`, `species.json`, `locations.json` |

Every active person: GetObject/HeadObject/ListObjectsV2 on the settings bucket under
`Settings/`, minus `Settings/access/` and `Settings/activity/`. Admins: everything in
the namespace except invariant 4, plus reading `Settings/activity/**`.
A person sees a collection bucket in ListBuckets only with a membership; everyone
active sees the settings bucket. Paused or invited people get 403 on everything.
`exactLocations` is stored and returned but not yet enforced (team decision pending).
CopyObject, ListMultipartUploads, bucket create/delete, ACL, policy, versioning and
tagging calls are 403.

### Forwarded request headers

`x-amz-*` on the request is an allowlist, and anything outside it is a 403:

| header | why |
| --- | --- |
| `x-amz-meta-*` | user metadata the Uploader writes (`x-amz-meta-sha256`) |
| `x-amz-checksum-*` | flexible checksums, including `x-amz-checksum-mode` on reads |
| `x-amz-sdk-checksum-algorithm` | names the algorithm for the header above |

`x-amz-content-sha256`, `x-amz-date`, `x-amz-security-token`,
`x-amz-decoded-content-length` and `x-amz-user-agent` are consumed or discarded here
and never forwarded. Everything else — `x-amz-acl`, `x-amz-grant-*`, the SSE-C family,
`x-amz-tagging`, `x-amz-storage-class`, `x-amz-website-redirect-location`, the
object-lock family, `x-amz-trailer` — is refused.

Object keys are refused when a decoded segment is `.` or `..`, or the key contains a
backslash or a NUL, or starts with `/`.

## JSON API

Same origin as S3, under `/-/`. Requests are SigV4-signed with the caller's own key
(service `s3`, body hashed — `UNSIGNED-PAYLOAD` is refused here), except `/-/join` and
`/-/health`. JSON in and out. Errors are `{ error: { code, message } }`, and `code` is
one of exactly these:

| code | status | meaning |
| --- | --- | --- |
| `invalid` | 400 | the request body or query is not what this endpoint takes |
| `forbidden` | 403 | the caller may not do this |
| `not_found` | 404 | no such endpoint, person, collection or invite |
| `last_admin` | 409 | the change would leave no active admin |
| `last_runner` | 409 | the change would leave the collection with no `run` member |
| `changed_elsewhere` | 412 | the `If-Match` version is stale |
| `too_large` | 413 | the body is over `MAX_BODY_BYTES` |
| `busy` | 503 | `MAX_BUFFERED_BYTES` is already in flight |
| `upstream` | 502 | the upstream answered with something unusable |

- `GET /-/health` → `{ ok: true }`
- `POST /-/join` `{ token }` → `{ endpoint, accessKey, secretKey, name }` once. Marks the
  person active and burns the token. 404 for unknown, used or expired tokens.
- `GET /-/whoami` → `{ id, name, email, admin, collections: [{ bucket, uuid, name, access, exactLocations }] }`

Admin only:
- `GET /-/admin/people` → `{ people: [{ id, name, email, status, admin, lastActiveAt, collections: [{ bucket, uuid, name, access, exactLocations }] }] }`.
  `lastActiveAt` is an ISO 8601 instant or `null`.
- `POST /-/admin/people` `{ name, email, admin?, memberships?: [{ bucket, access, exactLocations? }] }`
  → `{ person, invite: { token, expiresAt } }` (token valid 7 days, single use; the app builds the link)
- `PATCH /-/admin/people/:id` `{ name?, email?, admin?, status?: "active"|"paused" }` → `{ person }`.
  `admin` must be a boolean and `status` one of the two words, or 400 `invalid`. The
  last active admin cannot be paused or demoted (409 `last_admin`), checked against the
  resulting object and again after the write.
- `POST /-/admin/people/:id/reset` → retires every key, status back to `invited`, → `{ invite }`
- `GET /-/admin/collections` → `{ collections: [{ bucket, uuid, name, organization, membersVersion, members: [...with person names] }] }`.
  `membersVersion` is an opaque string, or `null` when the collection has no members
  file yet.
- `PUT /-/admin/collections/:bucket/members` `{ members: [{ personId, access, exactLocations }] }`
  → `{ members, membersVersion }`. Requires `If-Match: <membersVersion>`, or
  `If-None-Match: *` when it was `null`. A stale version is 412 `changed_elsewhere`.
  People with `run` on that collection may call it too. At least one member with `run`
  is required (409 `last_runner`).
- `PUT /-/admin/collections/:bucket/members/:personId` `{ access, exactLocations? }` and
  `DELETE /-/admin/collections/:bucket/members/:personId` → `{ members, membersVersion }`.
  The server does the read-modify-write and retries up to three times on a conflict, so
  these need no `If-Match`. Same permission rule. The last-`run` rule here protects an
  existing runner rather than demanding one: an edit that would remove the collection's
  last `run` member is 409 `last_runner`, while a collection that has no members yet can
  receive its first at any level.
- `GET /-/admin/activity?from=&to=&person=&bucket=&kind=&limit=` → `{ events: [...], truncated }`
- `GET /-/admin/activity/downloads?bucket=&key=` → `{ events: [...] }`

Access changes take effect on the proxy that made them at once, and on any other proxy
within 5 s (each polls `generation.json`).

## Activity events

One JSON object per line:
`{ ts, requestId, personId, personName, kind, bucket, key?, status, bytes?, ip?, detail? }`
`kind`: `download` (GetObject 2xx on a media file), `upload`, `identify`, `list-change`
(Settings/ writes), `collection-change`, `access-change` (API writes), `denied` (rule
403), `bad-signature` (aggregated per source per minute, `detail.count` holds how many),
`sign-in` (first request per key per day), `log-gap` (the writer dropped lines under
back-pressure, `detail.dropped` holds how many). Listing and metadata reads are not
logged.

`access-change` carries:

```
detail: {
  change: "invited" | "joined" | "paused" | "resumed" | "reset"
        | "admin-granted" | "admin-removed" | "added" | "changed" | "removed",
  target: { personId, personName },
  bucket?, collectionName?,
  before?: { access, exactLocations },
  after?:  { access, exactLocations }
}
```

One event per change, so a single call that both renames a person and grants them admin
writes two.

## Configuration (environment)

`UPSTREAM`, `S3_REGION` (default `us-east-1`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`BUCKET_NAMESPACE`, `BUCKET_ALLOW`, `ACCESS_MASTER_KEY`, `PORT` (default 8787),
`ALLOW_ORIGINS` (CORS, default `*`), `MAX_BODY_BYTES` (default 67108864),
`MAX_BUFFERED_BYTES` (default 536870912 — the ceiling on request bodies held in memory
across all in-flight requests at once; past it the answer is 503 `busy`).

Required, no default, the process refuses to start without them:

- `PUBLIC_ENDPOINT` — what `/-/join` hands a new person. A wrong value here sends
  volunteers to the wrong host, so it is named rather than guessed from `UPSTREAM`.
- `ALLOWED_HOSTS` — comma-separated, including shard ports
  (`proxy.example.org, proxy.example.org:8443, ...`). SigV4 binds a signature to the
  Host the caller dialled, and this is the list of Hosts this process will answer for.
  A request whose Host is not on it is refused before anything else happens.

First admin: `node access/cli.mjs init --name "..." --email ...` writes the person and
prints the key once. It refuses when any admin already exists.
