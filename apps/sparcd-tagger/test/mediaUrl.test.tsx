import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

type PresignQuery = { queryKey: unknown[]; queryFn: () => Promise<string>; enabled: boolean };

const useQuery = vi.hoisted(() => vi.fn((_: PresignQuery) => ({ data: undefined, isError: false })));
const presignImage = vi.hoisted(() => vi.fn(async () => 'https://signed.example.test/'));
// The collection is keyed by its legacy bucket; the open upload was listed from the data bucket.
const state = vi.hoisted(() => ({
  s3Config: { endpoint: 'https://s3.example.test' },
  connectionId: 1,
  selectedCollectionKey: 'sparcd-abc::abc',
  selectedUploadBucket: 'field-data',
}));

vi.mock('@tanstack/react-query', () => ({ useQuery }));
vi.mock('../src/lib/s3', () => ({ presignImage }));
vi.mock('../src/store', () => ({ useStore: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock('../src/lib/localBatch', () => ({
  useLocalBatch: (select: (s: { status: string; media: Record<string, Blob> }) => unknown) =>
    select({ status: 'missing', media: {} }),
}));

import { useMediaUrl } from '../src/lib/useMediaUrl';

function Probe({ objectKey }: { objectKey: string }) {
  useMediaUrl(objectKey);
  return null;
}

describe('presigning media', () => {
  it("signs the key against the open upload's bucket", async () => {
    const key = `Media/${'a'.repeat(64)}/20240110080000-IMG001.JPG`;
    renderToStaticMarkup(<Probe objectKey={key} />);

    const query = useQuery.mock.calls[0][0];
    expect(query.queryKey).toEqual(['presign', 1, 'field-data', key]);
    expect(query.enabled).toBe(true);
    await query.queryFn();
    expect(presignImage).toHaveBeenCalledWith(state.s3Config, 'field-data', key);
  });
});
