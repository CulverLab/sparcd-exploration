// What an S3 request is, and whether this person may make it.
//
// Two steps, both fail-closed. `classify` turns method + path + query into one
// named operation, and returns null for anything it does not recognise —
// including a request carrying a query parameter not on the known list, since
// an unrecognised parameter is an unrecognised operation (`?acl`, `?policy`,
// `?versioning` all land there). `decide` then matches the operation and key
// against the contract's table. No match is a deny.

/** Canonical order. A membership's `access` is a non-empty subset of these. */
export const PERMISSIONS = ['look', 'identify', 'upload', 'run'];

// Before schema 2 a membership held one level, and each level included the
// ones below it.
const LEGACY_LEVEL = {
  look: ['look'],
  identify: ['look', 'identify'],
  upload: ['look', 'identify', 'upload'],
  run: ['look', 'identify', 'upload', 'run'],
};

/**
 * The canonical set: known names only, no duplicates, in PERMISSIONS order,
 * with `look` added wherever `identify` or `run` is present. A legacy string
 * level expands to the set it used to include.
 */
export function normalizeAccess(value) {
  const given = typeof value === 'string' ? (LEGACY_LEVEL[value] ?? []) : value;
  if (!Array.isArray(given)) return [];
  const has = new Set(given);
  if (has.has('identify') || has.has('run')) has.add('look');
  return PERMISSIONS.filter((p) => has.has(p));
}

// Query keys that belong to an operation we serve. Anything else makes the
// request unclassifiable, which is a deny.
const KNOWN_QUERY = new Set([
  'list-type', 'prefix', 'delimiter', 'max-keys', 'continuation-token',
  'start-after', 'encoding-type', 'fetch-owner', 'marker',
  'uploads', 'uploadId', 'partNumber',
  'max-parts', 'part-number-marker', 'key-marker', 'upload-id-marker',
  'max-uploads',
  'location',
  'x-id',
  'response-content-type', 'response-content-disposition',
  'response-cache-control', 'response-content-encoding',
  'response-content-language', 'response-expires',
  'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires',
  'X-Amz-SignedHeaders', 'X-Amz-Signature', 'X-Amz-Security-Token',
  // The AWS SDK presigner hoists its `UNSIGNED-PAYLOAD` declaration into the
  // query, so every presigned URL from the browser apps carries it.
  'X-Amz-Content-Sha256',
]);

/**
 * @returns one of the operation names below, or null when the request does not
 * name an operation this proxy serves.
 */
export function classify({ method, bucket, key, query, headers }) {
  for (const name of query.keys()) {
    if (!KNOWN_QUERY.has(name)) return null;
  }
  const has = (name) => query.has(name);

  if (!bucket) return method === 'GET' ? 'ListBuckets' : null;

  if (!key) {
    if (method === 'HEAD') return 'HeadBucket';
    if (method === 'GET' && has('location')) return 'GetBucketLocation';
    if (method === 'GET' && has('uploads')) return 'ListMultipartUploads';
    if (method === 'GET') return 'ListObjectsV2';
    return null;
  }

  // CopyObject wears PutObject's clothes; the source header is the only tell,
  // and it is a cross-bucket read the namespace guard would never see.
  if (headers?.get?.('x-amz-copy-source')) return null;

  if (method === 'GET') return has('uploadId') ? 'ListParts' : 'GetObject';
  if (method === 'HEAD') return 'HeadObject';
  if (method === 'PUT') return has('uploadId') && has('partNumber') ? 'UploadPart' : 'PutObject';
  if (method === 'POST') {
    if (has('uploads')) return 'CreateMultipartUpload';
    if (has('uploadId')) return 'CompleteMultipartUpload';
    return null;
  }
  if (method === 'DELETE') return has('uploadId') ? 'AbortMultipartUpload' : 'DeleteObject';
  return null;
}

const READ_OPS = new Set(['GetObject', 'HeadObject']);
const LIST_OPS = new Set(['ListObjectsV2', 'HeadBucket', 'GetBucketLocation']);
const MULTIPART_OPS = new Set([
  'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload',
  'AbortMultipartUpload', 'ListParts', 'ListMultipartUploads',
]);

export const ACCESS_PREFIX = 'Settings/access/';
export const ACTIVITY_PREFIX = 'Settings/activity/';

