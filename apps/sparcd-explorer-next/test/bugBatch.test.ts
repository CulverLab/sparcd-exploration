// The explorer bug batch, #399-#405, as data-layer cases.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { serializeObservations } from '@sparcd/camtrap';
import {
  ExplorerDb,
  accountKey,
  buildModel,
  hexBins,
  locationRows,
  photoRows,
  readCachedCollection,
  speciesRows,
  summarize,
  syncCollection,
} from '../src/data';
import { FakeS3, putUpload } from './support/fakeS3';
import { collection, collectionRef, deployment, fileNames, filter, media, modelOf, observation } from './support/fixtures';

const TS = '2024-01-01T10:00:00';
const grouped = { separate: false };

describe('#399 untagged images count as tagged', () => {
  it('placeholder rows and removal-only rows leave an image untagged', () => {
    const files = Array.from({ length: 5 }, (_, i) => `img${i}.jpg`);
    const model = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: files.map((f) => media('u1', f, 'AA01', TS)),
        observations: [
          observation('u1', 'img0.jpg', 'AA01', TS, { common: 'Bobcat', scientific: 'Lynx rufus' }),
          // The uploader writes one placeholder per image; the Tagger writes one with a removal.
          ...files.slice(1, 4).map((f) => observation('u1', f, 'AA01', TS)),
          observation('u1', 'img4.jpg', 'AA01', TS, { tags: '[REMOVED:Lynx rufus]' }),
        ],
      }),
    );
    const s = summarize(model, filter(model), grouped);
    expect([s.photos, s.tagged]).toEqual([5, 1]);
  });
});

describe('#400 date and species filters reduce the image count', () => {
  const model = modelOf(
    collection()
      .upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'a.jpg', 'AA01', '2023-05-01T10:00:00'), media('u1', 'b.jpg', 'AA01', '2024-05-01T10:00:00')],
        observations: [observation('u1', 'a.jpg', 'AA01', '', { common: 'Owl' })],
      })
      .upload('u2', {
        deployments: [deployment('BB01', 'Bravo', 12.9, -100.9)],
        media: [media('u2', 'c.jpg', 'BB01', '2024-06-01T10:00:00')],
      }),
  );

  it('images and locations follow every filter, untagged images included', () => {
    const count = (state: Parameters<typeof filter>[1]) => {
      const s = summarize(model, filter(model, state), grouped);
      return [s.locations, s.photos];
    };
    expect(count({})).toEqual([2, 3]);
    expect(count({ years: [2024] })).toEqual([2, 2]);
    expect(count({ dateFrom: '2024-06-01' })).toEqual([1, 1]);
    expect(count({ species: ['Owl'] })).toEqual([1, 1]);
  });
});

describe('#401 species counts agree for one selection', () => {
  it('summary, species table, hex and location row give one number', () => {
    const model = modelOf(
      collection()
        .upload('u1', {
          deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
          media: ['a', 'b', 'c'].map((n) => media('u1', `${n}.jpg`, 'AA01', TS)),
          observations: [
            observation('u1', 'a.jpg', 'AA01', TS, { common: 'Javelina', scientific: 'Pecari tajacu' }),
            observation('u1', 'b.jpg', 'AA01', TS, { common: 'Owl' }),
            observation('u1', 'c.jpg', 'AA01', TS, { common: 'Javelina', scientific: 'Pecari tajacu' }),
          ],
        })
        .upload('u2', {
          deployments: [deployment('BB01', 'Bravo', 12.9, -100.9)],
          media: [media('u2', 'd.jpg', 'BB01', TS)],
          observations: [observation('u2', 'd.jpg', 'BB01', TS, { common: 'Deer' })],
        }),
    );
    const counts = (state: Parameters<typeof filter>[1]) => {
      const result = filter(model, state);
      const n = summarize(model, result, grouped).species;
      expect(speciesRows(model, result, grouped)).toHaveLength(n);
      return { n, hexes: hexBins(model, result).map((b) => b.richness), rows: locationRows(model, result, grouped).map((r) => r.species) };
    };
    expect(counts({}).n).toBe(3);
    expect(counts({ species: ['Pecari tajacu'] })).toEqual({ n: 1, hexes: [1], rows: [1] });
    expect(counts({ area: { hexes: [model.sites[0].hex!], boxes: [] } })).toEqual({ n: 2, hexes: [2], rows: [2] });
  });
});

