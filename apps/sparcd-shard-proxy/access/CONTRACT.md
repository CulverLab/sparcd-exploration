# Access proxy contract

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
   are verified the same way with `X-Amz-Expires` capped at 1 hour.

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
CopyObject, bucket create/delete, ACL, policy, versioning and tagging calls are 403.

## JSON API

Same origin as S3, under `/-/`. Requests are SigV4-signed with the caller's own key
(service `s3`, body hashed), except `/-/join` and `/-/health`. JSON in and out.
Errors: `{ error: { code, message } }` with 400, 403, 404, 409, 412.

- `GET /-/health` → `{ ok: true }`
- `POST /-/join` `{ token }` → `{ endpoint, accessKey, secretKey, name }` once. Marks the
  person active and burns the token. 404 for unknown, used or expired tokens.
- `GET /-/whoami` → `{ id, name, email, admin, collections: [{ bucket, uuid, name, access, exactLocations }] }`

Admin only:
- `GET /-/admin/people` → `{ people: [{ id, name, email, status, admin, lastActiveAt, collections: [{ bucket, name, access, exactLocations }] }] }`
- `POST /-/admin/people` `{ name, email, admin?, memberships?: [{ bucket, access, exactLocations? }] }`
  → `{ person, invite: { token, expiresAt } }` (token valid 7 days, single use; the app builds the link)
- `PATCH /-/admin/people/:id` `{ name?, email?, admin?, status?: "active"|"paused" }` → `{ person }`.
  The last active admin cannot be paused or demoted (409).
- `POST /-/admin/people/:id/reset` → retires every key, status back to `invited`, → `{ invite }`
- `GET /-/admin/collections` → `{ collections: [{ bucket, uuid, name, organization, members: [...with person names] }] }`
- `PUT /-/admin/collections/:bucket/members` `{ members: [{ personId, access, exactLocations }] }`
  → `{ members }`. People with `run` on that collection may call it too. At least one
  member with `run` is required (409 otherwise).
- `GET /-/admin/activity?from=&to=&person=&bucket=&kind=&limit=` → `{ events: [...], truncated }`
- `GET /-/admin/activity/downloads?bucket=&key=` → `{ events: [...] }`

Access changes take effect on the proxy that made them at once, and on any other proxy
within 5 s (each polls `generation.json`).

## Activity events

One JSON object per line:
`{ ts, requestId, personId, personName, kind, bucket, key?, status, bytes?, ip?, detail? }`
`kind`: `download` (GetObject 2xx on a media file), `upload`, `identify`, `list-change`
(Settings/ writes), `collection-change`, `access-change` (API writes, `detail` holds
before/after), `denied` (rule 403), `bad-signature`, `sign-in` (first request per key per
day). Listing and metadata reads are not logged.

## Configuration (environment)

`UPSTREAM`, `S3_REGION` (default `us-east-1`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`BUCKET_NAMESPACE`, `BUCKET_ALLOW`, `ACCESS_MASTER_KEY`, `PORT` (default 8787),
`PUBLIC_ENDPOINT` (what `/-/join` returns), `ALLOW_ORIGINS` (CORS, default `*`),
`MAX_BODY_BYTES` (default 67108864).

First admin: `node access/cli.mjs init --name "..." --email ...` writes the person and
prints the key once. It refuses when any admin already exists.
