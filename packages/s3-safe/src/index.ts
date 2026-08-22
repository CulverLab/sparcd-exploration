// The single, blessed S3 boundary. Every tool that touches storage imports
// this. It enforces guardrails the application code cannot bypass:
//
//   1. Bucket allowlists — validated at construction and on every call.
//      Reads check the read allowlist; writes check a *separate*, opt-in
//      write allowlist that is empty by default. A bucket must be explicitly
//      granted before any byte can be written to it.
//   2. Read methods only, plus two append-only writers — `writeImmutable`
//      (small atomic objects) and `writeImmutableStream` (per-file streaming) —
//      and one reviewed conditional replacement, `replaceIfUnchanged`, for the
//      canonical Camtrap metadata files the tagger must update in place.
//   3. No destructive APIs — no delete*, copy*, AbortMultipartUpload, and no
//      *unconditional* overwriting put*. The single overwrite path
//      (`replaceIfUnchanged`) is gated by `IfMatch` and treats a stale ETag as a
//      conflict, never an overwrite. Orphan multipart parts are reaped by a
//      bucket lifecycle rule, never by this wrapper (see ../README.md).
//
// `writeImmutableStream` (the uploader's P4 streaming writer) does its own
// multipart orchestration rather than going through `@aws-sdk/lib-storage`'s
// `Upload`: lib-storage applies the caller's params to CreateMultipartUpload
// but offers no hook to attach `IfNoneMatch` to the *completion* step, so the
// conditional guarantee can only be retained by orchestrating the parts here.
// See ../README.md for the spike finding and backend support notes.

import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config } from '@sparcd/types';

export type { S3Config } from '@sparcd/types';
export { detectBackendDefaults } from '@sparcd/types';

export type ObjectInfo = {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
};

export type ObjectStat = {
  size: number;
  lastModified?: Date;
  etag?: string;
  contentType?: string;
  metadata: Record<string, string>;
};

/** Thrown when a bucket outside the read allowlist is read. */
export class BucketNotAllowedError extends Error {
  constructor(bucket: string) {
    super(`Bucket "${bucket}" is not in the read allowlist`);
    this.name = 'BucketNotAllowedError';
  }
}

/**
 * Thrown when a write targets a bucket outside the *write* allowlist. The
 * write allowlist is empty by default, so this is the wrapper's hard stop
 * against accidentally writing to a production (or any non-test) bucket.
 */
export class BucketNotWritableError extends Error {
  constructor(bucket: string) {
    super(`Bucket "${bucket}" is not in the write allowlist`);
    this.name = 'BucketNotWritableError';
  }
}

/**
 * Thrown when the backend does not enforce the `IfNoneMatch: "*"`
 * precondition (501 NotImplemented, or a silent 200). The wrapper never
 * falls back to HEAD-then-PUT — that race cannot be closed safely.
 */
export class ConditionalPutUnsupportedError extends Error {
  constructor(message = 'Backend did not enforce IfNoneMatch precondition') {
    super(message);
    this.name = 'ConditionalPutUnsupportedError';
  }
}

/** Thrown by `writeImmutable` when the key already exists (412). */
export class PreconditionFailedError extends Error {
  constructor(key: string) {
    super(`Object already exists at "${key}"`);
    this.name = 'PreconditionFailedError';
  }
}

/**
 * Thrown by `replaceIfUnchanged` when the object changed since the caller
 * loaded it — the `IfMatch` ETag no longer matches (412). This is a *conflict*,
 * never an automatic overwrite: the caller must reload, re-review, and retry.
 * Distinct from `PreconditionFailedError` (which means "already exists" on an
 * `IfNoneMatch` immutable write) so callers can branch on the two conditions.
 */
export class ConditionalReplaceConflictError extends Error {
  constructor(key: string) {
    super(`Object at "${key}" changed since it was loaded (ETag mismatch)`);
    this.name = 'ConditionalReplaceConflictError';
  }
}

