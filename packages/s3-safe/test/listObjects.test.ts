import { describe, it, expect } from 'vitest';
import { SafeS3Client } from '../src/index';

// Two pages of a recursive listing, answered by a stand-in for the SDK client.
function client(pages: string[][]) {
  const calls: { token?: string; signal?: AbortSignal }[] = [];
  const safe = new SafeS3Client(
    { endpoint: 'https://server.example.org', region: 'us-east-1', accessKey: 'k', secretKey: 's', forcePathStyle: true },
    ['sparcd-*'],
  );
  Object.assign(safe, {
    client: {
      async send(command: { input: { ContinuationToken?: string } }, opts: { abortSignal?: AbortSignal }) {
        opts.abortSignal?.throwIfAborted();
        const page = Number(command.input.ContinuationToken ?? 0);
        calls.push({ token: command.input.ContinuationToken, signal: opts.abortSignal });
        const more = page + 1 < pages.length;
        return { Contents: pages[page].map((Key) => ({ Key })), IsTruncated: more, NextContinuationToken: more ? String(page + 1) : undefined };
      },
    },
  });
  return { safe, calls };
}

describe('listObjects', () => {
  it('walks every page under the prefix', async () => {
    const { safe } = client([['a/1.jpg', 'a/2.jpg'], ['a/b/3.jpg']]);
    const keys: string[] = [];
    for await (const o of safe.listObjects('sparcd-x', 'a/')) keys.push(o.key);
    expect(keys).toEqual(['a/1.jpg', 'a/2.jpg', 'a/b/3.jpg']);
  });

  it('hands its signal to every page, and stops once it aborts', async () => {
    const { safe, calls } = client([['a/1.jpg'], ['a/2.jpg'], ['a/3.jpg']]);
    const controller = new AbortController();
    const keys: string[] = [];
    await expect(
      (async () => {
        for await (const o of safe.listObjects('sparcd-x', 'a/', { signal: controller.signal })) {
          keys.push(o.key);
          controller.abort();
        }
      })(),
    ).rejects.toThrow();
    expect(keys).toEqual(['a/1.jpg']);
    expect(calls).toHaveLength(1);
    expect(calls[0].signal).toBe(controller.signal);
  });
});
