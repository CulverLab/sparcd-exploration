import { beforeEach, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({ saved: null as any, result: null as any }));
vi.mock('@sparcd/flip', async original => ({ ...await original<typeof import('@sparcd/flip')>(),
  loadPreparedSpecies: async (scope?: any) => !scope || memory.saved?.account === scope.accessKey ? memory.saved : null,
  savePreparedSpecies: async (value: any) => { memory.saved = structuredClone(value); },
}));
vi.mock('@sparcd/s3-safe', async original => ({ ...await original<typeof import('@sparcd/s3-safe')>(),
  loadSpeciesVocabulary: vi.fn(async () => { if (memory.result instanceof Error) throw memory.result; return memory.result; }),
}));
vi.mock('../src/lib/s3', () => ({ getClient: () => ({}) }));
import { loadMasterSpecies, refreshMasterSpecies } from '../src/lib/masterSpecies';
import { loadSpeciesVocabulary } from '@sparcd/s3-safe';
const cfg = { endpoint: 'https://storage.test', accessKey: 'person', secretKey: 'NEVER-SAVE', region: 'us-east-1', forcePathStyle: true };
beforeEach(() => {
  memory.saved = null;
  memory.result = { species: [{ key: 'Coyote', scientificName: 'Coyote', commonName: 'Coyote', iconUrl: '', keyBinding: 'C' }], skipped: [], settingsBucket: 'settings', sourceBucket: 'settings', sourceKey: 'Settings/species.json' };
  vi.clearAllMocks();
});
it('fetches only the Settings master list and makes it available for Login Later without credentials', async () => {
  await refreshMasterSpecies(cfg);
  expect(loadSpeciesVocabulary).toHaveBeenCalledWith({});
  expect((await loadMasterSpecies())?.species[0].scientificName).toBe('Coyote');
  expect(JSON.stringify(memory.saved)).not.toContain('NEVER-SAVE');
  expect(await loadMasterSpecies({ ...cfg, accessKey: 'other' })).toBeNull();
});
it.each(['denied', 'empty', 'invalid'])('keeps the last valid master catalog when refresh is %s', async failure => {
  await refreshMasterSpecies(cfg); const original = structuredClone(memory.saved);
  if (failure === 'denied') memory.result = new Error('denied');
  if (failure === 'empty') memory.result.species = [];
  if (failure === 'invalid') memory.result.skipped = [{ reason: 'invalid' }];
  await expect(refreshMasterSpecies(cfg)).rejects.toThrow();
  expect(memory.saved).toEqual(original);
});
it('does not accept a late download after the connection changes or treat a legacy collection as the master cache', async () => {
  expect(await refreshMasterSpecies(cfg, () => false)).toBeNull();
  expect(memory.saved).toBeNull();
  await refreshMasterSpecies(cfg);
  memory.saved.collectionKey = 'collection::legacy';
  expect(await loadMasterSpecies()).toBeNull();
});

it('reports every missing official species, including legacy requested names, without changing tags', async () => {
  const {checkOfficialSpecies}=await import('../src/lib/preparedSpecies');
  const tags=[{scientificName:'Coyote'},{scientificName:'Removed'},{scientificName:'Requested',requestedSpecies:'Requested'}];
  const original=structuredClone(tags);
  expect(await checkOfficialSpecies(cfg,{key:'bucket::one'} as any,tags)).toEqual(['Removed','Requested']);
  expect(tags).toEqual(original);
});