function endpointUrl(cfg: S3Config): string {
  if (/^https?:\/\//i.test(cfg.endpoint)) return cfg.endpoint;
  const scheme = cfg.secure === false ? 'http' : 'https';
  return `${scheme}://${cfg.endpoint}`;
}

// Allowlist entries are exact bucket names or globs where `*` matches any
// run of non-`/` characters (`s3:*`-style prefix conditions are separate).
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

// hex SHA-256 → base64, for the native `x-amz-checksum-sha256` header. The
// app already has the digest as hex (it is what we store in metadata and the
// manifest), and S3 wants the checksum header base64-encoded.
function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Map a conditional-write failure to the wrapper's typed errors. 412 means the
// key already exists (the precondition fired); 501/NotImplemented means the
// backend ignored the precondition entirely — in which case the "immutable"
// guarantee is void and the caller must know, never silently proceed.
function translateWriteError(err: unknown, key: string): Error {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (status === 412 || e.name === 'PreconditionFailed') return new PreconditionFailedError(key);
  if (status === 501 || e.name === 'NotImplemented') return new ConditionalPutUnsupportedError();
  return err as Error;
}

// `replaceIfUnchanged` shares the 501 (backend won't enforce the precondition)
// translation, but a 412 here means the reviewed ETag is stale — a conflict, not
// an "already exists". The wrapper never retries without the `IfMatch` header.
function translateReplaceError(err: unknown, key: string): Error {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (status === 412 || e.name === 'PreconditionFailed')
    return new ConditionalReplaceConflictError(key);
  if (status === 501 || e.name === 'NotImplemented') return new ConditionalPutUnsupportedError();
  return err as Error;
}

/**
 * Translate a failed read into an actionable, user-facing message. `what`
 * names the thing being read (e.g. `'UploadMeta.json'` or
 * `'"locations.json" in bucket "X"'`) and is interpolated into the message.
 *
 * The `status === undefined` branch is specific to this project's static,
 * browser-direct-to-S3 design: a CORS preflight rejection (or a network/DNS/TLS
 * failure) aborts the fetch before any HTTP response, so there is no status to
 * key on. Server-side S3 clients never hit that case. A `BucketNotAllowedError`
 * is a programming error in the caller's allowlist, so it passes through as-is.
 */
export function translateReadError(err: unknown, what: string): Error {
  if (err instanceof BucketNotAllowedError) return err;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (status === 404 || e.name === 'NoSuchKey') return new Error(`${what} not found.`);
  if (status === 403 || e.name === 'AccessDenied')
    return new Error(`Access denied reading ${what} — check the key's read permissions.`);
  if (status === undefined)
    return new Error(
      `Could not reach the endpoint to read ${what}. If the endpoint is correct, the ` +
        `bucket's CORS policy likely needs to allow GET/HEAD from this origin.`,
    );
  return new Error(`Failed to read ${what} (HTTP ${status}).`);
}

export type WriteStreamResult = { etag?: string };

export type WriteStreamOptions = {
  /** Precomputed hex SHA-256 — stored as `x-amz-meta-sha256` on the object. */
  sha256: string;
  contentType?: string;
  metadata?: Record<string, string>;
  /** Reports cumulative bytes uploaded for this object. */
  onProgress?: (loaded: number, total: number) => void;
  /** Multipart part size in bytes; bodies at or under it use a single PUT. */
  partSize?: number;
  /** Parallel parts in flight for one multipart object. */
  partConcurrency?: number;
  /**
   * Also send the native `x-amz-checksum-sha256` header. Off by default —
   * MinIO/R2 support is uneven, so it is opt-in per the backend matrix in
   * ../README.md. The portable `x-amz-meta-sha256` is always sent.
   */
  nativeChecksum?: boolean;
  signal?: AbortSignal;
};

// 8 MiB parts: comfortably above S3's 5 MiB multipart minimum, so any file
// that needs multipart splits into reasonably few parts.
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const DEFAULT_PART_CONCURRENCY = 4;

export class SafeS3Client {
  private readonly client: S3Client;
  private readonly allow: RegExp[];
  private readonly writeAllow: RegExp[];

  /**
   * @param allowlist      buckets readable by this client (non-empty).
   * @param writeAllowlist buckets writable by this client (empty by default —
   *                       writes are opt-in and refused until granted).
   */
  constructor(cfg: S3Config, allowlist: string[], writeAllowlist: string[] = []) {
    if (allowlist.length === 0) {
      throw new Error('SafeS3Client requires a non-empty read allowlist');
    }
    this.allow = allowlist.map(globToRegExp);
    this.writeAllow = writeAllowlist.map(globToRegExp);
    this.client = new S3Client({
      endpoint: endpointUrl(cfg),
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
      // AWS SDK v3 ≥ 3.729 turns on flexible checksums by default: it signs
      // `x-amz-checksum-mode` on GETs and attaches a CRC32 to PUTs. MinIO and
      // other S3-compatible backends reject the latter, so we match the MinIO
      // client and only checksum when a command explicitly requires it.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    // The SDK appends an `x-id=<Operation>` telemetry query param to every
    // request. Ceph RGW treats unknown query params as unimplemented
    // sub-resources and answers 501 NotImplemented (MinIO/AWS ignore it).
    // Strip it during build — before signing — so the canonical query the
    // client signs matches what any backend sees.
    this.client.middlewareStack.add(
      (next) => (args) => {
        const query = (args.request as { query?: Record<string, unknown> }).query;
        if (query && 'x-id' in query) delete query['x-id'];
        return next(args);
      },
      { step: 'build', name: 'stripXIdQueryParam' },
    );
  }

  private assertAllowed(bucket: string): void {
    if (!this.allow.some((re) => re.test(bucket))) {
      throw new BucketNotAllowedError(bucket);
    }
  }

  private assertWritable(bucket: string): void {
    if (!this.writeAllow.some((re) => re.test(bucket))) {
      throw new BucketNotWritableError(bucket);
    }
  }

  /** Buckets this client may write to (resolved names not knowable; returns whether any grant exists). */
  get canWrite(): boolean {
    return this.writeAllow.length > 0;
  }

  /**
   * List bucket names. This is the discovery primitive (e.g. finding the
   * settings bucket) and returns names only, so it is intentionally *not*
   * gated by the allowlist — the allowlist scopes object operations, and a
   * caller still cannot read or write a disallowed bucket's objects.
   */
  async listBuckets(): Promise<string[]> {
    const res = await this.client.send(new ListBucketsCommand({}));
    return (res.Buckets ?? []).map((b) => b.Name!).filter(Boolean);
  }

  async *listObjects(bucket: string, prefix?: string): AsyncIterable<ObjectInfo> {
    this.assertAllowed(bucket);
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const o of res.Contents ?? []) {
        yield {
          key: o.Key!,
          size: o.Size ?? 0,
          lastModified: o.LastModified,
          etag: o.ETag,
        };
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }

  /**
   * List the immediate "subfolders" under `prefix` (the `CommonPrefixes` of a
   * delimited list). Lets callers enumerate e.g. upload folders without walking
   * every object beneath them. Returned prefixes keep the trailing delimiter.
   */
  async listCommonPrefixes(bucket: string, prefix: string, delimiter = '/'): Promise<string[]> {
    this.assertAllowed(bucket);
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          Delimiter: delimiter,
          ContinuationToken: token,
        }),
      );
      for (const cp of res.CommonPrefixes ?? []) if (cp.Prefix) prefixes.push(cp.Prefix);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return prefixes;
  }

  async getObject(bucket: string, key: string): Promise<Uint8Array> {
    this.assertAllowed(bucket);
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return res.Body!.transformToByteArray();
  }

  async statObject(bucket: string, key: string): Promise<ObjectStat> {
    this.assertAllowed(bucket);
    const res = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      size: res.ContentLength ?? 0,
      lastModified: res.LastModified,
      etag: res.ETag,
      contentType: res.ContentType,
      metadata: res.Metadata ?? {},
    };
  }

  async presignedGet(bucket: string, key: string, ttlSec: number): Promise<string> {
    this.assertAllowed(bucket);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: ttlSec,
    });
  }

  /**
   * Atomic, append-only write: conditional `PutObject` with
   * `IfNoneMatch: "*"`. Throws `PreconditionFailedError` (412) if `key`
   * exists, or `ConditionalPutUnsupportedError` if the backend won't
   * enforce the precondition. No HEAD-then-PUT fallback, ever.
   */
  async writeImmutable(
    bucket: string,
    key: string,
    body: Uint8Array | string,
    opts: { contentType?: string; metadata?: Record<string, string> } = {},
  ): Promise<void> {
    this.assertWritable(bucket);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          IfNoneMatch: '*',
          ContentType: opts.contentType,
          Metadata: opts.metadata,
        }),
      );
    } catch (err) {
      throw translateWriteError(err, key);
    }
  }

  /**
   * Conditional replacement for the canonical Camtrap metadata files
   * (`media.csv`, `observations.csv`, `UploadMeta.json`). A `PutObject` carrying
   * `IfMatch: <etag>` against the ETag the caller reviewed — the only blessed
   * overwrite path in the wrapper, and a narrow compatibility exception, not a
   * general put.
   *
   * If the remote object changed since that ETag was read, the backend returns
   * 412 and this throws `ConditionalReplaceConflictError`. The wrapper never
   * falls back to an unconditional PUT — a stale ETag is always a conflict for
   * the caller to resolve. A backend that won't enforce `IfMatch` (501) throws
   * `ConditionalPutUnsupportedError`; canonical sync must stay disabled there
   * rather than silently degrade to last-writer-wins. Returns the new ETag.
   */
  async replaceIfUnchanged(
    bucket: string,
    key: string,
    body: Uint8Array | string,
    opts: { etag: string; contentType?: string; metadata?: Record<string, string> },
  ): Promise<{ etag?: string }> {
    this.assertWritable(bucket);
    try {
      const res = await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          IfMatch: opts.etag,
          ContentType: opts.contentType,
          Metadata: opts.metadata,
        }),
      );
      return { etag: res.ETag };
    } catch (err) {
      throw translateReplaceError(err, key);
    }
  }

  /**
   * Per-file streaming append-only write for image blobs. Bodies at or under
   * `partSize` go through a single conditional `PutObject`; larger bodies are
   * orchestrated as a multipart upload whose `CompleteMultipartUpload` carries
   * the same `IfNoneMatch: "*"` precondition — the conditional guarantee holds
   * on both paths. The body is a `Blob`/`File`; parts are lazy `Blob.slice`s so
   * memory stays flat regardless of file size.
   *
   * On failure the multipart upload is deliberately **not** aborted — the IAM
   * policy denies `AbortMultipartUpload` and the bucket lifecycle rule reaps
   * orphan parts. Same typed errors as `writeImmutable` (412 → already exists,
   * 501 → backend won't enforce the precondition).
   */
  async writeImmutableStream(
    bucket: string,
    key: string,
    body: Blob,
    opts: WriteStreamOptions,
  ): Promise<WriteStreamResult> {
    this.assertWritable(bucket);
    const total = body.size;
    const partSize = opts.partSize ?? DEFAULT_PART_SIZE;
    const metadata = { ...opts.metadata, sha256: opts.sha256 };
    const checksum = opts.nativeChecksum ? { ChecksumSHA256: hexToBase64(opts.sha256) } : {};

    if (total <= partSize) {
      try {
        const res = await this.client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            IfNoneMatch: '*',
            ContentType: opts.contentType,
            Metadata: metadata,
            ...checksum,
          }),
          { abortSignal: opts.signal },
        );
        opts.onProgress?.(total, total);
        return { etag: res.ETag };
      } catch (err) {
        throw translateWriteError(err, key);
      }
    }

    const create = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: opts.contentType,
        Metadata: metadata,
      }),
      { abortSignal: opts.signal },
    );
    const uploadId = create.UploadId!;
    const partCount = Math.ceil(total / partSize);
    const parts = new Array<{ PartNumber: number; ETag: string }>(partCount);
    let loaded = 0;
    let nextPart = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const i = nextPart++;
        if (i >= partCount) return;
        const start = i * partSize;
        const end = Math.min(start + partSize, total);
        const res = await this.client.send(
          new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: i + 1,
            Body: body.slice(start, end),
          }),
          { abortSignal: opts.signal },
        );
        parts[i] = { PartNumber: i + 1, ETag: res.ETag! };
        loaded += end - start;
        opts.onProgress?.(loaded, total);
      }
    };

    // A failing part rejects the whole upload; we leave the parts in place
    // (no Abort — see the method doc) for the lifecycle rule to clean up.
    const lanes = Math.min(opts.partConcurrency ?? DEFAULT_PART_CONCURRENCY, partCount);
    await Promise.all(Array.from({ length: lanes }, worker));

    try {
      const res = await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
          IfNoneMatch: '*',
        }),
        { abortSignal: opts.signal },
      );
      return { etag: res.ETag };
    } catch (err) {
      throw translateWriteError(err, key);
    }
  }
}

