// A synthetic multi-collection model for performance tests: made-up names,
// IDs and coordinates only.

import type { Media, NullableDeployment, Observation } from '@sparcd/camtrap';
import { buildModel, type LoadedCollection, type Model } from '../../src/data';
import { collectionRef } from './fixtures';

const SPECIES = ['Genus alpha', 'Genus beta', 'Genus gamma', 'Genus delta', 'Genus epsilon', 'Genus zeta', 'Genus eta', 'Genus theta'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `collections` collections of `perCollection` photos each, in uploads of 2,000, at 5 cameras each. */
export function bigCollections(collections: number, perCollection: number): LoadedCollection[] {
  return Array.from({ length: collections }, (_, c) => {
    const uuid = `perf${pad(c, 3)}`;
    const uploads = Array.from({ length: Math.ceil(perCollection / 2000) }, (_, u) => {
      const site = `P${pad(c, 3)}-${u % 5}`;
      const folder = `Collections/${uuid}/Uploads/${u}/`;
      const deployments: NullableDeployment[] = [
        {
          deploymentId: `${uuid}:${site}`,
          locationId: site,
          locationName: `Site ${site}`,
          latitude: 10 + c * 0.05 + (u % 5) * 0.01,
          longitude: -100 - c * 0.05 - (u % 5) * 0.01,
          elevation: 500 + c * 20,
        },
      ];
      const media: Media[] = [];
      const observations: Observation[] = [];
      const count = Math.min(2000, perCollection - u * 2000);
      for (let i = 0; i < count; i++) {
        const n = c * perCollection + u * 2000 + i;
        // Spread over 2013–2025, to the second, as camera timestamps are.
        const timestamp = `${2013 + (n % 13)}-${pad(1 + (n % 12))}-${pad(1 + ((n >> 3) % 28))}T${pad((n >> 5) % 24)}:${pad((n >> 2) % 60)}:${pad(n % 60)}`;
        const mediaPath = `${folder}IMG_${pad(i, 5)}.JPG`;
        media.push({ mediaId: mediaPath, deploymentId: `${uuid}:${site}`, mediaPath, fileName: `IMG_${pad(i, 5)}.JPG`, timestamp, mimeType: 'image/jpeg' });
        const scientificName = n % 3 === 0 ? '' : SPECIES[n % SPECIES.length];
        observations.push({
          observationId: `${n}`,
          mediaId: mediaPath,
          deploymentId: `${uuid}:${site}`,
          timestamp,
          observationType: scientificName ? 'animal' : 'blank',
          scientificName,
          count: scientificName ? 1 + (n % 3) : 0,
          tags: '',
        });
      }
      return { folder, etags: {}, meta: null, deployments, media, observations };
    });
    return { ref: collectionRef(`Collection ${pad(c, 2)}`, uuid), uploads, hiddenUploads: [], problems: [], changed: true, checkedAt: 0 };
  });
}

export const bigModel = (collections: number, perCollection: number): Model => buildModel(bigCollections(collections, perCollection));
