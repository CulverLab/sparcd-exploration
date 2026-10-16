import { expect, test } from 'vitest';
import { selectResumeNotice } from '../src/lib/resumeNotice';
import type { BatchRecord, PersistedFileState } from '../src/lib/db';
function candidate(id: string, done: number, failed = 0) {
  return { batch: { id, uploadPrefix: `Collections/id/Uploads/${id}`, totalFiles: 4 } as BatchRecord,
    counts: { 'awaiting-processing': 0, pending: 4 - done - failed, uploading: 0, done, failed } as Record<PersistedFileState, number> };
}
test('empty history has no notice', () => expect(selectResumeNotice([])).toBeNull());
test('a newer paused upload cannot hide an older failure', () => {
  expect(selectResumeNotice([candidate('paused', 1), candidate('failed', 3, 1)]))
    .toMatchObject({ stamp: 'failed', failed: 1, others: 1, publicationIncomplete: false });
});
test('publication-incomplete uploads get attention even with no failed files', () => {
  expect(selectResumeNotice([candidate('paused', 1), candidate('unpublished', 4)]))
    .toMatchObject({ stamp: 'unpublished', failed: 0, publicationIncomplete: true });
});
test('failed files take priority over an unfinished publication', () => {
  expect(selectResumeNotice([candidate('unpublished', 4), candidate('failed', 2, 2)]))
    .toMatchObject({ stamp: 'failed', failed: 2 });
});
test('newest failure wins while all failed uploads are counted', () => {
  expect(selectResumeNotice([candidate('new', 2, 2), candidate('old', 3, 1)]))
    .toMatchObject({ stamp: 'new', failedUploads: 2 });
});
test('paused sessions keep newest-first order without claiming a failure', () => {
  expect(selectResumeNotice([candidate('new', 1), candidate('old', 2)]))
    .toMatchObject({ stamp: 'new', failed: 0, failedUploads: 0, publicationIncomplete: false });
});
test('zero-file batches are not described as awaiting publication', () => {
  const empty = candidate('empty', 0); empty.batch.totalFiles = 0;
  expect(selectResumeNotice([empty])).toMatchObject({ publicationIncomplete: false });
});
