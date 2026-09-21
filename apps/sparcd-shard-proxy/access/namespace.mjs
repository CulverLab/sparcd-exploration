// Invariant 1. BUCKET_NAMESPACE + BUCKET_ALLOW define every upstream bucket
// this process may touch. Client bucket `B` maps to `${NAMESPACE}${B}`, and `B`
// must match an allow glob first. Nothing outside that set is read, written,
// listed, or named in a response.
//
// The mapping is the whole of the containment story on a shared object store,
// so it is deliberately unforgiving: anything that is not a plain, valid,
// lowercase S3 bucket name is rejected rather than normalised. `%2F`, `../`,
// uppercase and empty all fail the same check.

// S3's own path-style naming rules, minus the IP-address case which the
// character class already keeps out of the interesting range.
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function validBucketName(name) {
  return typeof name === 'string'
    && BUCKET_NAME.test(name)
    && !name.includes('..')
    && !name.includes('.-')
    && !name.includes('-.');
}

function globToRegExp(glob) {
  const body = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

export function parseAllow(spec) {
  return String(spec ?? 'sparcd,sparcd-*')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .map(globToRegExp);
}

export function makeNamespace({ namespace = '', allow } = {}) {
  const globs = parseAllow(allow);

  /** Client bucket name → upstream bucket name, or null if out of bounds. */
  const toUpstream = (clientBucket) => {
    if (!validBucketName(clientBucket)) return null;
    if (!globs.some((re) => re.test(clientBucket))) return null;
    const upstream = `${namespace}${clientBucket}`;
    // The namespace is operator-supplied, so a prefix that produces an invalid
    // upstream name is a misconfiguration, not a request to serve.
    return validBucketName(upstream) ? upstream : null;
  };

  /** Upstream bucket name → client bucket name, or null if not ours. */
  const toClient = (upstreamBucket) => {
    if (typeof upstreamBucket !== 'string') return null;
    if (!upstreamBucket.startsWith(namespace)) return null;
    const client = upstreamBucket.slice(namespace.length);
    // Round-trip rather than trust the strip: the only names we hand back are
    // ones that map forward to exactly the bucket we read them from.
    return toUpstream(client) === upstreamBucket ? client : null;
  };

  return { namespace, toUpstream, toClient };
}

/**
 * The path-style bucket segment of a request path, decoded once and validated.
 * Returns null for the service root (ListBuckets) and for anything that is not
 * a plain bucket name — `%2F`, `..`, uppercase, empty.
 */
export function bucketFromPath(pathname) {
  const raw = pathname.split('/')[1] ?? '';
  if (!raw) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return validBucketName(decoded) ? decoded : null;
}

/** The object key of a path-style request path, decoded per segment. */
export function keyFromPath(pathname) {
  const rest = pathname.split('/').slice(2);
  if (rest.length === 0) return '';
  try {
    return rest.map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return null;
  }
}

const BUCKET_BLOCK = /<Bucket(?:\s[^>]*)?>[\s\S]*?<\/Bucket>/g;
const NAME_IN_BLOCK = /<Name(?:\s[^>]*)?>([\s\S]*?)<\/Name>/;

/**
 * The bucket names in a ListAllMyBucketsResult, or null when the body is not
 * one. Null matters: a filter that finds nothing to drop in a JSON body would
 * pass the whole thing through, so the caller turns null into a 502 instead.
 */
export function parseBucketNames(xml) {
  if (typeof xml !== 'string' || !/<ListAllMyBucketsResult[\s>]/.test(xml)) return null;
  const names = [];
  for (const block of xml.match(BUCKET_BLOCK) ?? []) {
    const match = NAME_IN_BLOCK.exec(block);
    if (!match) return null;
    names.push(decodeEntities(match[1]));
  }
  return names;
}

/**
 * A ListAllMyBucketsResult built from scratch. Nothing of the upstream's body
 * survives — not its owner, not its extra elements, not its namespaces — so
 * there is no shape of upstream response that can carry something out.
 */
export function buildListBuckets(clientNames) {
  const buckets = clientNames
    .map((name) =>
      `<Bucket><Name>${escapeXml(name)}</Name>`
      + '<CreationDate>1970-01-01T00:00:00.000Z</CreationDate></Bucket>')
    .join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
    + '<Owner><ID>sparcd</ID><DisplayName>sparcd</DisplayName></Owner>'
    + `<Buckets>${buckets}</Buckets></ListAllMyBucketsResult>`;
}

const NAMING_TAGS = /<(Name|Bucket|BucketName|Resource|HostId)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;

/**
 * True when a response still names an upstream bucket. Only the elements that
 * carry a bucket name are examined — an object key that happens to start with
 * the namespace is a key, not a leak.
 */
export function leaksNamespace(text, namespace) {
  if (!namespace) return false;
  for (const [, , value] of text.matchAll(NAMING_TAGS)) {
    if (value.startsWith(namespace) || value.startsWith(`/${namespace}`)) return true;
  }
  return false;
}

/** S3 error bodies name the upstream path and host. Neither is the caller's. */
export function scrubErrorDetail(xml) {
  return xml.replace(/<(Resource|HostId)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, '');
}

/**
 * Object keys the proxy will carry. `.` and `..` segments would let a key
 * escape the prefix a rule just authorised; a backslash reads as a separator
 * on some clients and not others; NUL and a leading slash are never meant.
 */
export function safeKeySegments(key) {
  if (typeof key !== 'string') return false;
  if (key === '') return true;
  if (key.startsWith('/')) return false;
  if (key.includes('\\') || key.includes('\u0000')) return false;
  return key.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Replace an upstream bucket name wherever a response names it. ListObjectsV2
 * echoes it in `<Name>`, multipart initiate and the error shapes in `<Bucket>`
 * and `<BucketName>`.
 */
export function rewriteBucketName(xml, upstreamBucket, clientBucket) {
  if (upstreamBucket === clientBucket) return xml;
  return xml.replace(
    /<(Name|Bucket|BucketName)>([\s\S]*?)<\/\1>/g,
    (whole, tag, value) =>
      (value === upstreamBucket ? `<${tag}>${clientBucket}</${tag}>` : whole),
  );
}
