import { describe, it, expect } from 'vitest';
import type { S3Config } from '@sparcd/types';
import { SafeS3Client, BucketNotAllowedError } from '../src/index';

const CFG: S3Config = {
  endpoint: 'https://s3.example.test',
  region: 'us-east-1',
  accessKey: 'AK',
  secretKey: 'SK',
  forcePathStyle: true,
};

type Sent = { name: string; input: Record<string, unknown>; abortSignal?: AbortSignal };

function stubClient(respond: (cmd: Sent) => unknown, allow = ['*']): { client: SafeS3Client; sent: Sent[] } {
  const client = new SafeS3Client(CFG, allow);
  const sent: Sent[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).client = {
    send: async (
      cmd: { constructor: { name: string }; input: Record<string, unknown> },
      opts?: { abortSignal?: AbortSignal },
    ) => {
      const record = { name: cmd.constructor.name, input: cmd.input, abortSignal: opts?.abortSignal };
      sent.push(record);
      return respond(record);
    },
  };
  return { client, sent };
}

describe('listFolder', () => {
  it('returns subfolders and direct objects with ETags across pages', async () => {
    const pages = [
      {
        CommonPrefixes: [{ Prefix: 'Up/a/sub/' }],
        Contents: [{ Key: 'Up/a/UploadMeta.json', Size: 10, ETag: '"m1"' }],
        IsTruncated: true,
        NextContinuationToken: 't2',
      },
      { Contents: [{ Key: 'Up/a/media.csv', Size: 20, ETag: '"c1"' }], IsTruncated: false },
    ];
    const { client, sent } = stubClient(() => pages.shift());

    const listing = await client.listFolder('sparcd-x', 'Up/a/');

    expect(listing.prefixes).toEqual(['Up/a/sub/']);
    expect(listing.objects.map((o) => [o.key, o.etag])).toEqual([
      ['Up/a/UploadMeta.json', '"m1"'],
      ['Up/a/media.csv', '"c1"'],
    ]);
    expect(sent.map((s) => s.input)).toEqual([
      { Bucket: 'sparcd-x', Prefix: 'Up/a/', Delimiter: '/', ContinuationToken: undefined },
      { Bucket: 'sparcd-x', Prefix: 'Up/a/', Delimiter: '/', ContinuationToken: 't2' },
    ]);
  });

  it('passes the abort signal to every request', async () => {
    const { client, sent } = stubClient(() => ({ IsTruncated: false }));
    const controller = new AbortController();

    await client.listFolder('sparcd-x', 'Up/', { signal: controller.signal });
    await client.getObject('sparcd-x', 'Up/media.csv', { signal: controller.signal }).catch(() => {});

    expect(sent.map((s) => s.abortSignal)).toEqual([controller.signal, controller.signal]);
  });

  it('reads part of an object when asked for a byte range, and the whole object otherwise', async () => {
    const body = { transformToByteArray: async () => new Uint8Array([1, 2, 3]) };
    const { client, sent } = stubClient(() => ({ Body: body }));

    expect(await client.getObject('sparcd-x', 'Up/a.jpg', { range: 'bytes=0-65999' })).toEqual(new Uint8Array([1, 2, 3]));
    await client.getObject('sparcd-x', 'Up/a.jpg');

    expect(sent.map((s) => s.input)).toEqual([
      { Bucket: 'sparcd-x', Key: 'Up/a.jpg', Range: 'bytes=0-65999' },
      { Bucket: 'sparcd-x', Key: 'Up/a.jpg', Range: undefined },
    ]);
  });

  it('refuses a bucket outside the read allowlist', async () => {
    const { client, sent } = stubClient(() => ({}), ['sparcd-ok']);
    await expect(client.listFolder('sparcd-other', 'Up/')).rejects.toBeInstanceOf(BucketNotAllowedError);
    expect(sent).toHaveLength(0);
  });
});
