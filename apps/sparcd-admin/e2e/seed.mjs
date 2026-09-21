// The storage this run works against: a settings area holding the two shared
// lists, two collections, and — locally only — one bucket outside the
// namespace holding a canary nothing in the run may ever reach.
//
// The shapes are the ones the apps actually read: `nameProperty` and friends
// for locations and collections, `scientificName` for species. The locations
// list deliberately repeats a location ID and a name, because the real legacy
// list does both and the checklist has to cope.

export const UUID_A = '6b1f2d54-9a3c-4f21-b8d7-2e5c1a0f9b44';
export const UUID_B = 'c3e0a17b-58d4-4a96-9f2e-7d10b6c4e832';

export const SETTINGS_BUCKET = 'sparcd-settings-test';
export const BUCKET_A = `sparcd-${UUID_A}`;
export const BUCKET_B = `sparcd-${UUID_B}`;

export const CANARY_BUCKET = 'canary-private';
export const CANARY_KEY = 'secret.txt';
export const CANARY_BODY = 'the-canary-must-never-be-read\n';

export const SPECIES_KEY = 'Settings/species.json';
export const LOCATIONS_KEY = 'Settings/locations.json';

export const UPLOAD_STAMP_A = '2026.03.14.07.20.11_alma';
export const UPLOAD_STAMP_B = '2026.02.02.18.45.03_ramos';
export const MEDIA_A = `Collections/${UUID_A}/Uploads/${UPLOAD_STAMP_A}/IMG_0412.JPG`;
export const MEDIA_B = `Collections/${UUID_B}/Uploads/${UPLOAD_STAMP_B}/IMG_1190.JPG`;

export const SPECIES = [
  { name: 'Mountain Lion', scientificName: 'Puma concolor', genus: 'Puma', species: 'concolor', keyBinding: 'm' },
  { name: 'Black Bear', scientificName: 'Ursus americanus', genus: 'Ursus', species: 'americanus', keyBinding: 'b' },
  { name: 'Coati', scientificName: 'Nasua narica', genus: 'Nasua', species: 'narica', keyBinding: 'c' },
  { name: 'Javelina', scientificName: 'Pecari tajacu', genus: 'Pecari', species: 'tajacu', keyBinding: 'j' },
  { name: 'Bobcat', scientificName: 'Lynx rufus', genus: 'Lynx', species: 'rufus', keyBinding: 'x' },
  { name: 'Coyote', scientificName: 'Canis latrans', genus: 'Canis', species: 'latrans', keyBinding: 'y' },
  { name: 'Gray Fox', scientificName: 'Urocyon cinereoargenteus', genus: 'Urocyon', species: 'cinereoargenteus', keyBinding: 'g' },
  { name: 'White-nosed Skunk', scientificName: 'Conepatus leuconotus', genus: 'Conepatus', species: 'leuconotus', keyBinding: 'k' },
];

export const LOCATIONS = [
  { nameProperty: 'Bear Canyon Upper', idProperty: 'BCU-01', latProperty: 32.3311, lngProperty: -110.7412, elevationProperty: 1620 },
  { nameProperty: 'Bear Canyon Lower', idProperty: 'BCL-02', latProperty: 32.3194, lngProperty: -110.7488, elevationProperty: 1180 },
  // Two sites the legacy list gave the same ID. Neither may be silently
  // rewritten with the other's coordinates.
  { nameProperty: 'Chiricahua Saddle', idProperty: 'CHI-07', latProperty: 31.8831, lngProperty: -109.3412, elevationProperty: 2310 },
  { nameProperty: 'Chiricahua Spring', idProperty: 'CHI-07', latProperty: 31.8702, lngProperty: -109.3588, elevationProperty: 2040 },
  // Two sites that share a name but not an ID — the other half of the mess.
  { nameProperty: 'Rincon Tank', idProperty: 'RIN-11', latProperty: 32.1584, lngProperty: -110.5109, elevationProperty: 1415 },
  { nameProperty: 'Rincon Tank', idProperty: 'RIN-12', latProperty: 32.1622, lngProperty: -110.5043, elevationProperty: 1460 },
  { nameProperty: 'Santa Rita Wash', idProperty: 'SRW-04', latProperty: 31.7402, lngProperty: -110.8721, elevationProperty: 1290, sensitive: true },
  { nameProperty: 'Peppersauce Draw', idProperty: 'PEP-09', latProperty: 32.5918, lngProperty: -110.7201, elevationProperty: 1510, retired: true },
];

