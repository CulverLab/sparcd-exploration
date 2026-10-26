// Species lists and location registries for the open collections. They only
// improve names and fill blanks, so one that can't be read is left out, and
// the copy cached for this account and collection stands in for it.

import type { CollectionRef } from '@sparcd/s3-safe';
import { fetchLocations, type RegistryLocation } from './locations';
import type { Source } from './open';
import { fetchSpecies, type Species } from './species';

export type CollectionRegistries = { species: Species[]; registry: RegistryLocation[] };
/** One species list per collection, in order, and every registry entry together. */
export type Registries = { species: Species[][]; registry: RegistryLocation[] };

const NONE: CollectionRegistries = { species: [], registry: [] };

export const combineRegistries = (parts: CollectionRegistries[]): Registries => ({
  species: parts.map((p) => p.species),
  registry: parts.flatMap((p) => p.registry),
});

async function cachedPart(source: Source, ref: CollectionRef): Promise<CollectionRegistries | undefined> {
  const row = await source.db.registries.get([source.account, ref.key]);
  return row && { species: row.species, registry: row.registry };
}

/** What this account last read for each collection, without a request. */
export async function cachedRegistries(source: Source, refs: CollectionRef[]): Promise<Registries> {
  return combineRegistries(await Promise.all(refs.map(async (ref) => (await cachedPart(source, ref)) ?? NONE)));
}

/** Read each collection's species list and registry, and cache what was read. */
export async function fetchRegistries(source: Source, refs: CollectionRef[]): Promise<Registries> {
  const parts = await Promise.all(
    refs.map(async (ref) => {
      const [species, locations] = await Promise.allSettled([fetchSpecies(source.client, ref), fetchLocations(source.client, ref)]);
      const cached = species.status === 'rejected' || locations.status === 'rejected' ? await cachedPart(source, ref) : undefined;
      const part: CollectionRegistries = {
        species: species.status === 'fulfilled' ? species.value.species : (cached?.species ?? []),
        registry: locations.status === 'fulfilled' ? locations.value.locations : (cached?.registry ?? []),
      };
      await source.db.registries.put({ account: source.account, collection: ref.key, ...part });
      return part;
    }),
  );
  return combineRegistries(parts);
}
