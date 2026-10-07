import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';
import type { SafeS3Client } from '@sparcd/s3-safe';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { discoverSettingsBucket } = await import('../src/lib/s3');
const { readDiscovery, writeDiscovery, clearDiscovery } = await import('../src/lib/discoveryCache');

const CFG: S3Config = {
  endpoint: 'https://store.example',
  region: 'us-east-1',
  accessKey: 'AKIA1',
  secretKey: 'shh',
  forcePathStyle: true,
};

/**
 * A store whose only readable marker lives in `withMarker`. Records every
 * bucket probed, and how many probes were in flight at the peak.
 */
function fakeStore(buckets: string[], withMarker: Set<string>) {
  const probed: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const client = {
    async listBuckets() {
      return buckets;
    },
    async statObject(bucket: string) {
      probed.push(bucket);
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      if (!withMarker.has(bucket)) throw new Error('NoSuchKey');
      return { size: 1, metadata: {} };
    },
  } as unknown as SafeS3Client;
  return { client, probed, peak: () => peak };
}

const manyBuckets = (n: number) =>
  Array.from({ length: n }, (_, i) => `sparcd-${String(i).padStart(4, '0')}`);

describe('settings bucket discovery', () => {
  it('answers from the two conventional names without touching the rest', async () => {
    const buckets = [...manyBuckets(128), 'sparcd-settings-prod'];
    const { client, probed } = fakeStore(buckets, new Set(['sparcd-settings-prod']));

    expect(await discoverSettingsBucket(client)).toBe('sparcd-settings-prod');
    expect(probed).toEqual(['sparcd-settings-prod']);
  });

  it('prefers the official name over the legacy one', async () => {
    const buckets = ['sparcd', 'sparcd-settings-prod', 'zzz'];
    const { client } = fakeStore(buckets, new Set(['sparcd', 'sparcd-settings-prod']));
    expect(await discoverSettingsBucket(client)).toBe('sparcd-settings-prod');
  });

  it('falls back to the rest of the store, alphabetically, when neither name has it', async () => {
    const buckets = ['sparcd', 'zzz-late', 'aaa-early', 'sparcd-0001'];
    const { client, probed } = fakeStore(buckets, new Set(['aaa-early', 'zzz-late']));

    expect(await discoverSettingsBucket(client)).toBe('aaa-early');
    expect(probed[0]).toBe('sparcd'); // conventional name asked first, and missed
  });

  // The winner has to be the first in preference order, not whichever probe
  // happened to resolve first — so probes go out in bounded chunks.
  it('keeps at most 16 probes in flight', async () => {
    const buckets = manyBuckets(129);
    const { client, peak } = fakeStore(buckets, new Set(['sparcd-0100']));

    expect(await discoverSettingsBucket(client)).toBe('sparcd-0100');
    expect(peak()).toBeLessThanOrEqual(16);
  });

  it('confirms a remembered bucket with one request and skips the search', async () => {
    const buckets = manyBuckets(129);
    const { client, probed } = fakeStore(buckets, new Set(['sparcd-0100']));
    const listBuckets = vi.spyOn(client, 'listBuckets');

    expect(await discoverSettingsBucket(client, 'sparcd-0100')).toBe('sparcd-0100');
    expect(probed).toEqual(['sparcd-0100']);
    expect(listBuckets).not.toHaveBeenCalled();
  });

  it('re-searches when a remembered bucket no longer answers', async () => {
    const buckets = ['sparcd-settings-prod', ...manyBuckets(8)];
    const { client, probed } = fakeStore(buckets, new Set(['sparcd-settings-prod']));

    expect(await discoverSettingsBucket(client, 'sparcd-gone')).toBe('sparcd-settings-prod');
    expect(probed).toEqual(['sparcd-gone', 'sparcd-settings-prod']);
  });

  it('reports an actionable error when nothing in the store has the marker', async () => {
    const { client } = fakeStore(['a', 'b'], new Set());
    await expect(discoverSettingsBucket(client)).rejects.toThrow(/No readable settings bucket/);
  });
});

describe('discovery cache', () => {
  beforeEach(() => store.clear());

  it('round-trips what a probe found, merging fields written separately', () => {
    writeDiscovery(CFG, { settingsBucket: 'sparcd-settings-prod' });
    writeDiscovery(CFG, { collections: [] });

    const entry = readDiscovery(CFG)!;
    expect(entry.settingsBucket).toBe('sparcd-settings-prod');
    expect(entry.collections).toEqual([]);
    expect(entry.at).toBeGreaterThan(0);
  });

  it('keeps accounts apart by endpoint and access key', () => {
    writeDiscovery(CFG, { settingsBucket: 'one' });
    writeDiscovery({ ...CFG, accessKey: 'AKIA2' }, { settingsBucket: 'two' });

    expect(readDiscovery(CFG)?.settingsBucket).toBe('one');
    expect(readDiscovery({ ...CFG, accessKey: 'AKIA2' })?.settingsBucket).toBe('two');
    expect(readDiscovery({ ...CFG, endpoint: 'https://other.example' })).toBeNull();
  });

  it('keeps only the four most recently seen accounts', () => {
    for (let i = 0; i < 6; i++) writeDiscovery({ ...CFG, accessKey: `AKIA${i}` }, { settingsBucket: `b${i}` });

    const kept = [0, 1, 2, 3, 4, 5].filter((i) => readDiscovery({ ...CFG, accessKey: `AKIA${i}` }));
    expect(kept).toEqual([2, 3, 4, 5]);
  });

  it('forgets an account on clear and ignores an entry from an older shape', () => {
    writeDiscovery(CFG, { settingsBucket: 'one' });
    clearDiscovery(CFG);
    expect(readDiscovery(CFG)).toBeNull();

    store.set('sparcd-uploader-discovery', JSON.stringify({ v: 0, accounts: { x: { at: 1 } } }));
    expect(readDiscovery(CFG)).toBeNull();
  });

  it('ignores collections cached before they carried their buckets', () => {
    const v1Ref = { key: 'sparcd-c::c', bucket: 'sparcd-c', uuid: 'c', name: 'C' };
    const accounts = { [`${CFG.endpoint}\0${CFG.accessKey}`]: { at: 1, collections: [v1Ref] } };
    store.set('sparcd-uploader-discovery', JSON.stringify({ v: 1, accounts }));
    expect(readDiscovery(CFG)).toBeNull();
  });

  it('clears one named field and leaves the rest of the account warm', () => {
    writeDiscovery(CFG, { settingsBucket: 'one', collections: [] });

    clearDiscovery(CFG, 'collections');
    expect(readDiscovery(CFG)?.collections).toBeUndefined();
    expect(readDiscovery(CFG)?.settingsBucket).toBe('one');

    clearDiscovery(CFG, 'settingsBucket');
    expect(readDiscovery(CFG)?.settingsBucket).toBeUndefined();
  });
});