export const COLLECTIONS = [
  {
    bucket: BUCKET_A,
    uuid: UUID_A,
    stamp: UPLOAD_STAMP_A,
    document: {
      nameProperty: 'Sky Islands 2026',
      organizationProperty: 'Sky Island Alliance',
      contactInfoProperty: 'field@skyislandalliance.example',
      descriptionProperty: 'Camera traps across the Santa Catalina and Rincon sky islands.',
    },
    species: SPECIES.slice(0, 5),
    locations: LOCATIONS.slice(0, 4),
    media: ['IMG_0412.JPG', 'IMG_0413.JPG', 'IMG_0414.JPG'],
  },
  {
    bucket: BUCKET_B,
    uuid: UUID_B,
    stamp: UPLOAD_STAMP_B,
    document: {
      nameProperty: 'Research 1',
      organizationProperty: 'Culver Lab',
      contactInfoProperty: 'lab@culver.example',
      descriptionProperty: 'The long-running research transect, kept separate from the volunteer work.',
    },
    species: SPECIES.slice(2, 7),
    locations: LOCATIONS.slice(4, 7),
    media: ['IMG_1190.JPG', 'IMG_1191.JPG'],
  },
];

const json = (value) => JSON.stringify(value, null, 2);

// Enough of a JPEG that a browser and an SDK both treat it as one, without
// carrying a real photograph into the repository.
const jpegBytes = (label) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    Buffer.from(label.padEnd(64, ' '), 'utf8'),
    Buffer.from([0xff, 0xd9]),
  ]);

/** Every object this run writes while seeding, so a remote run can undo it. */
export function seedPlan(namespace) {
  const at = (bucket) => `${namespace}${bucket}`;
  const objects = [
    { bucket: at(SETTINGS_BUCKET), key: SPECIES_KEY, body: json(SPECIES), contentType: 'application/json' },
    { bucket: at(SETTINGS_BUCKET), key: LOCATIONS_KEY, body: json(LOCATIONS), contentType: 'application/json' },
  ];
  for (const collection of COLLECTIONS) {
    const bucket = at(collection.bucket);
    const base = `Collections/${collection.uuid}`;
    objects.push(
      { bucket, key: `${base}/collection.json`, body: json(collection.document), contentType: 'application/json' },
      { bucket, key: `${base}/species.json`, body: json(collection.species), contentType: 'application/json' },
      { bucket, key: `${base}/locations.json`, body: json(collection.locations), contentType: 'application/json' },
      {
        bucket,
        key: `${base}/Uploads/${collection.stamp}/media.csv`,
        body: `mediaID,filePath\n${collection.media.map((n, i) => `${i + 1},${n}`).join('\n')}\n`,
        contentType: 'text/csv',
      },
      {
        bucket,
        key: `${base}/Uploads/${collection.stamp}/UploadMeta.json`,
        body: json({ schemaVersion: 1, uploadedBy: 'seed', imageCount: collection.media.length }),
        contentType: 'application/json',
      },
    );
    for (const name of collection.media) {
      objects.push({
        bucket,
        key: `${base}/Uploads/${collection.stamp}/${name}`,
        body: jpegBytes(`${collection.document.nameProperty}/${name}`),
        contentType: 'image/jpeg',
      });
    }
  }
  return objects;
}

export const namespacedBuckets = (namespace) =>
  [SETTINGS_BUCKET, BUCKET_A, BUCKET_B].map((bucket) => `${namespace}${bucket}`);
