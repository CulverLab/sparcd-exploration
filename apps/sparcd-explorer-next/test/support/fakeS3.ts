// An in-memory, read-only S3 for the opener and cache tests. Every object gets
// a fresh ETag when written; requests are counted and can be slowed down,
// failed, or aborted.

import { serializeCsvRows, serializeMedia, serializeObservations } from '@sparcd/camtrap';
import type { ObjectInfo, ObjectStat } from '@sparcd/s3-safe';
import type { ReadClient } from '../../src/data';
import type { NullableDeployment, Media, Observation } from '@sparcd/camtrap';

const notFound = () => Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });

export class FakeS3 implements ReadClient {
  private objects = new Map<string, { body: Uint8Array; etag: string }>();
  private version = 0;
  /** `bucket/key` → error thrown by getObject (and listFolder for a prefix). */
  failures = new Map<string, unknown>();
  gets: string[] = [];
  lists: string[] = [];
  inFlight = 0;
  peak = 0;
  /** Milliseconds each request takes. */
  latency = 0;
  /** Keys per page of a recursive listing. */
  pageSize = 1000;

  put(bucket: string, key: string, text: string): this {
    this.objects.set(`${bucket}/${key}`, { body: new TextEncoder().encode(text), etag: `"v${++this.version}"` });
    return this;
  }

  remove(bucket: string, key: string): this {
    this.objects.delete(`${bucket}/${key}`);
    return this;
  }

  resetCounts(): void {
    this.gets = [];
    this.lists = [];
    this.peak = 0;
  }

  private async request(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.latency);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      });
    } finally {
      this.inFlight--;
    }
  }

  async listBuckets(): Promise<string[]> {
    return [...new Set([...this.objects.keys()].map((k) => k.split('/')[0]))];
  }

  async statObject(bucket: string, key: string): Promise<ObjectStat> {
    const hit = this.objects.get(`${bucket}/${key}`);
    if (!hit) throw notFound();
    return { size: hit.body.length, etag: hit.etag, metadata: {} };
  }

  async getObject(bucket: string, key: string, opts: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
    this.gets.push(`${bucket}/${key}`);
    await this.request(opts.signal);
    const failure = this.failures.get(`${bucket}/${key}`);
    if (failure) throw failure;
    const hit = this.objects.get(`${bucket}/${key}`);
    if (!hit) throw notFound();
    return hit.body;
  }

  async listFolder(
    bucket: string,
    prefix: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ prefixes: string[]; objects: ObjectInfo[] }> {
    this.lists.push(`${bucket}/${prefix}`);
    await this.request(opts.signal);
    const failure = this.failures.get(`${bucket}/${prefix}`);
    if (failure) throw failure;
    const prefixes = new Set<string>();
    const objects: ObjectInfo[] = [];
    for (const [path, { body, etag }] of this.objects) {
      if (!path.startsWith(`${bucket}/${prefix}`)) continue;
      const key = path.slice(bucket.length + 1);
      const rest = key.slice(prefix.length);
      if (rest.includes('/')) prefixes.add(prefix + rest.split('/')[0] + '/');
      else objects.push({ key, size: body.length, etag });
    }
    return { prefixes: [...prefixes].sort(), objects: objects.sort((a, b) => a.key.localeCompare(b.key)) };
  }

  /** Every object under `prefix`, a page of `pageSize` per request. */
  async *listObjects(bucket: string, prefix = '', opts: { signal?: AbortSignal } = {}): AsyncIterable<ObjectInfo> {
    this.lists.push(`${bucket}/${prefix}**`);
    const keys = [...this.objects.keys()].filter((path) => path.startsWith(`${bucket}/${prefix}`)).sort();
    let i = 0;
    do {
      await this.request(opts.signal);
      const failure = this.failures.get(`${bucket}/${prefix}`);
      if (failure) throw failure;
      for (const path of keys.slice(i, i + this.pageSize)) {
        const { body, etag } = this.objects.get(path)!;
        yield { key: path.slice(bucket.length + 1), size: body.length, etag };
      }
      i += this.pageSize;
    } while (i < keys.length);
  }
}

const deploymentsCsv = (rows: NullableDeployment[]) =>
  serializeCsvRows(
    rows.map((d) => {
      const row = new Array<string>(23).fill('');
      row[0] = d.deploymentId;
      row[1] = d.locationId;
      row[2] = d.locationName;
      row[3] = d.longitude === null ? '' : d.longitude.toFixed(6);
      row[4] = d.latitude === null ? '' : d.latitude.toFixed(6);
      row[12] = d.elevation === null ? '' : d.elevation.toFixed(6);
      return row;
    }),
  );

/** Write one upload folder the way the uploader lays it out. */
export function putUpload(
  s3: FakeS3,
  bucket: string,
  uuid: string,
  stamp: string,
  rows: { meta?: boolean; deployments?: NullableDeployment[]; media?: Media[]; observations?: Observation[] },
): string {
  const folder = `Collections/${uuid}/Uploads/${stamp}/`;
  if (rows.meta !== false) s3.put(bucket, `${folder}UploadMeta.json`, JSON.stringify({ uploadUser: 'tester', imageCount: rows.media?.length ?? 0 }));
  s3.put(bucket, `${folder}deployments.csv`, deploymentsCsv(rows.deployments ?? []));
  s3.put(bucket, `${folder}media.csv`, serializeMedia(rows.media ?? []));
  if (rows.observations) s3.put(bucket, `${folder}observations.csv`, serializeObservations(rows.observations));
  // An image beside the CSVs, which the opener must never fetch.
  s3.put(bucket, `${folder}IMG_0001.JPG`, 'jpeg bytes');
  return folder;
}

export function putCollection(s3: FakeS3, bucket: string, uuid: string, name: string): void {
  s3.put(bucket, `Collections/${uuid}/collection.json`, JSON.stringify({ nameProperty: name }));
}
