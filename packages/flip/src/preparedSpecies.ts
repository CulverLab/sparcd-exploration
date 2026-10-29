/** Non-secret, immutable batch vocabulary: Settings master list or a legacy collection snapshot. */
export type PreparedSpecies = {
  v: 2;
  endpoint: string;
  /** Non-secret hash of the endpoint and effective Access key ID. */
  ownerScope: string;
  collectionKey: string;
  collectionName: string;
  sourceBucket: string;
  sourceKey: string;
  sourceHash: string;
  preparedAt: string;
  profileId: string;
  overrides: Record<string, string | null>;
  species: { key: string; scientificName: string; commonName: string; iconUrl: string; keyBinding: string | null }[];
};

export function validPreparedSpecies(value: unknown): value is PreparedSpecies {
  if (!value || typeof value !== 'object') return false;
  const s = value as PreparedSpecies;
  return s.v === 2 && ['endpoint', 'ownerScope', 'collectionKey', 'collectionName', 'sourceBucket', 'sourceKey', 'sourceHash', 'preparedAt', 'profileId'].every((key) => typeof (s as any)[key] === 'string' && (s as any)[key].length > 0)
    && /^flip-owner-v1:[a-f0-9]{64}$/.test(s.ownerScope)
    && /^[a-f0-9]{64}$/.test(s.sourceHash) && Number.isFinite(Date.parse(s.preparedAt))
    && !!s.overrides && typeof s.overrides === 'object' && !Array.isArray(s.overrides)
    && Object.values(s.overrides).every((key) => key === null || typeof key === 'string')
    && Array.isArray(s.species) && s.species.length > 0
    && s.species.every((item) => item && typeof item.scientificName === 'string' && !!item.scientificName.trim()
      && item.key === item.scientificName && typeof item.commonName === 'string' && !!item.commonName.trim()
      && typeof item.iconUrl === 'string' && (item.keyBinding === null || typeof item.keyBinding === 'string'))
    && new Set(s.species.map((item) => item.scientificName)).size === s.species.length;
}

/** Whitelist fields so neither transport nor cache can accidentally retain credentials. */
export function copyPreparedSpecies(snapshot: PreparedSpecies): PreparedSpecies {
  const { v, endpoint, ownerScope, collectionKey, collectionName, sourceBucket, sourceKey, sourceHash, preparedAt, profileId, overrides, species } = snapshot;
  return { v, endpoint, ownerScope, collectionKey, collectionName, sourceBucket, sourceKey, sourceHash, preparedAt, profileId, overrides: { ...overrides }, species: species.map(({ key, scientificName, commonName, iconUrl, keyBinding }) => ({ key, scientificName, commonName, iconUrl, keyBinding })) };
}
