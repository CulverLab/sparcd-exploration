import { describe, it, expect } from 'vitest';
import type { S3Config } from '@sparcd/types';
import {
  SafeS3Client,
  ConditionalReplaceConflictError,
  ConditionalPutUnsupportedError,
  BucketNotWritableError,
} from '../src/index';

const CFG: S3Config = {
  endpoint: 'https://s3.example.test',
  region: 'us-east-1',
  accessKey: 'AK',
  secretKey: 'SK',
  forcePathStyle: true,
};

type SentCommand = { name: string; input: Record<string, unknown> };

/**
 * Build a client whose internal AWS S3 client is replaced by a stub that records
 * every command and runs `respond`. The wrapper still builds real command
 * objects, so the recorded `input` carries the exact headers it would send.
 */
function stubClient(
  respond: (cmd: SentCommand) => unknown,
  writeAllow: string[] = ['*'],
): { client: SafeS3Client; sent: SentCommand[] } {
  const client = new SafeS3Client(CFG, ['*'], writeAllow);
  const sent: SentCommand[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).client = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const record = { name: cmd.constructor.name, input: cmd.input };
      sent.push(record);
      return respond(record);
    },
  };
  return { client, sent };
}

function httpError(status: number, name: string): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

describe('replaceIfUnchanged — the reviewed conditional canonical overwrite', () => {
  it('sends a PutObject with the IfMatch ETag and returns the new ETag', async () => {
    const { client, sent } = stubClient(() => ({ ETag: '"new-etag"' }));
    const res = await client.replaceIfUnchanged('sparcd-x', 'Collections/u/media.csv', 'body', {
      etag: '"old-etag"',
      contentType: 'text/csv',
    });

    expect(res.etag).toBe('"new-etag"');
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('PutObjectCommand');
    expect(sent[0].input.IfMatch).toBe('old-etag');
    expect(sent[0].input.ContentType).toBe('text/csv');
    // No IfNoneMatch — this is a conditional *replace*, not an immutable write.
    expect(sent[0].input.IfNoneMatch).toBeUndefined();
  });

  it.each([
    ['"abc123"', 'abc123'],
    ['abc123', 'abc123'],
    ['W/"abc123"', 'abc123'],
  ])('sends If-Match %s unquoted as %s', async (etag, expected) => {
    const { client, sent } = stubClient(() => ({ ETag: '"new"' }));
    await client.replaceIfUnchanged('sparcd-x', 'k', 'b', { etag });
    expect(sent[0].input.IfMatch).toBe(expected);
  });

  it('throws ConditionalReplaceConflictError on a stale ETag (412) — no fallback PUT', async () => {
    const { client, sent } = stubClient((cmd) => {
      if (cmd.input.IfMatch) throw httpError(412, 'PreconditionFailed');
      return { ETag: '"unconditional"' }; // a fallback would land here
    });

    await expect(
      client.replaceIfUnchanged('sparcd-x', 'Collections/u/media.csv', 'body', {
        etag: '"stale"',
      }),
    ).rejects.toBeInstanceOf(ConditionalReplaceConflictError);

    // Exactly one attempt, and it carried IfMatch. The wrapper never retries
    // without the precondition (that would be a silent overwrite).
    expect(sent).toHaveLength(1);
    expect(sent[0].input.IfMatch).toBe('stale');
  });

  it('throws ConditionalPutUnsupportedError when the backend ignores IfMatch (501)', async () => {
    const { client } = stubClient(() => {
      throw httpError(501, 'NotImplemented');
    });
    await expect(
      client.replaceIfUnchanged('sparcd-x', 'Collections/u/media.csv', 'body', { etag: '"e"' }),
    ).rejects.toBeInstanceOf(ConditionalPutUnsupportedError);
  });

  it('refuses to write to a bucket outside the write allowlist before any network call', async () => {
    let called = false;
    const { client } = stubClient(() => {
      called = true;
      return {};
    }, []); // empty write allowlist

    await expect(
      client.replaceIfUnchanged('sparcd-x', 'Collections/u/media.csv', 'body', { etag: '"e"' }),
    ).rejects.toBeInstanceOf(BucketNotWritableError);
    expect(called).toBe(false);
  });

  it('only ever issues PutObject commands — no delete/copy surface exists', async () => {
    const { client, sent } = stubClient(() => ({ ETag: '"e2"' }));
    await client.replaceIfUnchanged('sparcd-x', 'k', 'b', { etag: '"e"' });
    expect(sent.every((c) => c.name === 'PutObjectCommand')).toBe(true);
    // The wrapper exposes no delete/copy methods at all.
    expect((client as unknown as Record<string, unknown>).deleteObject).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).copyObject).toBeUndefined();
  });
});
