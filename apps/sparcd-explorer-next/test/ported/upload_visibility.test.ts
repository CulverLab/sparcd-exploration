// Ported from apps/sparcd-explorer/tests/test_upload_visibility.py. The old
// loader GET-probed UploadMeta.json; the new one sees it in the folder listing,
// so an upload whose marker exists but won't read stays visible and the
// failure is named, instead of the whole upload being skipped.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ExplorerDb, buildModel, checkHiddenUploads, checkUnreadable, syncCollection } from '../../src/data';
import { FakeS3, putUpload } from '../support/fakeS3';
import { collectionRef, deployment, media } from '../support/fixtures';

describe('test_upload_visibility', () => {
  it('the loader leaves out unmarked uploads, counts them, and names an unreadable marker', async () => {
    const ref = collectionRef('Test', 'abc');
    const s3 = new FakeS3();
    const rows = (stamp: string) => ({
      deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
      media: [media(stamp, 'a.jpg', 'AA01', '2024-01-01T10:00:00')],
    });
    const published = putUpload(s3, ref.bucket, ref.uuid, 'published', rows('published'));
    const interrupted = putUpload(s3, ref.bucket, ref.uuid, 'interrupted', { ...rows('interrupted'), meta: false });
    const unreadable = putUpload(s3, ref.bucket, ref.uuid, 'unreadable', rows('unreadable'));
    s3.failures.set(`${ref.bucket}/${unreadable}UploadMeta.json`, Object.assign(new Error('reset'), { name: 'TypeError' }));

    const loaded = await syncCollection({ client: s3, db: new ExplorerDb('visibility-test'), account: 'a' }, ref);

    expect(loaded.uploads.map((u) => u.folder)).toEqual([published, unreadable]);
    expect(loaded.hiddenUploads).toEqual([interrupted]);
    expect(s3.gets.filter((g) => g.includes(interrupted))).toEqual([]);
    expect(loaded.uploads[0].deployments).toHaveLength(1);
    expect(loaded.uploads[0].media).toHaveLength(1);

    const model = buildModel([loaded]);
    expect(checkHiddenUploads(model)).toEqual([{ kind: 'hidden-uploads', collection: 0, folders: [interrupted] }]);
    expect(checkUnreadable(model).map((c) => [c.folder, c.file])).toEqual([[unreadable, 'UploadMeta.json']]);
  });
});
