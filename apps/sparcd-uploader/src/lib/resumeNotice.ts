import type { BatchRecord, PersistedFileState } from './db';

type Candidate = { batch: BatchRecord; counts: Record<PersistedFileState, number> };

/** Input is newest-first. Prefer failed files, then uploads awaiting publication. */
export function selectResumeNotice(candidates: Candidate[]) {
  const awaitingPublication = ({ batch, counts }: Candidate) => batch.totalFiles > 0 && counts.done === batch.totalFiles;
  const chosen = candidates.find(({ counts }) => counts.failed > 0)
    ?? candidates.find(awaitingPublication)
    ?? candidates[0];
  if (!chosen) return null;
  return {
    stamp: chosen.batch.uploadPrefix.slice(chosen.batch.uploadPrefix.lastIndexOf('/') + 1),
    done: chosen.counts.done,
    failed: chosen.counts.failed,
    total: chosen.batch.totalFiles,
    publicationIncomplete: awaitingPublication(chosen),
    failedUploads: candidates.filter(({ counts }) => counts.failed > 0).length,
    others: candidates.length - 1,
  };
}
