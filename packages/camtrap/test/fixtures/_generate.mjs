// Fixture generator for the shared v016 Camtrap contract tests.
//
// Run with `node packages/camtrap/test/fixtures/_generate.mjs` to (re)materialize
// the golden files. It deliberately does NOT import @sparcd/camtrap's merge
// logic: the canonical inputs and the expected tagger output are both built
// from explicit, hand-specified rows here, so the merge tests that compare
// `mergeObservations(...)` against `tagger-edited-v016/observations.csv` are a
// real check, not a tautology. Only the CSV/JSON *byte shape* (QUOTE_ALL, LF,
// 2-space JSON) is shared, copied below to match the package writer exactly.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const row = (fields) => fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',') + '\n';
const csv = (rows) => rows.map(row).join('');
const json = (obj) => JSON.stringify(obj, null, 2);

// --- Scenario --------------------------------------------------------------

const UUID = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
const BUCKET = `sparcd-${UUID}`;
const PREFIX = `Collections/${UUID}/Uploads/2024.01.15.10.00.00`;
const DEP = `${UUID}:SAN15`;
const key = (name) => `${PREFIX}/${name}`;

const IMG = {
  one: key('IMG001.JPG'),
  two: key('IMG002.JPG'),
  three: key('IMG003.JPG'),
  four: key('IMG004.JPG'),
  five: key('IMG005.JPG'),
};

// deployments.csv — 23-col v016 shape (longitude before latitude).
const deployments = csv([
  [DEP, 'SAN15', 'San Pedro 15', '-110.200000', '31.500000', '0', '', '', '', '', '', '0',
   '1200.000000', '0.000000', '0', 'false', '', '', '', '', '', '', ''],
]);

// media.csv — 11-col. col0/2/5 repeat the full key; col4 is the EXIF timestamp.
const mediaRow = (k, name, ts) => [k, DEP, k, '', ts, k, name, 'image/jpeg', '', 'false', ''];
const mediaBase = [
  mediaRow(IMG.one, 'IMG001.JPG', '2024-01-10T08:00:00'),
  mediaRow(IMG.two, 'IMG002.JPG', '2024-01-10T08:00:30'),
  mediaRow(IMG.three, 'IMG003.JPG', '2024-01-10T22:15:00'),
  mediaRow(IMG.four, 'IMG004.JPG', '2024-01-11T06:00:00'),
  mediaRow(IMG.five, 'IMG005.JPG', '2024-01-11T06:00:30'),
];

// observations.csv — 20-col. Helper fills the columns the tagger writer leaves
// at defaults; pass overrides for the populated ones.
const obs = (o) => {
  const r = new Array(20).fill('');
  r[0] = o.id;
  r[1] = DEP;
  r[3] = o.mediaId;
  r[4] = o.ts;
  r[6] = 'false'; // camera_setup
  r[8] = o.sci;
  r[9] = String(o.count);
  r[10] = '0'; // count_new
  r[19] = o.comments ?? '';
  // Optional unrelated columns (used by the survivor row to prove preservation).
  if (o.extra) for (const [i, v] of Object.entries(o.extra)) r[Number(i)] = v;
  return r;
};

// IMG004 carries rich, otherwise-unmodelled columns; it is never edited, so a
// correct merge must reproduce it byte-for-byte.
const survivor = obs({
  id: 'obs-img4-0', mediaId: IMG.four, ts: '2024-01-11T06:00:00',
  sci: 'Puma concolor', count: 1, comments: '[COMMONNAME:Mountain Lion]',
  extra: { 5: 'animal', 7: 'ITIS:552479', 11: 'Adult', 12: 'Unknown', 13: 'Walking',
           14: 'ind-7', 15: 'human', 16: 'jdoe', 17: '2024-01-12T09:00:00', 18: '0.95' },
});

const canonicalObs = [
  obs({ id: 'obs-img1-0', mediaId: IMG.one, ts: '2024-01-10T08:00:00',
        sci: 'Odocoileus hemionus', count: 2, comments: '[COMMONNAME:Mule Deer]' }),
  obs({ id: 'obs-img3-0', mediaId: IMG.three, ts: '2024-01-10T22:15:00',
        sci: 'Casper', count: 1, comments: '[COMMONNAME:Ghost]' }),
  survivor,
];

const uploadDate = {
  date: { year: 2024, month: 1, day: 15 },
  time: { hour: 10, minute: 0, second: 0, nano: 0 },
};
const uploadMeta = (imagesWithSpecies, editComments) => ({
  uploadUser: 'priortagger',
  uploadDate,
  imagesWithSpecies,
  imageCount: 5,
  editComments,
  bucket: BUCKET,
  uploadPath: PREFIX,
  description: 'Educational Test — burst sample',
});

const species = [
  { name: 'Mule Deer', scientificName: 'Odocoileus hemionus',
    speciesIconURL: 'https://example.org/muledeer.jpg', keyBinding: 'D' },
  { name: 'Coyote', scientificName: 'Canis latrans',
    speciesIconURL: 'https://example.org/coyote.jpg', keyBinding: null },
  { name: 'Mountain Lion', scientificName: 'Puma concolor',
    speciesIconURL: 'https://example.org/puma.jpg', keyBinding: 'P' },
  { name: 'Ghost', scientificName: 'Casper',
    speciesIconURL: '', keyBinding: 'G' },
];

