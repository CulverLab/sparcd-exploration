import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSpeciesVocabulary, type SafeS3Client } from '@sparcd/s3-safe';
import { useKeyBindings, keyProfileId, activeKeyProfile } from '@sparcd/auth-ui';
import { assessPreparedAssignment, snapshotPreparation, stagePreparation } from '../src/lib/preparedSpecies';

const cfg = { endpoint: 'https://storage.test', accessKey: 'person', secretKey: 'NEVER-PERSIST', region: 'us-east-1', forcePathStyle: true };
const collection = { key: 'bucket::one', bucket: 'bucket', uuid: 'one', name: 'One', organization: null, contact: null, description: null };
const species = [{ key: 'Canis latrans', scientificName: 'Canis latrans', commonName: 'Coyote', iconUrl: '', keyBinding: 'C' }];
const result = { species, skipped: [], settingsBucket: null, sourceBucket: 'bucket', sourceKey: 'Collections/one/species.json' };

beforeEach(() => { useKeyBindings.setState({ profiles: {}, activeProfileId: null, unsaved: false }); });

describe('prepared vocabulary', () => {
  it('captures the accepted list, original source hash and local key override without credentials', async () => {
    stagePreparation(cfg, result);
    useKeyBindings.getState().assignKey('Canis latrans', 'y');
    const snapshot = await snapshotPreparation(cfg, collection, result);
    expect(snapshot.overrides).toEqual({ 'Canis latrans': 'y' });
    expect(snapshot.profileId).toBe(keyProfileId(cfg.endpoint, cfg.accessKey));
    expect(snapshot.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.species).toEqual(species);
    expect(JSON.stringify(snapshot)).not.toContain(cfg.secretKey);
    species[0].commonName = 'Changed after preparation';
    expect(snapshot.species[0].commonName).toBe('Coyote');
    species[0].commonName = 'Coyote';
  });

  it('requires the existing source-aware acknowledgement before accepting changed entries', async () => {
    await snapshotPreparation(cfg, collection, result);
    const next = { ...result, species: [{ ...species[0], commonName: 'New name' }] };
    await expect(snapshotPreparation(cfg, collection, next)).rejects.toThrow('Review and accept');
    const source = `${result.sourceBucket}/${result.sourceKey}`;
    expect(activeKeyProfile(useKeyBindings.getState()).speciesSources?.[source]?.pendingSpeciesChange?.diff.modified).toHaveLength(1);
    useKeyBindings.getState().acknowledgeSpeciesChange(source);
    expect((await snapshotPreparation(cfg, collection, next)).species[0].commonName).toBe('New name');
  });

  it('requires explicit assignment review for different accounts, collections and changed lists', async () => {
    const snapshot = await snapshotPreparation(cfg, collection, result);
    expect(assessPreparedAssignment(snapshot, result, cfg, collection.key, [])).toEqual({ missing: [], changed: false });
    const reordered = { ...result, species: result.species.map(({ key, scientificName, commonName, iconUrl, keyBinding }) => ({ key, scientificName, commonName, iconUrl, keyBinding })) };
    expect(assessPreparedAssignment(snapshot, reordered, cfg, collection.key, []).changed).toBe(false);
    for (const [account, key] of [['other', collection.key], [cfg.accessKey, 'bucket::two']]) {
      expect(assessPreparedAssignment(snapshot, result, { ...cfg, accessKey: account }, key, []).changed).toBe(true);
    }
    const changed = { ...result, species: [] };
    const tags = [{ scientificName: 'Canis latrans' }, { scientificName: 'Requested name', requestedSpecies: 'Requested name' }];
    expect(assessPreparedAssignment(snapshot, changed, cfg, collection.key, tags).missing).toEqual(['Canis latrans', 'Requested name']);
    expect(tags).toHaveLength(2);
  });
});

it.each(['[]', undefined])('uses production settings fallback for an empty/missing collection (%s)', async (raw) => {
  const getObject = vi.fn(async (bucket: string) => {
    if (bucket === 'bucket') {
      if (raw === undefined) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return new TextEncoder().encode(raw);
    }
    return new TextEncoder().encode('[{"name":"Coyote","scientificName":"Canis latrans"}]');
  });
  const client = { getObject, listBuckets: async () => ['sparcd-settings-test'], statObject: async () => ({}) } as unknown as SafeS3Client;
  expect((await loadSpeciesVocabulary(client, collection.key)).sourceKey).toBe('Settings/species.json');
});

it.each(['bad JSON', '[{"name":"Invalid"}]'])('does not substitute settings for a malformed collection (%s)', async (raw) => {
  const listBuckets = vi.fn();
  const client = { getObject: async () => new TextEncoder().encode(raw), listBuckets } as unknown as SafeS3Client;
  await expect(loadSpeciesVocabulary(client, collection.key)).rejects.toThrow();
  expect(listBuckets).not.toHaveBeenCalled();
});

it('preserves a collection read denial instead of falling back', async () => {
  const listBuckets = vi.fn();
  const client = { getObject: async () => { throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }); }, listBuckets } as unknown as SafeS3Client;
  await expect(loadSpeciesVocabulary(client, collection.key)).rejects.toThrow('Access denied');
  expect(listBuckets).not.toHaveBeenCalled();
});
