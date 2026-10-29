import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SafeS3Client } from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';
import { makeSyncIO } from '../src/lib/s3';
import type { CanonicalState } from '../src/lib/sync';

const CFG: S3Config = { endpoint: 'https://s3.example.org', region: 'us-east-1', accessKey: 'k', secretKey: 's', forcePathStyle: true };
const BUCKET = 'sparcd-x';
const PREFIX = 'Collections/uuid/Uploads/2024.01.15.10.00.00/';
const ORIGINAL = `${PREFIX}.sparcd-tagger-original/`;
const SNAP = `${PREFIX}.sparcd-tagger-snapshots/jg/2024-01-20T14-30-00/`;

const notFound = () => Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
const unavailable = () => Object.assign(new Error('busy'), { $metadata: { httpStatusCode: 503 } });

let objects: Map<string, string>;
let failRead: (key: string) => boolean;

beforeEach(() => {
  objects = new Map();
  failRead = () => false;
  vi.spyOn(SafeS3Client.prototype, 'getObject').mockImplementation(async (_bucket, key) => {
    if (failRead(key)) throw unavailable();
    const body = objects.get(key);
    if (body === undefined) throw notFound();
    return new TextEncoder().encode(body);
  });
  vi.spyOn(SafeS3Client.prototype, 'statObject').mockImplementation(async (_bucket, key) => ({ size: 0, etag: `"${key}"`, metadata: {} }));
  vi.spyOn(SafeS3Client.prototype, 'listCommonPrefixes').mockImplementation(async (_bucket, prefix) => [
    ...new Set(
      [...objects.keys()]
        .filter((key) => key.startsWith(prefix) && key.slice(prefix.length).includes('/'))
        .map((key) => `${prefix}${key.slice(prefix.length).split('/')[0]}/`),
    ),
  ]);
  vi.spyOn(SafeS3Client.prototype, 'writeImmutable').mockImplementation(async (_bucket, key, body) => {
    objects.set(key, String(body));
  });
});

afterEach(() => vi.restoreAllMocks());

const role = (text: string) => ({ text, etag: '"e"', hash: '' });
const CURRENT: CanonicalState = {
  media: role('edited media'),
  observations: role('edited observations'),
  deployments: role('edited deployments'),
  uploadMeta: role('{"edited":true}'),
};

function seedSnapshot(): void {
  objects.set(`${SNAP}media.csv`, 'original media');
  objects.set(`${SNAP}observations.csv`, 'original observations');
  objects.set(`${SNAP}deployments.csv`, 'original deployments');
  objects.set(`${SNAP}UploadMeta.json`, '{"original":true}');
  objects.set(`${SNAP}manifest.json`, JSON.stringify({ schemaVersion: 1, files: [] }));
}

const ensureBaseline = () =>
  makeSyncIO(CFG, BUCKET, PREFIX, { save: async () => {}, clear: async () => {} }).ensureOriginalBaseline!(CURRENT);
const baselineKeys = () => [...objects.keys()].filter((key) => key.startsWith(ORIGINAL));

describe('original upload baseline', () => {
  it('takes the oldest snapshot when the upload was edited before', async () => {
    seedSnapshot();
    await ensureBaseline();
    expect(objects.get(`${ORIGINAL}observations.csv`)).toBe('original observations');
  });

  it('uses the live files when the upload has no snapshot yet', async () => {
    await ensureBaseline();
    expect(objects.get(`${ORIGINAL}observations.csv`)).toBe('edited observations');
    expect(objects.has(`${ORIGINAL}manifest.json`)).toBe(true);
  });

  it('fails without writing a baseline when an existing snapshot cannot be read', async () => {
    seedSnapshot();
    failRead = (key) => key === `${SNAP}observations.csv`;
    await expect(ensureBaseline()).rejects.toThrow();
    expect(baselineKeys()).toEqual([]);
  });

  it('fails without writing a baseline when the snapshots cannot be listed', async () => {
    seedSnapshot();
    vi.mocked(SafeS3Client.prototype.listCommonPrefixes).mockRejectedValue(unavailable());
    await expect(ensureBaseline()).rejects.toThrow();
    expect(baselineKeys()).toEqual([]);
  });
});
