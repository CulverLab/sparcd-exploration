import { flipDb } from '@sparcd/flip';
import { db } from './db';
import { flushPreparation } from './preparation';

// Logout teardown. A SPARC'd tool is BYO-credentials and often shared on one
// machine, so logging out must leave nothing of the previous user behind:
// otherwise their resumable upload sessions (folder handles, per-file progress)
// would surface for whoever connects next. The caller pushes or discards any
// in-progress work before this runs.

/** Wipe all of this browser's local uploader data, then reload onto the connect
 *  gate. The caller has already nulled the connection (`disconnect`), so the
 *  reload rebuilds every in-memory store clean. */
export async function resetLocalState(): Promise<void> {
  // Drain older writes before erasing data so a delayed save cannot restore it.
  await flushPreparation().catch(() => {});
  await Promise.all([db.batches.clear(), db.files.clear(), db.bundles.clear(), flipDb.vocabularies.clear(), flipDb.preparations.clear()]);
  location.reload();
}