// --- java-v016 (compatibility baseline) ------------------------------------

const javaDir = join(here, 'java-v016');
writeFileSync(join(javaDir, 'deployments.csv'), deployments);
writeFileSync(join(javaDir, 'media.csv'), csv(mediaBase));
writeFileSync(join(javaDir, 'observations.csv'), csv(canonicalObs));
writeFileSync(join(javaDir, 'UploadMeta.json'),
  json(uploadMeta(3, ['Uploaded by priortagger on 2024.01.15.10.00.00'])));
// Drifted tally — the stored value disagrees with a clean recompute (would be
// 3). Normal sync trusts the stored value; this fixture pins that choice.
writeFileSync(join(javaDir, 'UploadMeta.drifted.json'),
  json(uploadMeta(99, ['Uploaded by priortagger on 2024.01.15.10.00.00'])));
writeFileSync(join(javaDir, 'species.json'), json(species));

// --- sparcd-web-v016 (same shape; baseline is java when they differ) -------

const webDir = join(here, 'sparcd-web-v016');
writeFileSync(join(webDir, 'deployments.csv'), deployments);
writeFileSync(join(webDir, 'media.csv'), csv(mediaBase));
writeFileSync(join(webDir, 'observations.csv'), csv(canonicalObs));
writeFileSync(join(webDir, 'UploadMeta.json'),
  json(uploadMeta(3, ['Uploaded by priortagger on 2024.01.15.10.00.00'])));

// --- uploader-empty-v016 (fresh upload: no species identified yet) ---------
//
// "empty" refers to the species columns, not the file: the uploader writes one
// observation row per media file at upload time (observation_id = filename,
// matching sparcd-web's `create_observation_data`), with scientific_name/count/
// count_new left blank since nothing has been identified. media.csv carries the
// per-image capture timestamp in col 4 (also used as the observation row's
// timestamp): the uploader is the writer-of-record for capture time and stamps
// the DST-corrected full-ISO UTC instant at upload.

const placeholderObs = (k, name, ts) => {
  const r = new Array(20).fill('');
  r[0] = name; // observation_id = filename
  r[1] = DEP;
  r[3] = k;
  r[4] = ts;
  r[6] = 'false'; // camera_setup
  // 8 scientific_name, 9 count, 10 count_new intentionally left blank.
  return r;
};

const upDir = join(here, 'uploader-empty-v016');
writeFileSync(join(upDir, 'deployments.csv'), deployments);
writeFileSync(join(upDir, 'media.csv'), csv(mediaBase));
writeFileSync(join(upDir, 'observations.csv'), csv(mediaBase.map((r) =>
  placeholderObs(r[0], r[6], r[4]),
)));
writeFileSync(join(upDir, 'UploadMeta.json'), json(uploadMeta(0, [])));

// --- tagger-edited-v016 (expected output, built by hand) -------------------
//
// Edits applied to the java baseline:
//   IMG001  retag  Mule Deer -> Coyote x1                 (present -> present)
//   IMG002  add    Mule Deer x1 + requested "Jaguarundi"  (empty   -> present)  +retag
//   IMG003  detag  remove Ghost                           (present -> empty)    +detag
//   IMG005  add    Ghost x1, time corrected +1h           (empty   -> present)  +retag
// imagesWithSpecies: 3 - 1 + 2 = 4. user=jgonzalez stamp=2024.01.20.14.30.00.
//
// Observation ids use the package default scheme `${mediaId}:${index}`. Output
// order: walk canonical rows (IMG001 slot -> Coyote; IMG003 slot -> nothing;
// IMG004 survivor kept), then append new-only edited media in edit order
// (IMG002 rows, then IMG005).

const editDir = join(here, 'tagger-edited-v016');

const mediaEdited = mediaBase.map((r) => {
  if (r[0] === IMG.five) { const c = r.slice(); c[4] = '2024-01-11T07:00:30'; return c; }
  return r;
});
writeFileSync(join(editDir, 'media.csv'), csv(mediaEdited));

const editedObs = [
  obs({ id: `${IMG.one}:0`, mediaId: IMG.one, ts: '2024-01-10T08:00:00',
        sci: 'Canis latrans', count: 1, comments: '[COMMONNAME:Coyote]' }),
  survivor,
  obs({ id: `${IMG.two}:0`, mediaId: IMG.two, ts: '2024-01-10T08:00:30',
        sci: 'Odocoileus hemionus', count: 1, comments: '[COMMONNAME:Mule Deer]' }),
  obs({ id: `${IMG.two}:1`, mediaId: IMG.two, ts: '2024-01-10T08:00:30',
        sci: 'Jaguarundi', count: 1, comments: '[REQUESTED_SPECIES:Jaguarundi]' }),
  obs({ id: `${IMG.five}:0`, mediaId: IMG.five, ts: '2024-01-11T07:00:30',
        sci: 'Casper', count: 1, comments: '[COMMONNAME:Ghost]' }),
];
writeFileSync(join(editDir, 'observations.csv'), csv(editedObs));
writeFileSync(join(editDir, 'UploadMeta.json'),
  json(uploadMeta(4, [
    'Uploaded by priortagger on 2024.01.15.10.00.00',
    'Edited by jgonzalez on 2024.01.20.14.30.00',
  ])));

console.log('fixtures written');
