// SigV4 verification, shared by the Cloudflare Worker recipe and the access
// proxy. Both hold an S3 credential and both have to authenticate the caller
// before they will use it, so the rules live in one place.
//
// Runs on WebCrypto only (crypto.subtle, TextEncoder), which both Workers and
// Node 20+ provide globally. The one Worker-only primitive the original used,
// crypto.subtle.timingSafeEqual, is replaced by the portable compare below.

const encoder = new TextEncoder();

export const toHex = (bytes) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmac(key, data) {
  const imported = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(data)));
}

export async function sha256hex(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

// Header names and the fixed reasons below are HTTP tokens, so this never has
// anything to do — it is here because the output is markup and the input came
// off the wire.
export const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// encodeURIComponent leaves !'()* alone; SigV4 wants them percent-encoded.
export const encodeRfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// S3's own tolerance. A signature stays replayable inside the window; that is
// the same posture S3 itself takes, and the reason to keep the window tight.
export const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

// A presigned URL is a bearer token for as long as it says it is, and it is
// handed around in places that log URLs. An hour is the longest we mint or
// accept.
export const MAX_PRESIGN_EXPIRY_S = 3600;

// The `x-amz-*` exceptions: what the caller signed for its own signature, or
// what describes a body the proxy is about to re-frame.
export const DROP_FROM_CLIENT = new Set([
  'authorization',
  'x-amz-content-sha256',
  'x-amz-date',
  'x-amz-security-token',
  'x-amz-decoded-content-length',
  'content-length',
  'host',
]);

// Comparing hex strings with === leaks the signature a character at a time.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseAuthorization(header) {
  const match = /^AWS4-HMAC-SHA256\s+(.*)$/.exec(header ?? '');
  if (!match) return null;
  const fields = {};
  for (const part of match[1].split(',')) {
    const [key, ...rest] = part.trim().split('=');
    fields[key] = rest.join('=');
  }
  if (!fields.Credential || !fields.SignedHeaders || !fields.Signature) return null;
  return {
    credential: fields.Credential.split('/'),
    signedHeaders: fields.SignedHeaders.split(';'),
    signature: fields.Signature,
  };
}

/**
 * The canonical query string, optionally without one parameter (presigned
 * requests exclude X-Amz-Signature from what they sign).
 */
export function canonicalQueryString(url, omit) {
  return [...url.searchParams]
    .filter(([key]) => key !== omit)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    // Sort by encoded key, then by encoded value. The value tiebreak is not
    // decorative: `?partNumber=2&partNumber=1` is a legitimate shape, and both
    // the browser SDK (@smithy/signature-v4 sorts the serialized pairs) and
    // aws4fetch sort values, so a verifier that stops at the key disagrees with
    // every real client. Note that some upstreams — MinIO among them —
    // canonicalize duplicate values in wire order instead, and will reject such
    // a request no matter what fronts them.
    .sort(([ka, va], [kb, vb]) =>
      ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function parseAmzDate(value) {
  const parts = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value ?? '');
  if (!parts) return null;
  return Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], +parts[6]);
}

// A header the caller did not sign is a header an attacker can add to a
// captured request. Both callers forward every `x-amz-*` upstream and sign it
// there, so an unsigned one would be laundered into an authentic-looking
// upstream request — `x-amz-acl: public-read` bolted onto someone else's PUT.
// S3 enforces the same rule for the same reason.
function unsignedAmzHeader(headers, signed) {
  for (const [name] of headers) {
    if (DROP_FROM_CLIENT.has(name)) continue;
    if (name.startsWith('x-amz-') && !signed.has(name)) return name;
  }
  return null;
}

async function signatureFor({ secretAccessKey, scopeParts, amzDate, canonicalRequest }) {
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scopeParts.join('/'),
    await sha256hex(canonicalRequest),
  ].join('\n');
  let key = encoder.encode(`AWS4${secretAccessKey}`);
  for (const part of scopeParts) key = await hmac(key, part);
  return toHex(await hmac(key, stringToSign));
}

/**
 * Recompute the caller's SigV4 signature and compare it.
 *
 * Returns `{ accessKeyId, presigned }` when the request is authentic, or
 * `{ error }` with a short reason otherwise.
 *
 * `url` must be the request exactly as it arrived: the signature covers the
 * path and query the client sent, so verification has to happen before any
 * host rewrite and before the `x-id` strip. `host` is read from the URL, not
 * from the header, so a header cannot spoof it.
 *
 * `lookupSecret(accessKeyId)` returns the secret or null/undefined. It may be
 * async. `allowPresigned` opts into the query-string form.
 */
