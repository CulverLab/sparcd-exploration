import { S3ReadError, readErrorDetails } from '@sparcd/s3-safe';
import { db, uploadId } from './db';
import { canonicalValue, undoMatches, type AutomaticRecord, type EditAction } from './automaticModel';
import type { TagImage } from './workspace';
import type { Deployment } from '@sparcd/camtrap';

export type SavePhase = 'loading' | 'saved' | 'saving' | 'pending' | 'failed' | 'conflict' | 'recovery';
export type SaveView = { phase: SavePhase; message: string; pending: boolean; undoReason: string; canEdit: boolean; failure?: 'repair' | 'retry'; retrying?: boolean; setupFailed?: boolean; updatedAt?: number };
export type RemoteView = { images: TagImage[]; location: Deployment | null; writtenFields?: import('./automaticModel').ValueChange['field'][]; canonical?: import('./sync').CanonicalState };
export class SaveConflict extends Error {}
export type SaveServices = {
  save: (record: AutomaticRecord) => Promise<RemoteView>;
  current: () => Promise<RemoteView>;
  prepareUndo?: (action: EditAction, result: RemoteView) => Promise<EditAction>;
  validateUndo?: (action: EditAction, result: RemoteView) => boolean;
  reverse: (action: EditAction, remote: RemoteView) => Promise<{ action: EditAction; drafts?: import('./db').DraftRecord[] }>;
  resolve: (record: AutomaticRecord, remote: RemoteView, reapply: boolean) => Promise<EditAction[] | void>;
  changed: (view: SaveView) => void;
};

/** Timers control network coalescing only. Every accepted action is persisted
 * immediately, with its own durable Undo boundary, before a write can start. */
export class AutomaticSaver {
  record: AutomaticRecord;
  view: SaveView = { phase: 'loading', message: 'Opening save recovery…', pending: false, undoReason: 'Opening upload', canEdit: false };
  private version = 0;
  private readonly branchId = crypto.randomUUID();
  private writes: Promise<void> = Promise.resolve();
  private committing = false;
  private persistenceError: unknown;
  private running: Promise<boolean> | null = null;
  private idle?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private online = true;
  private disposed = false;
  private undoing = false;
  private retryDelay = 1000;
  private retrying = false;
  private checking = false;
  private awaitingRetry = false;