describe('#402 reloading shows the collection as it is now', () => {
  const ref = collectionRef('Test', 'abc');
  const rows = () => ({
    deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
    media: [media('u1', 'a.jpg', 'AA01', TS)],
    observations: [observation('u1', 'a.jpg', 'AA01', TS)],
  });

  it('picks up tags written since the last load', async () => {
    const s3 = new FakeS3();
    const folder = putUpload(s3, ref.bucket, ref.uuid, 'u1', rows());
    const source = { client: s3, db: new ExplorerDb('bug-402-tags'), account: 'server.example.org|key' };
    expect(buildModel([await syncCollection(source, ref)]).photos[0].tagged).toBe(false);
    s3.put(ref.bucket, `${folder}observations.csv`, serializeObservations([observation('u1', 'a.jpg', 'AA01', TS, { common: 'Owl' })]));
    expect(buildModel([await syncCollection(source, ref)]).photos[0].tagged).toBe(true);
  });

  it('never shows another server’s data for the same bucket names', async () => {
    const db = new ExplorerDb('bug-402-servers');
    const first = new FakeS3();
    putUpload(first, ref.bucket, ref.uuid, 'u1', rows());
    await syncCollection({ client: first, db, account: accountKey({ endpoint: 'one.example.org', accessKey: 'k' }) }, ref);
    const second = accountKey({ endpoint: 'two.example.org', accessKey: 'k' });
    expect(await readCachedCollection(db, second, ref)).toBeNull();
    const fresh = await syncCollection({ client: new FakeS3(), db, account: second }, ref);
    expect(fresh.uploads).toEqual([]);
  });

  it('names an unreadable CSV and reads it again next time', async () => {
    const s3 = new FakeS3();
    const folder = putUpload(s3, ref.bucket, ref.uuid, 'u1', rows());
    const source = { client: s3, db: new ExplorerDb('bug-402-unreadable'), account: 'server.example.org|key' };
    s3.failures.set(`${ref.bucket}/${folder}media.csv`, Object.assign(new Error('x'), { $metadata: { httpStatusCode: 500 } }));
    expect((await syncCollection(source, ref)).problems.map((p) => p.file)).toEqual(['media.csv']);
    s3.failures.clear();
    expect(buildModel([await syncCollection(source, ref)]).photos).toHaveLength(1);
  });
});

describe('#403 videos are photos too', () => {
  it('an mp4 counts and is marked for a poster tile', () => {
    const model = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'clip.mp4', 'AA01', TS, 'video/mp4'), media('u1', 'a.jpg', 'AA01', TS)],
      }),
    );
    const rows = photoRows(model, filter(model).photos);
    expect(rows.map((r) => [r.fileName, r.video])).toEqual([
      ['clip.mp4', true],
      ['a.jpg', false],
    ]);
  });
});

describe('#404 selecting one of two same-ID sites', () => {
  it('shows only that site’s images, by site key', () => {
    const model = modelOf(
      collection()
        .upload('u1', { deployments: [deployment('ZZ19', 'Ridge', 12.0, -100.0)], media: [media('u1', 'new.jpg', 'ZZ19', TS)] })
        .upload('u2', { deployments: [deployment('ZZ19', 'Ridge old', 12.6, -100.0)], media: [media('u2', 'old.jpg', 'ZZ19', TS)] }),
    );
    const ridgeOld = model.sites.find((s) => s.name === 'Ridge old')!;
    expect(fileNames(model, filter(model, { locations: [ridgeOld.key] }).photos)).toEqual(['old.jpg']);
    expect(fileNames(model, filter(model, { area: { hexes: [ridgeOld.hex!], boxes: [] } }).photos)).toEqual(['old.jpg']);
  });
});

describe('#405 hex cells stay put and never point at a site', () => {
  const model = modelOf(
    collection()
      .upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.51, -100.27)],
        media: [media('u1', 'a.jpg', 'AA01', TS)],
        observations: [observation('u1', 'a.jpg', 'AA01', TS, { common: 'Javelina' })],
      })
      .upload('u2', { deployments: [deployment('BB01', 'Bravo', 13.4, -101.2)], media: [media('u2', 'b.jpg', 'BB01', TS)] }),
  );

  it('a search does not move a site’s cell', () => {
    const everyCell = hexBins(model, filter(model)).map((b) => b.hex);
    const searched = hexBins(model, filter(model, { species: ['Javelina'] })).map((b) => b.hex);
    expect(everyCell).toContain(searched[0]);
    expect(searched[0]).toBe(model.sites[0].hex);
  });

  it('a single-site result centres on the cell, not the site', () => {
    const [bin] = hexBins(model, filter(model, { species: ['Javelina'] }));
    expect(bin.center).not.toEqual(model.sites[0].position);
    expect(bin.center).toEqual(hexBins(model, filter(model)).find((b) => b.hex === bin.hex)!.center);
  });
});
