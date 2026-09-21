// What an S3 request is, and whether this person may make it.
//
// Two steps, both fail-closed. `classify` turns method + path + query into one
// named operation, and returns null for anything it does not recognise —
// including a request carrying a query parameter not on the known list, since
// an unrecognised parameter is an unrecognised operation (`?acl`, `?policy`,
// `?versioning` all land there). `decide` then matches the operation and key
// against the contract's table. No match is a deny.

export const LEVELS = { look: 1, identify: 2, upload: 3, run: 4 };

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

const SNAP = '[^/]+/[^/]+';
const csvOrMeta = '(media\\.csv|observations\\.csv|UploadMeta\\.json)';

/**
 * The keys the Tagger writes, and only those. Sources (paths relative to the
 * repo root):
 *   apps/sparcd-tagger/src/lib/sync.ts:251 — the canonical trio, replaceIfUnchanged
 *   apps/sparcd-tagger/src/lib/sync.ts:187 — snapshotPrefixOf, writeImmutable
 * The `<user>` snapshot segment is the one percent-encoded segment either app
 * produces (sync.ts:188), so it is matched as an opaque segment.
 */
export function taggerWriteKey(key, uuid) {
  const u = escapeRe(uuid);
  return new RegExp(
    `^Collections/${u}/Uploads/[^/]+/(`
    + `${csvOrMeta}`
    + `|\\.sparcd-tagger-snapshots/${SNAP}/(${csvOrMeta}|manifest\\.json)`
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
 * @param context  { op, key, bucket, isSettings, uuid, level }
 *                 `level` is the person's access on this collection, or null.
 * @returns { allow: boolean, reason?: string }
 */
export function decide(person, { op, key, isSettings, uuid, level }) {
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
  if (!level) return deny('no membership on this collection');
  const rank = LEVELS[level];
  if (!rank) return deny('unknown access level');

  if (LIST_OPS.has(op) || READ_OPS.has(op)) return { allow: true };

  if (op === 'PutObject') {
    if (rank >= LEVELS.run && runDocumentKey(key, uuid)) return { allow: true };
    if (rank >= LEVELS.upload && uploadsKey(key, uuid)) return { allow: true };
    if (rank >= LEVELS.identify && taggerWriteKey(key, uuid)) return { allow: true };
    return deny(`${level} may not write ${key}`);
  }

  if (MULTIPART_OPS.has(op)) {
    if (op === 'ListMultipartUploads') return deny('bucket-wide multipart listing is not served');
    if (rank >= LEVELS.upload && uploadsKey(key, uuid)) return { allow: true };
    return deny(`${level} may not upload to ${key}`);
  }

  if (op === 'DeleteObject') {
    if (rank >= LEVELS.run && uploadsKey(key, uuid)) return { allow: true };
    return deny(`${level} may not delete ${key}`);
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

// The Tagger's canonical trio and its snapshots are identification work; a
// media blob at the same prefix is an upload.
function taggerMetadataLeaf(key) {
  if (!key) return false;
  const leaf = key.slice(key.lastIndexOf('/') + 1);
  return (leaf === 'media.csv' || leaf === 'observations.csv' || leaf === 'UploadMeta.json')
    || key.includes('/.sparcd-tagger-snapshots/');
}

/**
 * Drop listing entries the caller may not read. Listing leaks names only, so
 * filtering the names is the proportionate answer to a prefix that straddles a
 * protected tree.
 */
export function filterListing(xml, person, { isSettings }) {
  if (!isSettings) return xml;
  const hidden = (k) =>
    k.startsWith(ACCESS_PREFIX) || (!person.admin && k.startsWith(ACTIVITY_PREFIX));
  return xml
    .replace(/<Contents>[\s\S]*?<\/Contents>/g, (block) => {
      const m = /<Key>([\s\S]*?)<\/Key>/.exec(block);
      return m && hidden(m[1]) ? '' : block;
    })
    .replace(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g, (block) => {
      const m = /<Prefix>([\s\S]*?)<\/Prefix>/.exec(block);
      return m && hidden(m[1]) ? '' : block;
    });
}