// --- Collections -----------------------------------------------------------
//
// A "collection" is a `sparcd-<uuid>` bucket carrying a deterministic
// `collection.json` marker. Discovery probes that exact key in every candidate
// bucket rather than listing the `Collections/` prefix, so a bucket the key
// cannot read (or that CORS blocks) is simply skipped, never fatal. Every tool
// that needs the collection list shares this so they never diverge on what a
// collection is or how it is keyed.

const COLLECTION_BUCKET_PREFIX = 'sparcd-';

export type CollectionRef = {
  key: string; // `${bucket}::${uuid}`
  bucket: string;
  uuid: string;
  name: string | null;
  organization: string | null;
  contact: string | null;
  description: string | null;
};

// collection.json is untrusted JSON from any producer. A field that's present
// but not a string must not throw (the broad catch below would silently drop the
// whole collection from discovery) — coerce non-strings and empties to null.
function cleanStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function listCollections(client: SafeS3Client): Promise<CollectionRef[]> {
  const buckets = await client.listBuckets();
  const candidates = buckets.filter(
    (b) => b.startsWith(COLLECTION_BUCKET_PREFIX) && b.length > COLLECTION_BUCKET_PREFIX.length,
  );
  const found: CollectionRef[] = [];
  await Promise.all(
    candidates.map(async (bucket) => {
      const uuid = bucket.slice(COLLECTION_BUCKET_PREFIX.length).toLowerCase();
      try {
        const bytes = await client.getObject(bucket, `Collections/${uuid}/collection.json`);
        const doc = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
        found.push({
          key: `${bucket}::${uuid}`,
          bucket,
          uuid,
          name: cleanStr(doc.nameProperty),
          organization: cleanStr(doc.organizationProperty),
          contact: cleanStr(doc.contactInfoProperty),
          description: cleanStr(doc.descriptionProperty),
        });
      } catch {
        // No marker, or unreadable / CORS-blocked. Keep probing.
      }
    }),
  );
  // Sort by display name so pickers read alphabetically; fall back to bucket,
  // then uuid as a stable tiebreak.
  return found.sort(
    (a, b) => (a.name ?? a.bucket).localeCompare(b.name ?? b.bucket) || a.uuid.localeCompare(b.uuid),
  );
}

export function parseCollectionKey(key: string): { bucket: string; uuid: string } {
  const [bucket, uuid] = key.split('::');
  return { bucket, uuid };
}
