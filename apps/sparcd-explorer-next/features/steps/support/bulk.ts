// Many synthetic collections of many photos, for checking the explorer stays
// quick: the upload data only, no photo files. Their listing is refused, so
// none counts as missing. Every name, ID and position is made up.

import type { MockS3 } from './s3mock';

const SPECIES = ['Genus alpha', 'Genus beta', 'Genus gamma', 'Genus delta', 'Genus epsilon', 'Genus zeta', 'Genus eta', 'Genus theta'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const q = (v: string) => `"${v}"`;
const row = (cells: Record<number, string>, width: number) => Array.from({ length: width }, (_, i) => q(cells[i] ?? '')).join(',');

/** `collections` collections named "Bulk 00", "Bulk 01", …, each of `uploads` uploads of `perUpload` photos at a camera of its own. */
export function putBulkCollections(s3: MockS3, collections: number, uploads: number, perUpload: number): void {
  for (let c = 0; c < collections; c++) {
    const uuid = `eeeeeeee-0000-4000-8000-${pad(c, 12)}`;
    const bucket = `sparcd-${uuid}`;
    s3.put(bucket, `Collections/${uuid}/collection.json`, JSON.stringify({ nameProperty: `Bulk ${pad(c)}` }), 'application/json');
    for (let u = 0; u < uploads; u++) {
      const prefix = `Collections/${uuid}/Uploads/2024.${pad(1 + (u % 12))}.01.10.00.00_bulk${u}/`;
      const site = `B${pad(c, 3)}-${u}`;
      const dep = `${uuid}:${site}`;
      s3.put(bucket, `${prefix}UploadMeta.json`, JSON.stringify({ uploadUser: 'bulk', imageCount: perUpload }), 'application/json');
      s3.put(bucket, `${prefix}deployments.csv`, row({ 0: dep, 1: site, 2: `Site ${site}`, 3: (-100 - c * 0.05 - u * 0.01).toFixed(6), 4: (10 + c * 0.05 + u * 0.01).toFixed(6), 12: '1200' }, 23));
      const media: string[] = [];
      const observations: string[] = [];
      for (let i = 0; i < perUpload; i++) {
        const n = (c * uploads + u) * perUpload + i;
        const time = `${2013 + (n % 13)}-${pad(1 + (n % 12))}-${pad(1 + ((n >> 3) % 28))}T${pad((n >> 5) % 24)}:${pad((n >> 2) % 60)}:${pad(n % 60)}`;
        const key = `${prefix}IMG_${pad(i, 5)}.JPG`;
        media.push(row({ 0: key, 1: dep, 2: key, 4: time, 5: key, 6: `IMG_${pad(i, 5)}.JPG`, 7: 'image/jpeg', 9: 'false' }, 11));
        if (n % 3) {
          const sci = SPECIES[n % SPECIES.length];
          observations.push(row({ 0: `${n}`, 1: dep, 3: key, 4: time, 5: 'animal', 8: sci, 9: String(1 + (n % 3)), 19: `[COMMONNAME:${sci.replace('Genus ', '')}]` }, 20));
        }
      }
      s3.put(bucket, `${prefix}media.csv`, media.join('\n'));
      s3.put(bucket, `${prefix}observations.csv`, observations.join('\n'));
      s3.failures.set(`${prefix}**`, { status: 403, code: 'AccessDenied' });
    }
  }
}