const isMembersKey = (key) => /^Collections\/[^/]+\/members\.json$/.test(key);

// Invariant 4: the proxy is the only writer of access data, and the only
// reader of the wrapped secrets under Settings/access/.
export function protectedKey(key, { isSettings }) {
  if (isSettings && key.startsWith(ACCESS_PREFIX)) return 'read-write';
  if (isSettings && key.startsWith(ACTIVITY_PREFIX)) return 'admin-read';
  if (!isSettings && isMembersKey(key)) return 'write';
  return null;
}

// One key segment, never `.` or `..`. The server refuses those before any rule
// runs; the rule refuses them too so it does not lean on that alone.
const SEG = '(?!\\.\\.?/)[^/]+';
const SNAP = `${SEG}/${SEG}`;
const csvOrMeta = '(media\\.csv|observations\\.csv|deployments\\.csv|UploadMeta\\.json)';

/**
 * The keys the Tagger writes, and only those. Sources (paths relative to the
 * repo root):
 *   apps/sparcd-tagger/src/lib/sync.ts — the canonical four, replaceIfUnchanged;
 *     `deployments.csv` since the Tagger corrects an upload's location
 *   apps/sparcd-tagger/src/lib/sync.ts — snapshotPrefixOf, writeImmutable
 *   apps/sparcd-tagger/src/lib/s3.ts — ensureOriginalBaseline, the upload as it
 *     arrived, written once before the first edit
 * The `<user>` snapshot segment is the one percent-encoded segment either app
 * produces, so it is matched as an opaque segment.
 */
export function taggerWriteKey(key, uuid) {
  const u = escapeRe(uuid);
  return new RegExp(
    `^Collections/${u}/Uploads/${SEG}/(`
    + `${csvOrMeta}`
    + `|\\.sparcd-tagger-snapshots/${SNAP}/(${csvOrMeta}|manifest\\.json)`
    + `|\\.sparcd-tagger-original/(${csvOrMeta}|manifest\\.json)`
    + `)$`,
  ).test(key);
}

/**
 * Everything under a collection's Uploads/. The Uploader's blob keys carry the
 * relative path, so embedded slashes are normal
 * (apps/sparcd-uploader/src/lib/bundle.ts:179).
 */
export function uploadsKey(key, uuid) {
  return key.startsWith(`Collections/${uuid}/Uploads/`)
    && key.length > `Collections/${uuid}/Uploads/`.length;
}

/** The three collection-level documents `run` may replace. */
export function runDocumentKey(key, uuid) {
  return new RegExp(`^Collections/${escapeRe(uuid)}/(collection|species|locations)\\.json$`)
    .test(key);
}

// The files the Uploader writes at the top of an upload folder, and reads back
// when a resumed run finds one already there (apps/sparcd-uploader/src/lib/upload.ts,
// writeMetadata).
const UPLOAD_METADATA = '(deployments\\.csv|media\\.csv|observations\\.csv|UploadMeta\\.json|UploadComplete\\.json)';

/**
 * The reads `upload` carries without `look`: what the Uploader needs to offer
 * the collection, pick a location and finish or resume a run, and nothing that
 * enumerates the collection's uploads or opens a media file.
 *   GetObject/HeadObject collection.json — the collection picker
 *     (packages/s3-safe/src/index.ts, listCollections)
 *   GetObject/HeadObject locations.json — the location list
 *     (apps/sparcd-uploader/src/lib/s3.ts, fetchLocations)
 *   HeadObject under Uploads/ — size and sha256 check of a blob on resume and
 *     in the final review (apps/sparcd-uploader/src/lib/upload.ts)
 *   GetObject of the five metadata files directly in one upload folder — the
 *     byte comparison after a 412 on resume
 *   ListObjectsV2 with a prefix inside one upload folder — the final review
 */
export function uploaderReadAllowed({ op, key, prefix, uuid }) {
  const u = escapeRe(uuid);
  if (op === 'HeadObject' || op === 'GetObject') {
    if (new RegExp(`^Collections/${u}/(collection|locations)\\.json$`).test(key)) return true;
    if (op === 'HeadObject') return uploadsKey(key, uuid) && safeSegments(key);
    return new RegExp(`^Collections/${u}/Uploads/${SEG}/${UPLOAD_METADATA}$`).test(key);
  }
  if (op === 'ListObjectsV2') {
    return new RegExp(`^Collections/${u}/Uploads/${SEG}/`).test(prefix ?? '');
  }
  return false;
}