export async function verifySignature({
  method, url, headers, body, lookupSecret,
  allowPresigned = false, now = Date.now(),
}) {
  const presigned = allowPresigned && url.searchParams.has('X-Amz-Algorithm');

  let credential;
  let signedHeaders;
  let signature;
  let amzDate;
  let payloadHash;
  let omitFromQuery;

  if (presigned) {
    if (url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256') {
      return { error: 'unsupported presign algorithm' };
    }
    credential = (url.searchParams.get('X-Amz-Credential') ?? '').split('/');
    signedHeaders = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';').filter(Boolean);
    signature = url.searchParams.get('X-Amz-Signature') ?? '';
    amzDate = url.searchParams.get('X-Amz-Date');
    // A presigned URL carries no body hash; S3 treats it as unsigned payload.
    payloadHash = 'UNSIGNED-PAYLOAD';
    omitFromQuery = 'X-Amz-Signature';
    if (!signature || credential.length !== 5 || signedHeaders.length === 0) {
      return { error: 'incomplete presigned query' };
    }
    const expires = Number(url.searchParams.get('X-Amz-Expires'));
    if (!Number.isInteger(expires) || expires <= 0) return { error: 'missing X-Amz-Expires' };
    if (expires > MAX_PRESIGN_EXPIRY_S) return { error: 'X-Amz-Expires exceeds one hour' };
    const signedAt = parseAmzDate(amzDate);
    if (signedAt === null) return { error: 'missing or malformed X-Amz-Date' };
    if (now > signedAt + expires * 1000) return { error: 'presigned URL has expired' };
    if (signedAt - now > MAX_CLOCK_SKEW_MS) return { error: 'presigned URL is not yet valid' };
  } else {
    const auth = parseAuthorization(headers.get('authorization'));
    if (!auth) return { error: 'missing or unparseable Authorization header' };
    ({ credential, signedHeaders, signature } = auth);
    amzDate = headers.get('x-amz-date');
    payloadHash = headers.get('x-amz-content-sha256');
    if (!payloadHash) return { error: 'missing x-amz-content-sha256' };
  }

  const [accessKeyId, date, region, service, terminator] = credential;
  if (service !== 's3' || terminator !== 'aws4_request') {
    return { error: 'unexpected credential scope' };
  }

  const signed = new Set(signedHeaders);
  // `host` and `x-amz-date` are required because the whole scheme rests on
  // them: the first binds the signature to this host, the second to the time
  // window.
  const required = presigned ? ['host'] : ['host', 'x-amz-date', 'x-amz-content-sha256'];
  for (const name of required) {
    if (!signed.has(name)) return { error: `${name} is not in SignedHeaders` };
  }
  const rogue = unsignedAmzHeader(headers, signed);
  if (rogue) return { error: `unsigned x-amz header: ${rogue}` };

  if (!presigned) {
    // A signature with no expiry is a bearer token forever. The window bounds
    // how long a captured request stays replayable.
    const signedAt = parseAmzDate(amzDate);
    if (signedAt === null) return { error: 'missing or malformed x-amz-date' };
    if (Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) return { error: 'x-amz-date outside the window' };
    if (amzDate.slice(0, 8) !== date) return { error: 'x-amz-date does not match the credential scope' };

    // The signature covers the *declared* payload hash, not the bytes. Checking
    // the declaration against the body is what stops a captured PUT from being
    // replayed inside the window with different contents.
    if (payloadHash === 'UNSIGNED-PAYLOAD') {
      // Accepted, because the uploader's blob path produces it: the browser AWS
      // SDK hashes string and ArrayBuffer bodies but declares UNSIGNED-PAYLOAD
      // for a Blob, and image uploads stream Blob slices so memory stays flat.
      // The consequence is real and worth stating: for those requests the body
      // is not bound to the signature, so a captured PUT can be replayed with
      // different contents until x-amz-date ages out. The README says how to
      // close it client-side.
    } else if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
      // `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` and friends carry their own chunk
      // framing and per-chunk signatures. Verifying those means implementing
      // the chunked protocol; rejecting is the honest answer.
      return { error: `unsupported x-amz-content-sha256: ${payloadHash}` };
    } else if (await sha256hex(body ?? new ArrayBuffer(0)) !== payloadHash) {
      return { error: 'body does not match x-amz-content-sha256' };
    }
  }

  const secretAccessKey = await lookupSecret(accessKeyId);
  if (!secretAccessKey) return { error: 'unknown access key' };

  const canonicalHeaders = signedHeaders
    .map((name) => {
      const value = name === 'host' ? url.host : (headers.get(name) ?? '');
      return `${name}:${value.trim().replace(/\s+/g, ' ')}\n`;
    })
    .join('');

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQueryString(url, omitFromQuery),
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const expected = await signatureFor({
    secretAccessKey,
    scopeParts: [date, region, service, terminator],
    amzDate,
    canonicalRequest,
  });
  if (!constantTimeEqual(expected, signature)) return { error: 'signature mismatch' };
  return { accessKeyId, presigned };
}