  constructor(record: AutomaticRecord, private services: SaveServices) { this.record = record; }
  async open(options: { checkOnly?: boolean } = {}): Promise<void> {
    const stored = await db.automatic.get(this.record.id);
    if (stored) { this.record = stored; this.version = stored.version ?? 0; }
    this.retrying = !!this.record.saveFailure;
    if (this.record.conflictReason) this.publish('conflict', `Save conflict — ${this.record.conflictReason}`);
    else if (this.record.recoveryBranches?.length) this.publish('conflict', 'Pending edits from another tab were retained. Reload and review all retained changes before continuing.');
    else if (this.record.adoptionRequired) this.publish('recovery', 'Existing pending work needs recovery confirmation for this account and destination.');
    else if (this.record.actions.length || this.record.flight) {
      this.awaitingRetry = !!options.checkOnly;
      if (this.awaitingRetry) this.publish('failed', 'Earlier changes remain unsaved. Select Retry save.');
      else { this.publish('saving', 'Saving…'); this.schedule(); }
    }
    else this.publish('saved', 'Saved');
  }
  private publish(phase: SavePhase, message: string): void {
    const pending = !!this.record.actions.length || !!this.record.flight || !!this.record.adoptionRequired || !!this.record.recoveryBranches?.length || !!this.persistenceError;
    const reason = !this.online ? 'Undo requires an online connection.' : phase !== 'saved' || pending
      ? 'Undo is unavailable while saving or recovering pending work.' : this.record.undoReason ?? (!this.record.undo ? 'No completed action to undo for this account and upload.' : '');
    this.view = { phase, message, pending, updatedAt: Date.now(), undoReason: reason, failure: phase === 'failed' ? (this.record.saveFailure === 'repair' ? 'repair' : 'retry') : undefined, retrying: this.retrying && phase === 'saving', canEdit: this.online && !this.committing && !['loading', 'pending', 'conflict', 'recovery', 'failed'].includes(phase) && !this.persistenceError && !this.undoing };
    if (!this.disposed) this.services.changed(this.view);
  }
  private persist(clearJournal = false, drafts: import('./db').DraftRecord[] = []): Promise<void> {
    const snapshot = structuredClone(this.record);
    const operation = this.writes.catch(() => {}).then(async () => {
      let stale = false;
      await db.transaction('rw', db.automatic, db.syncJournals, db.drafts, db.uploads, async () => {
        const current = await db.automatic.get(snapshot.id);
        if ((current?.version ?? 0) !== this.version) {
          if (current) {
            const known = new Set([...current.actions, ...(current.recoveryBranches ?? []).flatMap(branch => branch.actions)].map(action => action.id));
            const actions = snapshot.actions.filter(action => !known.has(action.id));
            if (actions.length) await db.automatic.put({ ...current, version: (current.version ?? 0) + 1,
              recoveryBranches: [...(current.recoveryBranches ?? []), { ...snapshot, id: this.branchId, actions, flight: undefined, recoveryBranches: undefined }] });
          }
          stale = true;
          return;
        }
        await db.automatic.put({ ...snapshot, version: this.version + 1 });
        if (drafts.length) await db.drafts.bulkPut(drafts);
        const location = snapshot.actions.flatMap(a => a.changes).filter(c => c.field === 'location').at(-1);
        if (location) await db.uploads.update(uploadId(snapshot.bucket, snapshot.uploadPrefix), { pendingLocation: location.after as Deployment | null });
        if (clearJournal) await db.syncJournals.delete(uploadId(snapshot.bucket, snapshot.uploadPrefix));
      });
      if (stale) throw new SaveConflict('Another tab changed save recovery. This tab’s pending actions were retained separately. Reload to review them.');
      this.version++;
      this.persistenceError = undefined;
    });
    this.writes = operation;
    void operation.catch(error => { this.persistenceError = error; this.publish(error instanceof SaveConflict ? 'conflict' : 'failed', error instanceof SaveConflict ? error.message : `Could not retain pending work: ${String(error)}. Keep this tab open and retry.`); });
    return operation;
  }
  accept(action: EditAction, drafts: import('./db').DraftRecord[] = []): void {
    if (!action.changes.length) return;
    action = { ...action, records: Object.fromEntries(drafts.map(d => [d.mediaPath, d])) };
    this.record = { ...this.record, actions: [...this.record.actions, action], undo: action.undoOf ? this.record.undo : action, undoReason: undefined, pendingDrafts: { ...this.record.pendingDrafts, ...Object.fromEntries(drafts.map(d => [d.mediaPath, d])) } };
    void this.persist(false, drafts);
    this.publish(this.online ? 'saving' : 'pending', this.online ? 'Saving…' : 'Pending/reconnecting — editing is paused.');
    this.schedule();
  }
  private schedule(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.flush(), 500);
    this.maximum ??= setTimeout(() => { this.maximum = undefined; void this.flush(); }, 1000);
  }
  setOnline(online: boolean): void {
    this.online = online;
    if (this.awaitingRetry) { this.publish('failed', 'Earlier changes remain unsaved. Select Retry save.'); return; }
    if (!online) this.publish('pending', 'Pending/reconnecting — editing is paused.');
    else if (this.record.conflictReason) this.publish('conflict', `Save conflict — ${this.record.conflictReason}`);
    else if (this.record.recoveryBranches?.length) this.publish('conflict', 'Pending edits from another tab were retained. Reload and review all retained changes before continuing.');
    else if (this.record.adoptionRequired) this.publish('recovery', 'Existing pending work needs recovery confirmation for this account and destination.');
    else if (this.view.phase === 'pending') { this.publish('saving', 'Reconnected — saving pending work…'); void this.flush(); }
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) throw new Error('This browser cannot protect save recovery across tabs. Use a browser with Web Locks support.');
    // The recovery journal is keyed by bucket/upload, independent of account.
    // Use that same lock boundary so another account cannot replace its journal.
    return locks.request(`sparcd-save:${uploadId(this.record.bucket, this.record.uploadPrefix)}`, operation);
  }
  private async otherPending(): Promise<boolean> {
    const rows = await db.automatic.where('[bucket+uploadPrefix]').equals([this.record.bucket, this.record.uploadPrefix]).toArray();
    return rows.some(row => row.id !== this.record.id && !!(row.actions.length || row.flight || row.adoptionRequired || row.recoveryBranches?.length));
  }
  flush(): Promise<boolean> {
    if (this.checking || this.awaitingRetry) return Promise.resolve(false);
    clearTimeout(this.idle); clearTimeout(this.maximum); this.maximum = undefined;
    if (this.running) return this.running;
    if (!this.online || this.record.conflictReason || ['conflict', 'recovery', 'loading'].includes(this.view.phase)) return Promise.resolve(false);
    const operation = this.locked(async () => {
      if (this.persistenceError) await this.persist(false, Object.values(this.record.pendingDrafts ?? {}));
      await this.writes;
      const latest = await db.automatic.get(this.record.id);
      if ((latest?.version ?? 0) !== this.version) throw new SaveConflict('Recovery changed in another tab. Reload before continuing.');
      while (this.record.actions.length || this.record.flight) {
        if (!this.online) return false;
        this.publish('saving', 'Saving…');
        if (!this.record.flight) {
          if (await this.otherPending()) throw new SaveConflict('Pending recovery for this upload belongs to another account or destination. Recover it before publishing this account’s retained changes.');
          const undoIndex = this.record.actions.findIndex(action => action.undoOf);
          const actions = undoIndex < 0 ? this.record.actions : this.record.actions.slice(0, undoIndex + 1);
          this.record = { ...this.record, flight: { ids: actions.map(a => a.id), user: actions[0].user, undoOf: actions.find(a => a.undoOf)?.undoOf } };
          await this.persist();
        }
        const flight = this.record.flight!;
        const result = await this.services.save(structuredClone(this.record));
        // Later edits may have arrived while the write or refresh was running.
        await this.writes;
        // All edits accepted during the network flight are now durable. Pause
        // new input while the acknowledgement transaction updates the local
        // journal, so a failed IndexedDB commit can restore the exact flight
        // plus its already-queued edits without racing a newer journal write.
        this.committing = true;
        this.publish('saving', 'Finishing local save…');
        const beforeAcknowledgement = structuredClone(this.record);
        let undo = this.record.undo;
        if (flight.undoOf && undo?.id === flight.undoOf) undo = null;
        else if (undo && flight.ids.includes(undo.id)) undo = { ...undo, changes: undo.changes.map(field => ({ ...field, after: result.writtenFields && !result.writtenFields.includes(field.field) ? field.after : canonicalValue(field, result.images, result.location) })) };
        if (undo && flight.ids.includes(undo.id) && this.services.prepareUndo) {
          undo = await this.services.prepareUndo(undo, result);
          if (this.record.undo?.id !== undo.id) undo = this.record.undo;
        }
        this.record = { ...this.record, actions: this.record.actions.filter(a => !flight.ids.includes(a.id)), flight: undefined, saveFailure: undefined, undo, pendingDrafts: this.record.actions.some(a => !flight.ids.includes(a.id)) ? this.record.pendingDrafts : {} };
        const reviewLegacy = this.record.reviewLegacyAfterFlight && this.record.actions.length > 0;
        const legacyReviewReason = 'The interrupted legacy write is recovered. Review the retained pending changes before reapplying or discarding them.';
        // Commit the review requirement with the flight acknowledgement, so
        // reload/reconnect cannot publish retained legacy intent implicitly.
        this.record = { ...this.record, reviewLegacyAfterFlight: false,
          ...(reviewLegacy ? { conflictReason: legacyReviewReason } : {}) };
        try {
          await this.persist(true);
        } catch (error) {
          // The remote write may have completed, but until its local receipt is
          // durable the old journal remains authoritative. Restore its flight
          // and queue so Retry resumes that exact write before later actions.
          this.record = beforeAcknowledgement;
          throw error;
        } finally {
          this.committing = false;
        }
        if (reviewLegacy) {
          this.publish('conflict', legacyReviewReason);
          return false;
        }
      }
      this.retryDelay = 1000;
      this.retrying = false;
      this.publish('saved', 'Saved');
      return true;
    }).catch(async error => {
      this.committing = false;
      if (error instanceof SaveConflict) {
        this.record = { ...this.record, conflictReason: error.message };
        if (!this.persistenceError) { try { await this.persist(); } catch { /* The original pending actions remain retained. */ } }
        this.publish(this.online ? 'conflict' : 'pending', this.online ? `Save conflict — ${error.message}` : 'Pending/reconnecting — editing is paused.');
      }
      else if (!this.online || retryableTransport(error)) {
        this.record = { ...this.record, saveFailure: 'retrying' };
        if (!this.persistenceError) { try { await this.persist(); } catch { /* Retain the original recovery record. */ } }
        if (this.persistenceError instanceof SaveConflict) { this.publish('conflict', this.persistenceError.message); return false; }
        this.publish('pending', 'Pending/reconnecting — editing is paused.');
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => { if (this.online && !this.disposed) void this.retry(); }, this.retryDelay);
        this.retryDelay = Math.min(30_000, this.retryDelay * 2);
      } else {
        this.record = { ...this.record, saveFailure: isAccessFailure(error) ? 'repair' : 'retry' };
        if (!this.persistenceError) { try { await this.persist(); } catch { /* Pending actions remain retained. */ } }
        if (this.persistenceError instanceof SaveConflict) { this.publish('conflict', this.persistenceError.message); return false; }
        this.publish('failed', `Save failed — ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }).finally(() => { if (this.running === operation) this.running = null; });
    this.running = operation;
    return operation;
  }
  retry(): Promise<boolean> {
    if (this.checking) return Promise.resolve(false);
    if (!this.online && this.awaitingRetry) { this.publish('failed', 'Earlier changes remain unsaved. Select Retry save when connected.'); return Promise.resolve(false); }
    if (!this.online) { this.publish('pending', 'Pending/reconnecting — editing is paused.'); return Promise.resolve(false); }
    if (this.record.conflictReason || this.view.phase === 'conflict' || this.record.adoptionRequired) return Promise.resolve(false);
    this.awaitingRetry = false;
    this.retrying = true;
    this.publish('saving', 'Retrying save…');
    return this.flush();
  }
  /** Reconfirm a failed read without publishing edits or consuming Undo. */
  async recheck(): Promise<boolean> {
    if (this.disposed || !this.online || this.running || this.undoing || this.checking ||
        this.view.phase !== 'failed' || this.view.pending) return false;
    this.checking = true;
    this.publish('loading', 'Checking save status…');
    try {
      return await this.locked(async () => {
        const checkRecovery = async () => {
          const current = await db.automatic.get(this.record.id);
          if ((current?.version ?? 0) !== this.version || current?.actions.length || current?.flight ||
              current?.adoptionRequired || current?.conflictReason || current?.recoveryBranches?.length || await this.otherPending())
            throw new SaveConflict('Save recovery changed. Reload to review retained work before continuing.');
        };
        await this.writes;
        await checkRecovery();
        await this.services.current();
        if (this.disposed) return false;
        if (!this.online) throw new Error('Save status could not be confirmed while offline.');
        // Accepted work in another tab need not acquire this network lock.
        // Re-read its durable version after the remote read before claiming Saved.
        await checkRecovery();
        if (this.disposed) return false;
        this.retrying = false;
        this.publish('saved', 'Saved');
        return true;
      });
    } catch (error) {
      if (!this.disposed) this.publish(error instanceof SaveConflict ? 'conflict' : 'failed', error instanceof Error ? error.message : String(error));
      return false;
    } finally { this.checking = false; }
  }
  async undo(): Promise<boolean> {
    if (this.view.undoReason || this.running || this.undoing) return false;
    this.undoing = true;
    this.publish('saving', 'Checking Undo…');
    try {
      await this.locked(async () => {
        const persisted = await db.automatic.get(this.record.id);
        if (!persisted?.undo || persisted.undo.id !== this.record.undo?.id || persisted.actions.length || persisted.flight || persisted.recoveryBranches?.length) throw new Error('Undo changed in another tab. Reload to use the current Undo record.');
        if (await this.otherPending()) throw new Error('Undo is unavailable until pending recovery for the other account or destination completes.');
        const current = await this.services.current();
        if (!undoMatches(persisted.undo, current.images, current.location) || this.services.validateUndo && !this.services.validateUndo(persisted.undo, current)) {
          this.record = { ...this.record, undoReason: 'Undo is unavailable because the affected data changed in storage.' };
          await this.persist();
          this.publish('saved', 'Saved — Undo unavailable because affected data changed.');
          return;
        }
        const reversal = await this.services.reverse(persisted.undo, current);
        this.accept(reversal.action, reversal.drafts);
        await this.writes;
      });
    } catch (error) { this.publish('failed', error instanceof Error ? error.message : String(error)); return false; }
    finally {
      this.undoing = false;
      // Recompute edit eligibility after the Undo guard is released, including
      // when changed remote data prevents a reversal from being queued.
      this.publish(this.view.phase, this.view.message);
    }
    return this.record.actions.length ? this.flush() : false;
  }
  async adopt(): Promise<void> {
    this.awaitingRetry = false;
    this.record = { ...this.record, adoptionRequired: false };
    await this.persist(false, Object.values(this.record.pendingDrafts ?? {}));
    this.publish('saving', 'Recovering existing pending work…');
    await this.flush();
  }
  async resolve(reapply: boolean): Promise<void> {
    if (!this.online || this.running) return;
    this.awaitingRetry = false;
    await this.locked(async () => {
      const stored = await db.automatic.get(this.record.id);
      if ((stored?.version ?? 0) !== this.version) throw new SaveConflict('Reload first to review the pending work retained by both tabs.');
      if (!this.record.flight && await this.otherPending()) {
        if (reapply) throw new SaveConflict('Recover the pending operation for the other account or destination before reapplying these changes.');
        // Discard only this account's accepted intent. Its shared upload journal
        // and draft mirror may belong to the other account's interrupted flight.
        this.record = { ...this.record, actions: [], undo: null, pendingDrafts: {}, recoveryBranches: undefined, undoReason: undefined, conflictReason: undefined };
        await this.persist();
        this.publish('recovery', 'Local changes for this account were discarded. Recovery for another account or destination is retained; reconnect with that account to continue.');
        return;
      }
      const actions = [...this.record.actions, ...(this.record.recoveryBranches ?? []).flatMap(branch => branch.actions)]
        .sort((a, b) => a.at.localeCompare(b.at));
      this.record = { ...this.record, actions };
      const current = await this.services.current();
      const journal = await db.syncJournals.get(uploadId(this.record.bucket, this.record.uploadPrefix));
      const resolved = await this.services.resolve(this.record, current, reapply);
      const actionsToSave = resolved ?? this.record.actions;
      const latest = actionsToSave.filter(action => !action.undoOf && action.changes.length).at(-1);
      this.record = { ...this.record, recoveryBranches: undefined, flight: undefined, conflictReason: undefined,
        saveFailure: undefined, actions: reapply ? actionsToSave.filter(action => action.changes.length) : [],
        pendingDrafts: reapply ? this.record.pendingDrafts : {},
        undo: reapply ? latest ?? this.record.undo : null,
        undoReason: reapply && latest ? undefined : this.record.undoReason,
        archivedJournals: journal ? [...(this.record.archivedJournals ?? []), journal] : this.record.archivedJournals };
      await this.persist(true);
      this.publish(reapply ? 'saving' : 'saved', reapply ? 'Saving the explicitly reapplied changes…' : 'Using current stored data.');
    }).catch(error => { this.publish('conflict', error instanceof Error ? error.message : String(error)); });
    if (reapply && this.view.phase !== 'conflict') await this.flush();
  }
  dispose(): void { this.disposed = true; clearTimeout(this.idle); clearTimeout(this.maximum); clearTimeout(this.retryTimer); }
}

/** Read translation retains the original transport error in `cause`. Keep
 * authentication/permission failures actionable instead of retrying them. */
function retryableTransport(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== 'object') return false;
  const details = error instanceof S3ReadError ? error : readErrorDetails(error);
  if (['TimeoutError', 'NetworkError', 'NetworkingError', 'RequestTimeout', 'SlowDown'].includes(details.code ?? '')) return true;
  if (details.status === 429 || details.status && details.status >= 500) return true;
  if (['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(details.code ?? '')) return false;
  const cause = error instanceof Error ? error.cause : undefined;
  return !!cause && cause !== error && retryableTransport(cause);
}

/** A validated login does not guarantee permission for every later write. */
export function isAccessFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = error instanceof S3ReadError ? error : readErrorDetails(error);
  if (details.status === 401 || details.status === 403 ||
      ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'ExpiredToken', 'InvalidToken'].includes(details.code ?? '')) return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return !!cause && cause !== error && isAccessFailure(cause);
}