const safeSegments = (key) => key.split('/').every((s) => s !== '.' && s !== '..');

const METADATA_LEAVES = new Set([
  'deployments.csv', 'media.csv', 'observations.csv',
  'UploadMeta.json', 'UploadComplete.json', 'manifest.json',
]);

/** A GetObject worth an activity line: a media object, not its metadata. */
export function isMediaKey(key) {
  if (!key.includes('/Uploads/')) return false;
  return !METADATA_LEAVES.has(key.slice(key.lastIndexOf('/') + 1));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param person   { admin, status }
 * @param context  { op, key, prefix, bucket, isSettings, uuid, access }
 *                 `access` is the person's permission set on this collection,
 *                 empty or null without a membership. `prefix` is a listing's.
 * @returns { allow: boolean, reason?: string }
 */
export function decide(person, { op, key, prefix, isSettings, uuid, access }) {
  if (!op) return deny('unknown operation');
  if (person.status !== 'active') return deny(`person is ${person.status}`);

  // Filtered per caller in the response; who may ask is not the boundary here.
  if (op === 'ListBuckets') return { allow: true };

  const guard = key ? protectedKey(key, { isSettings }) : null;
  const writing = !READ_OPS.has(op) && !LIST_OPS.has(op);
  if (guard === 'read-write') return deny('access data is proxy-owned');
  if (guard === 'write' && writing) return deny('membership data is proxy-owned');
  if (guard === 'admin-read') {
    if (writing) return deny('activity data is proxy-owned');
    if (!person.admin) return deny('activity data is admin-only');
    return { allow: true };
  }

  if (isSettings) {
    if (person.admin) return { allow: true };
    if (LIST_OPS.has(op)) return { allow: true };
    if (READ_OPS.has(op) && key.startsWith('Settings/')) return { allow: true };
    return deny('settings bucket is read-only under Settings/');
  }

  if (person.admin) return { allow: true };
  const has = new Set(access ?? []);
  if (has.size === 0) return deny('no membership on this collection');
  const held = [...has].join(',');

  if (LIST_OPS.has(op) || READ_OPS.has(op)) {
    if (has.has('look')) return { allow: true };
    if (has.has('upload') && uploaderReadAllowed({ op, key, prefix, uuid })) return { allow: true };
    return deny(`${held} may not read ${key || prefix || 'this collection'}`);
  }

  if (op === 'PutObject') {
    if (has.has('run') && runDocumentKey(key, uuid)) return { allow: true };
    if (has.has('upload') && uploadsKey(key, uuid)) return { allow: true };
    if (has.has('identify') && taggerWriteKey(key, uuid)) return { allow: true };
    return deny(`${held} may not write ${key}`);
  }

  if (MULTIPART_OPS.has(op)) {
    if (op === 'ListMultipartUploads') return deny('bucket-wide multipart listing is not served');
    if (has.has('upload') && uploadsKey(key, uuid)) return { allow: true };
    return deny(`${held} may not upload to ${key}`);
  }

  if (op === 'DeleteObject') {
    if (has.has('run') && uploadsKey(key, uuid)) return { allow: true };
    return deny(`${held} may not delete ${key}`);
  }

  return deny('unknown operation');
}

function deny(reason) {
  return { allow: false, reason };
}

/** The activity `kind` a successful request earns, or null for "not logged". */
export function eventKind(op, { isSettings, key }) {
  if (op === 'GetObject') return isMediaKey(key ?? '') ? 'download' : null;
  if (op === 'PutObject' || op === 'CompleteMultipartUpload') {
    if (isSettings) return 'list-change';
    if (taggerMetadataLeaf(key)) return 'identify';
    return 'upload';
  }
  if (op === 'DeleteObject') return 'collection-change';
  return null;
}

// The Tagger's canonical files and its snapshots are identification work; a
// media blob at the same prefix is an upload.
function taggerMetadataLeaf(key) {
  if (!key) return false;
  const leaf = key.slice(key.lastIndexOf('/') + 1);
  return (leaf === 'media.csv' || leaf === 'observations.csv' || leaf === 'deployments.csv'
    || leaf === 'UploadMeta.json')
    || key.includes('/.sparcd-tagger-snapshots/')
    || key.includes('/.sparcd-tagger-original/');
}

/** The trees a listing may not enumerate, and who is entitled to each. */
const PROTECTED_TREES = [
  { prefix: ACCESS_PREFIX, entitled: () => false },
  { prefix: ACTIVITY_PREFIX, entitled: (person) => !!person.admin },
];

// Where the protected trees hang. A prefix at or above this can straddle, and
// is filtered rather than refused; anything longer that reaches only into a
// protected tree is refused, because enumerating it is the whole request.
const SETTINGS_ROOT = 'Settings/';

/**
 * Whether a listing may run at all. A prefix that sits inside a protected
 * tree, or that can only ever reach into protected trees the caller is not
 * entitled to, is a 403 — filtering its results would answer "no such thing"
 * to a question that was only ever about that tree.
 */
export function listingGuard({ prefix = '', person, isSettings }) {
  if (!isSettings) return { allow: true };

  for (const tree of PROTECTED_TREES) {
    if (prefix.startsWith(tree.prefix) && !tree.entitled(person)) {
      return { allow: false, reason: `${tree.prefix} is not listable` };
    }
  }

  if (prefix.length > SETTINGS_ROOT.length) {
    const reaches = PROTECTED_TREES.filter((t) => t.prefix.startsWith(prefix));
    if (reaches.length > 0 && reaches.every((t) => !t.entitled(person))) {
      return { allow: false, reason: `${prefix} reaches only into a protected tree` };
    }
  }
  return { allow: true };
}

/**
 * The first string that sorts after everything under `tree`. Incrementing the
 * trailing separator gets there: every key in `Settings/access/` is less than
 * `Settings/access0`, and `Settings/access0` is still less than the next real
 * child of `Settings/`. That is what lets a listing step over a protected tree
 * in one request instead of paging through it.
 */
export function afterTree(tree) {
  const last = tree.charCodeAt(tree.length - 1);
  return tree.slice(0, -1) + String.fromCharCode(last + 1);
}

/**
 * The continuation token is the proxy's own, not the upstream's: the upstream's
 * would describe a position in a listing the caller never received, and would
 * let them count what was filtered out by how far it jumped.
 */
export function encodeListingToken(key) {
  return Buffer.from(key, 'utf8').toString('base64url');
}

export function decodeListingToken(token) {
  if (typeof token !== 'string' || token === '') return null;
  const decoded = Buffer.from(token, 'base64url');
  // base64url decoding never throws, so the round trip is the validation.
  if (decoded.toString('base64url') !== token) return null;
  return decoded.toString('utf8');
}

/**
 * A ListBucketResult built from scratch. The proxy paginates the upstream
 * itself for the settings bucket, because handing back a filtered page with
 * the upstream's continuation token would let a caller count what was removed.
 */
export function buildListing({
  bucket, prefix = '', delimiter = '', keys, commonPrefixes,
  truncated = false, nextToken = null,
}) {
  const contents = keys.map((k) =>
    `<Contents><Key>${xml(k.key)}</Key>`
    + `<LastModified>${xml(k.lastModified ?? '1970-01-01T00:00:00.000Z')}</LastModified>`
    + `<ETag>${xml(k.etag ?? '""')}</ETag>`
    + `<Size>${Number(k.size ?? 0)}</Size>`
    + '<StorageClass>STANDARD</StorageClass></Contents>').join('');
  const prefixes = commonPrefixes
    .map((p) => `<CommonPrefixes><Prefix>${xml(p)}</Prefix></CommonPrefixes>`).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
    + `<Name>${xml(bucket)}</Name><Prefix>${xml(prefix)}</Prefix>`
    + `<Delimiter>${xml(delimiter)}</Delimiter>`
    + `<KeyCount>${keys.length}</KeyCount><MaxKeys>${keys.length}</MaxKeys>`
    + `<IsTruncated>${truncated ? 'true' : 'false'}</IsTruncated>`
    + (truncated && nextToken
      ? `<NextContinuationToken>${xml(encodeListingToken(nextToken))}</NextContinuationToken>`
      : '')
    + contents + prefixes
    + '</ListBucketResult>';
}

const xml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
