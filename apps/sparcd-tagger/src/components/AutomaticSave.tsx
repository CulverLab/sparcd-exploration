import { useEffect, useRef, useState, useId, type ReactNode } from 'react';
import { create } from 'zustand';
import { useQueryClient } from '@tanstack/react-query';
import tzlookup from 'tz-lookup';
import { Connection, useOnline, saveSharedConnection } from '@sparcd/auth-ui';
import { correctedTimestamp, parseDeployments, serializeDeployments, parseCsvRows, OBS_COL, rebaseCaptureTimestamp, type Deployment } from '@sparcd/camtrap';
import { useStore } from '../store';
import { useDraftStore, blankDraft, type UploadCtx } from '../lib/drafts';
import { db, getUpload, groundUpload, loadSyncJournal, uploadId } from '../lib/db';
import { useTagImages, useCurrentDeployment, canonicalSnapshot, rememberCanonical } from '../lib/queries';
import { loadCanonicalState, loadSnapshotBodies, parseCollectionKey } from '../lib/s3';
import { buildSyncPlan, projectSync, mergeReviewEvents } from '../lib/sync';
import { locationPatches, patchesMatch, reversePatches, applyCanonicalPatches, reapplyLocationPatches } from '../lib/canonicalPatch';
import { performSync } from '../lib/syncRunner';
import { buildTagImages } from '../lib/workspace';
import { installEditLifecycle } from '../lib/editLifecycle';
import { installSaveNavigation } from '../lib/saveNavigation';
import { accountScope, automaticId, actionChanges, canonicalValue, equalValue, rebaseDraft, type AutomaticRecord, type EditAction, type ValueChange } from '../lib/automaticModel';
import { AutomaticSaver, SaveConflict, type SaveView, type RemoteView } from '../lib/automaticSaver';
import { hasUnfinishedEditor, useEditorState } from '../lib/editorState';
import { draftRevisionOf } from '../lib/draftRevision';

const initial: SaveView = { phase: 'loading', message: 'Opening automatic saving…', pending: false, undoReason: 'Undo is unavailable while opening save recovery.', canEdit: false };
export const useAutomaticSave = create<{ view: SaveView; saver: AutomaticSaver | null; repair: boolean; repairError?: string }>(() => ({ view: initial, saver: null, repair: false }));
function retryAutomaticSave(): Promise<boolean> {
  const saver = useAutomaticSave.getState().saver;
  if (saver) return saver.retry();
  // A read failure can precede coordinator creation after reload. Refresh only
  // this connection's query generation; retain selection, identity and journals.
  useStore.setState(state => ({ connectionId: state.connectionId + 1 }));
  return Promise.resolve(false);
}


function sameLocation(a: Deployment | null | undefined, b: Deployment | null | undefined): boolean {
  return !a || !b ? a == null && b == null : serializeDeployments([a]) === serializeDeployments([b]);
}

function timeZoneFor(location: Deployment | null | undefined): string | undefined {
  return location?.latitude != null && location.longitude != null
    ? tzlookup(location.latitude, location.longitude)
    : undefined;
}

function withFields(fields: ValueChange[], current: RemoteView, ctx: UploadCtx, reverse: boolean, actor: string) {
  const drafts: ReturnType<typeof useDraftStore.getState>['drafts'] = {};
  let location: Deployment | null | undefined;
  for (const field of fields) {
    const value = reverse ? field.before : field.after;
    if (field.field === 'location') { location = value as Deployment | null; continue; }
    const image = current.images.find(i => i.key === field.path);
    if (!image) throw new SaveConflict('An affected image was removed from storage. Review the retained changes before continuing.');
    const draft = drafts[field.path] ?? blankDraft(ctx, field.path, image.deploymentId, { observations: image.baseObservations, questionable: image.baseQuestionable });
    draft.dirty = true; draft.lastEdited = new Date().toISOString();
    if (field.field === 'time') draft.timeOverride = value as string;
    if (field.field === 'timestampSource') draft.timeSourceOverride = value as import('@sparcd/camtrap').TimestampSource | null;
    if (field.field === 'expert') { draft.questionable = !!value; draft.questionableEdited = true; }
    if (field.field === 'species') {
      const old = draft.observations.find(o => o.scientificName === field.species);
      draft.observations = draft.observations.filter(o => o.scientificName !== field.species);
      if (value) {
        const restored = structuredClone(value) as typeof draft.observations[number];
        // Original attribution survives restoration; the reversal is a new
        // attributed action in UploadMeta, with prior provenance retained.
        restored.reviewEvents = (mergeReviewEvents(old?.reviewEvents, restored.reviewEvents) ?? []).map(event =>
          reverse && !(restored.reviewEvents ?? []).some(prior => prior.reviewedBy === event.reviewedBy && prior.reviewedAt === event.reviewedAt)
            ? { ...event, reversedBy: actor, reversedAt: new Date().toISOString() } : event);
        draft.observations.push(restored);
        draft.confirmedSpecies = [...new Set([...(draft.confirmedSpecies ?? []), restored.scientificName])];
      } else draft.removedSpecies = [...new Set([...(draft.removedSpecies ?? []), field.species!])];
    }
    drafts[field.path] = draft;
  }
  return { drafts, location };
}

/** Compile accepted actions in order. Network coalescing never changes their
 * target sets, actors or Undo boundaries, and later queued state cannot leak
 * into an earlier flight's canonical bodies. */
async function compileActions(actions: EditAction[], starting: import('../lib/sync').CanonicalState, ctx: UploadCtx) {
  let projected = structuredClone(starting);
  for (const action of actions) {
    const images = buildTagImages({ mediaCsv: projected.media.text, observationsCsv: projected.observations.text });
    const location = parseDeployments(projected.deployments.text)[0] ?? null;
    const zone = timeZoneFor(location);
    const fields = action.changes.filter(field => !(action.locationPatch && field.field === 'location')).map(field => {
      if (field.field === 'species' && field.after && action.records?.[field.path]) {
        return { ...field, after: action.records[field.path].observations.find(o => o.scientificName === field.species) ?? null };
      }
      if (field.field === 'time' && !action.undoOf && zone && typeof field.after === 'string') {
        return { ...field, after: rebaseCaptureTimestamp(field.after, action.timeZone, zone) };
      }
      return field;
    });
    const patch = withFields(fields, { images, location }, ctx, false, action.user);
    const plan = buildSyncPlan(images, patch.drafts, null, patch.location ?? null, action.user, zone);
    projected = await projectSync(projected, plan, action.user, new Date(action.at), ctx.uploadPrefix);
    if (action.locationPatch) for (const [role, text] of Object.entries(applyCanonicalPatches(projected, action.locationPatch))) projected[role as 'media' | 'observations' | 'deployments'].text = text;
  }
  return projected;
}

export function AutomaticSaveProvider({ children }: { children: ReactNode }) {
  const cfg = useStore(s => s.s3Config);
  const connectionId = useStore(s => s.connectionId);
  const collectionKey = useStore(s => s.selectedCollectionKey);
  const prefix = useStore(s => s.selectedUploadPrefix);
  const scope = cfg ? accountScope(cfg) : '';
  const images = useTagImages(cfg, connectionId, collectionKey, prefix);
  const deployment = useCurrentDeployment(cfg, connectionId, collectionKey, prefix);
  const online = useOnline();
  const restoredScope = useRef('');
  useEffect(() => {
    if (!scope) return;
    const key = `sparcd-tagger:active-upload:${scope}`;
    try {
      if (restoredScope.current !== scope) {
        restoredScope.current = scope;
        const remembered = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        if (!prefix && remembered?.collectionKey && remembered?.prefix) {
          useStore.setState({ selectedCollectionKey: remembered.collectionKey, selectedUploadPrefix: remembered.prefix, section: 'tag' });
          return;
        }
      }
      sessionStorage.setItem(key, JSON.stringify({ collectionKey, prefix }));
    } catch { /* Pending actions remain durable even if session navigation cannot be remembered. */ }
  }, [scope, collectionKey, prefix]);
  const client = useQueryClient();
  const live = useRef({ cfg, connectionId, collectionKey, prefix, images: images.data ?? [], location: deployment.data ?? null });
  live.current = { cfg, connectionId, collectionKey, prefix, images: images.data ?? [], location: deployment.data ?? null };
  const queriesReady = images.data !== undefined && deployment.data !== undefined;

  useEffect(() => {
    if (!cfg || !collectionKey || !prefix) { useAutomaticSave.setState({ view: { ...initial, phase: 'saved', pending: false }, saver: null }); return; }
    if (!queriesReady) {
      let cancelled = false;
      useAutomaticSave.setState({ saver: null, view: { ...initial, pending: true } });
      const removeEdits = installEditLifecycle({ canEdit: () => false, accept: () => {}, expandOffset: () => null });
      const removeNavigation = installSaveNavigation({
        pending: () => useAutomaticSave.getState().view.pending,
        flush: () => Promise.resolve(false),
        connectionAllowed: () => !useAutomaticSave.getState().view.pending,
      });
      const { bucket } = parseCollectionKey(collectionKey);
      void db.automatic.get(automaticId(scope, bucket, prefix)).then(record => {
        if (cancelled) return;
        const pending = !!record && !!(record.actions.length || record.flight || record.adoptionRequired || record.recoveryBranches?.length);
        const error = images.error || deployment.error;
        useAutomaticSave.setState({ view: { ...initial, pending, phase: error ? 'failed' : 'loading',
          message: error ? `${pending ? 'Save recovery blocked' : 'Upload data could not be read'} — ${String(error)}. Pending work is retained. Retry or repair credentials for this account.` : initial.message } });
      }).catch(error => { if (!cancelled) useAutomaticSave.setState({ view: { ...initial, phase: 'failed', pending: true, message: `Could not read local recovery: ${String(error)}. Keep this tab open and retry.` } }); });
      return () => { cancelled = true; removeEdits(); removeNavigation(); };
    }
    let cancelled = false;
    let saver: AutomaticSaver | undefined;
    let removeEdits: (() => void) | undefined;
    let removeNavigation: (() => void) | undefined;
    const { bucket } = parseCollectionKey(collectionKey);
    const ctx = { bucket, uploadPrefix: prefix };
    const id = automaticId(scope, bucket, prefix);
    useAutomaticSave.setState({ view: { ...initial, pending: true }, saver: null });
    removeNavigation = installSaveNavigation({ pending: () => true, flush: () => Promise.resolve(false), connectionAllowed: () => false });
    removeEdits = installEditLifecycle({ canEdit: () => false, accept: () => {}, expandOffset: () => null });
    const configured = () => {
      const config = useStore.getState().s3Config;
      if (!config || accountScope(config) !== scope) throw new Error('Pending work belongs to a different account or destination.');
      return config;
    };
    const fresh = async (): Promise<RemoteView> => {
      const state = await loadCanonicalState(configured(), bucket, prefix);
      return { images: buildTagImages({ mediaCsv: state.media.text, observationsCsv: state.observations.text }), location: parseDeployments(state.deployments.text)[0] ?? null, canonical: state };
    };
    const commitFields = async (fields: ValueChange[], remote: RemoteView, reverse: boolean, user: string, durable = true) => {
      const patch = withFields(fields, remote, ctx, reverse, user);
      useDraftStore.setState(s => ({ drafts: { ...s.drafts, ...patch.drafts }, ...(patch.location !== undefined ? { pendingLocation: patch.location } : {}) }));
      if (durable) await db.transaction('rw', db.drafts, db.uploads, async () => {
        await db.drafts.bulkPut(Object.values(patch.drafts));
        if (patch.location !== undefined) await db.uploads.update(uploadId(bucket, prefix), { pendingLocation: patch.location });
      });
      return patch;
    };
    void (async () => {
      await useDraftStore.getState().loadUpload(ctx);
      if (cancelled) return;
      const existing = await db.automatic.get(id);
      const others = await db.automatic.where('[bucket+uploadPrefix]').equals([bucket, prefix]).toArray();
      if (!existing?.flight && others.some(r => r.id !== id && (r.actions.length || r.flight || r.adoptionRequired || r.recoveryBranches?.length))) throw new Error('Pending recovery for this upload belongs to another account or destination. Reconnect with that account to recover it.');
      const legacyJournal = await loadSyncJournal(bucket, prefix);
      const state = useDraftStore.getState();
      if (existing?.pendingDrafts) {
        const restored = Object.fromEntries(Object.entries(existing.pendingDrafts).filter(([path]) => !state.drafts[path]));
        useDraftStore.setState(s => ({ drafts: { ...s.drafts, ...restored } }));
        await db.drafts.bulkPut(Object.values(restored));
      }
      const legacy = !existing && (Object.values(state.drafts).some(d => d.dirty) || state.timeOffset || state.pendingLocation || legacyJournal);
      const record: AutomaticRecord = existing ?? { id, scope, bucket, uploadPrefix: prefix, collectionKey, actions: [], undo: null, adoptionRequired: !!legacy };
      if (legacy) {
        let baseImages = live.current.images;
        if (legacyJournal?.snapshotPrefix && state.timeOffset) {
          const bodies = await loadSnapshotBodies(configured(), bucket, legacyJournal.snapshotPrefix);
          if (bodies.media && bodies.observations) baseImages = buildTagImages({ mediaCsv: bodies.media, observationsCsv: bodies.observations });
        }
        const before = Object.fromEntries(baseImages.map(image => [image.key, blankDraft(ctx, image.key, image.deploymentId, { observations: image.baseObservations, questionable: image.baseQuestionable })]));
        const recovered = Object.fromEntries(Object.entries(state.drafts).filter(([, draft]) => draft.dirty));
        // A legacy draft may outlive a remotely removed media row. Retain its
        // intent for explicit conflict review instead of failing hydration.
        for (const draft of Object.values(recovered)) before[draft.mediaPath] ??= blankDraft(ctx, draft.mediaPath, draft.deploymentId);
        if (state.timeOffset) for (const image of baseImages.filter(i => i.baseTimestamp)) {
          const draft = recovered[image.key] ?? before[image.key];
          recovered[image.key] = { ...draft, timeOverride: correctedTimestamp(image.baseTimestamp, state.timeOffset, draft.timeOverride,
            timeZoneFor(live.current.location)), dirty: true };
        }
        const changes = actionChanges({ ctx, before, after: recovered, ...(state.pendingLocation ? { location: { before: null, after: state.pendingLocation } } : {}) }, baseImages, live.current.location);
        record.actions = changes.length || Object.keys(recovered).length || state.timeOffset || state.pendingLocation
          ? [{ id: crypto.randomUUID(), user: legacyJournal?.user || useStore.getState().taggerUser, at: new Date().toISOString(), changes, records: recovered }] : [];
        record.pendingDrafts = recovered;
        record.undoReason = 'Recovered legacy work has no reliable pre-action Undo record.';
        record.flight = legacyJournal ? { ids: [], user: legacyJournal.user } : undefined;
        record.reviewLegacyAfterFlight = !!legacyJournal && !legacyJournal.receipt;
        useDraftStore.setState(s => ({ drafts: { ...s.drafts, ...recovered } }));
      }
      saver = new AutomaticSaver(record, {
        changed: view => { if (!cancelled) useAutomaticSave.setState({ view, saver: saver! }); },
        current: fresh,
        save: async record => {
          await useDraftStore.getState().flushSaves();
          const starting = await loadCanonicalState(configured(), bucket, prefix);
          const flightActions = record.actions.filter(action => record.flight!.ids.includes(action.id));
          const submitted = Object.assign({}, ...flightActions.map(action => action.records ?? {})) as ReturnType<typeof useDraftStore.getState>['drafts'];
          // A partial write's journal already contains the exact intended
          // bodies. Recompiling against those partly written files can reject
          // a location reversal before the journal has a chance to resume.
          const journalToResume = await loadSyncJournal(bucket, prefix);
          const compiled = flightActions.length && !journalToResume ? await compileActions(flightActions, starting, ctx) : undefined;
          const uploadBefore = await getUpload(bucket, prefix);
          const memoryOffset = useDraftStore.getState().timeOffset;
          const result = await performSync({ cfg: configured(), bucket, uploadPrefix: prefix, user: record.flight!.user,
            images: live.current.images, drafts: submitted, dryRun: false, automatic: true,
            timeZone: timeZoneFor(live.current.location),
            canonicalBodies: compiled ? Object.fromEntries(Object.entries(compiled).map(([role, value]) => [role, value.text])) : undefined,
            submittedRevisions: flightActions.length ? Object.fromEntries(Object.entries(submitted).map(([path, draft]) => [path, draftRevisionOf(draft)])) : undefined,
            auditEvents: record.actions.filter(a => record.flight!.ids.includes(a.id)).map(({ id, user, at, undoOf, changes }) => ({ id, user, at, undoOf, changes })) });
          if (result.status === 'conflict') throw new SaveConflict(`${result.role}: ${result.reason}. Review current stored data before choosing how to proceed.`);
          if (result.status === 'unsupported') throw new Error('This destination does not enforce safe conditional replacement (IfMatch). Pending work is retained.');
          if (!['synced', 'noop'].includes(result.status)) throw new Error('This upload could not be saved automatically.');
          const journal = await loadSyncJournal(bucket, prefix);
          const written = (role: string) => journal?.objects.find(o => o.role === role)?.body;
          const expectedCanonical = structuredClone(starting);
          for (const object of journal?.objects ?? []) expectedCanonical[object.role] = { text: object.body, etag: object.newETag ?? '', hash: object.intendedHash };
          const expected = { images: buildTagImages({ mediaCsv: expectedCanonical.media.text, observationsCsv: expectedCanonical.observations.text }), location: parseDeployments(expectedCanonical.deployments.text)[0] ?? null, canonical: expectedCanonical,
            writtenFields: (['species', 'time', 'expert', 'location', 'timestampSource'] as const).filter(field => !!written(field === 'species' ? 'observations' : field === 'location' ? 'deployments' : 'media')) };
          const state = await loadCanonicalState(configured(), bucket, prefix);
          const current = { images: buildTagImages({ mediaCsv: state.media.text, observationsCsv: state.observations.text }), location: parseDeployments(state.deployments.text)[0] ?? null };
          client.setQueryData(['tagImages', live.current.connectionId, collectionKey, prefix], current.images);
          client.setQueryData(['currentDeployment', live.current.connectionId, collectionKey, prefix], current.location);
          live.current.images = current.images; live.current.location = current.location;
          rememberCanonical(live.current.connectionId, collectionKey, prefix, state);
          if (result.status === 'synced') await useDraftStore.getState().markUploadSynced(ctx, result.receipt);
          const rebased: typeof submitted = {};
          const laterPaths = new Set(saver!.record.actions.filter(a => !record.flight!.ids.includes(a.id)).flatMap(a => a.changes.map(field => field.path)));
          for (const [path, draft] of Object.entries(useDraftStore.getState().drafts)) {
            const image = current.images.find(i => i.key === path);
            if (submitted[path] && image) {
              rebased[path] = laterPaths.has(path) ? rebaseDraft(draft, submitted[path], image)
                : { ...blankDraft(ctx, path, image.deploymentId, { observations: image.baseObservations, questionable: image.baseQuestionable }), lastEdited: draft.lastEdited };
            }
          }
          useDraftStore.setState(s => ({ drafts: { ...s.drafts, ...rebased },
            ...(sameLocation(s.pendingLocation, current.location) ? { pendingLocation: null } : {}),
            ...(s.timeOffset === memoryOffset ? { timeOffset: null } : {}) }));
          await db.transaction('rw', db.drafts, db.uploads, async () => {
            for (const draft of Object.values(rebased)) {
              const memory = useDraftStore.getState().drafts[draft.mediaPath];
              if (memory === draft) await db.drafts.put(draft);
            }
            const latest = await db.uploads.get(uploadId(bucket, prefix));
            if (latest) await db.uploads.update(latest.id, {
              ...(sameLocation(latest.pendingLocation, current.location) ? { pendingLocation: null } : {}),
              ...(equalValue(latest.timeOffset, uploadBefore?.timeOffset) ? { timeOffset: null } : {}),
            });
          });
          await groundUpload(bucket, prefix, state);
          void client.invalidateQueries({ queryKey: ['uploadDraftStates'] });
          return expected;
        },
        prepareUndo: async (action, result) => {
          if (!action.locationBefore || !result.canonical) return action;
          const before = action.locationBefore;
          const baseImages = buildTagImages({ mediaCsv: before.canonical.media.text, observationsCsv: before.canonical.observations.text });
          const plan = buildSyncPlan(baseImages, before.drafts, before.offset, before.location, action.user);
          const projected = await projectSync(before.canonical, plan, action.user, new Date(action.at), prefix);
          return { ...action, locationBefore: undefined, locationPatch: locationPatches(projected, result.canonical) };
        },
        validateUndo: (action, current) => !action.locationPatch || !!current.canonical && patchesMatch(action.locationPatch, current.canonical),
        reverse: async (action, current) => {
          if (!useStore.getState().taggerUser.trim()) throw new Error('Set the Tagger identity before Undo.');
          // Eligibility was checked against this exact read. Preserve unrelated
          // remote changes and condition the reversal on its versions, so a
          // subsequent racing change still produces a conflict.
          if (!current.canonical) throw new Error('Stored versions could not be checked for Undo.');
          await groundUpload(bucket, prefix, current.canonical);
          const patch = await commitFields(action.locationPatch ? action.changes.filter(c => c.field !== 'location') : action.changes, current, true, useStore.getState().taggerUser, false);
          return { drafts: Object.values(patch.drafts), action: { id: crypto.randomUUID(), user: useStore.getState().taggerUser, at: new Date().toISOString(), changes: action.changes.map(f => ({ ...f, before: f.after, after: f.before })), timeZone: timeZoneFor(live.current.location), undoOf: action.id, locationPatch: action.locationPatch ? reversePatches(action.locationPatch) : undefined } };
        },
        resolve: async (record, current, reapply) => {
          if (!current.canonical) throw new Error('Current storage could not be loaded for conflict review.');
          const resolved: EditAction[] = [];
          let projected = current.canonical;
          for (const original of reapply ? record.actions : []) {
            const beforeImages = buildTagImages({ mediaCsv: projected.media.text, observationsCsv: projected.observations.text });
            const beforeLocation = parseDeployments(projected.deployments.text)[0] ?? null;
            let action: EditAction = { ...original, changes: original.changes.map(field => ({ ...field, before: canonicalValue(field, beforeImages, beforeLocation) })).filter(field => !equalValue(field.before, field.after)) };
            if (original.locationBefore && !original.undoOf) {
              const before = original.locationBefore;
              const oldImages = buildTagImages({ mediaCsv: before.canonical.media.text, observationsCsv: before.canonical.observations.text });
              const originalBefore = await projectSync(before.canonical, buildSyncPlan(oldImages, before.drafts, before.offset, before.location, original.user), original.user, new Date(original.at), prefix);
              const originalAfter = await compileActions([{ ...original, changes: original.changes.filter(f => f.field === 'location') }], originalBefore, ctx);
              action = { ...action, locationBefore: undefined, locationPatch: reapplyLocationPatches(locationPatches(originalBefore, originalAfter), projected) };
            }
            projected = await compileActions([action], projected, ctx);
            resolved.push(action);
          }
          await useDraftStore.getState().discardUpload(ctx);
          useDraftStore.setState({ pendingLocation: null, timeOffset: null });
          await db.uploads.update(uploadId(bucket, prefix), { pendingLocation: null, timeOffset: null });
          await groundUpload(bucket, prefix, current.canonical);
          client.setQueryData(['tagImages', live.current.connectionId, collectionKey, prefix], current.images);
          client.setQueryData(['currentDeployment', live.current.connectionId, collectionKey, prefix], current.location);
          live.current.images = current.images; live.current.location = current.location;
          rememberCanonical(live.current.connectionId, collectionKey, prefix, current.canonical);
          if (reapply) await commitFields(resolved.flatMap(a => a.changes), current, false, useStore.getState().taggerUser);
          return resolved;
        },
      });
      useAutomaticSave.setState({ saver });
      await saver.open();
      if (cancelled) { saver.dispose(); return; }
      saver.setOnline(navigator.onLine);
      removeEdits = installEditLifecycle({
        canEdit: () => !!saver?.view.canEdit,
        accept: change => {
          if (!saver) return;
          const changes = actionChanges(change, live.current.images, live.current.location);
          const originalRows = parseCsvRows(canonicalSnapshot(live.current.connectionId, collectionKey, prefix)?.observations.text ?? '');
          for (const field of changes) {
            if (field.field === 'species' && field.before && typeof field.before === 'object' && 'scientificName' in field.before) {
              const row = originalRows.find(row => row[OBS_COL.mediaId] === field.path && row[OBS_COL.scientificName] === field.species);
              if (row) field.before = { ...field.before, restorationRow: row };
            }
          }
          const locationBefore = change.location ? { canonical: canonicalSnapshot(live.current.connectionId, collectionKey, prefix)!, drafts: structuredClone(useDraftStore.getState().drafts), location: change.location.before, offset: useDraftStore.getState().timeOffset } : undefined;
          saver.accept({ id: crypto.randomUUID(), at: new Date().toISOString(), user: useStore.getState().taggerUser, changes, locationBefore, timeZone: timeZoneFor(live.current.location) }, Object.values(change.after));
        },
        normalizeLocation: location => location ?? live.current.location,
        expandOffset: (_ctx, offset) => live.current.images.filter(i => i.baseTimestamp).map(i => ({ mediaPath: i.key, deploymentId: i.deploymentId,
          base: { observations: i.baseObservations, questionable: i.baseQuestionable },
          currentCorrected: correctedTimestamp(i.baseTimestamp, offset, null, timeZoneFor(live.current.location)) })),
      });
      removeNavigation = installSaveNavigation({ pending: () => !!saver?.view.pending,
        flush: () => saver!.flush(),
        connectionAllowed: () => !saver?.view.pending,
      });
    })().catch(error => {
      if (!cancelled) {
        // The provisional opening guard only protects setup while ownership
        // is being checked. If this account cannot open another owner's
        // recovery, preserve that record and let the user switch back to its
        // owner instead of trapping them behind the failed open.
        removeNavigation?.();
        removeNavigation = undefined;
        useAutomaticSave.setState({ view: { ...initial, phase: 'recovery', message: String(error), pending: false } });
      }
    });
    return () => { cancelled = true; removeEdits?.(); removeNavigation?.(); saver?.dispose(); };
  // Query data updates must not replace a coordinator with an in-flight write.
  }, [scope, collectionKey, prefix, queriesReady, queriesReady ? false : images.isError, queriesReady ? false : deployment.isError, client]);

  useEffect(() => { useAutomaticSave.getState().saver?.setOnline(online); }, [online]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => { if (useAutomaticSave.getState().view.pending || hasUnfinishedEditor()) { event.preventDefault(); event.returnValue = ''; } };
    const onLink = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || !useAutomaticSave.getState().view.pending || anchor.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = anchor.href;
      if (href.startsWith(`${location.origin}${location.pathname}#`)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void useAutomaticSave.getState().saver?.flush().then(saved => { if (saved) location.assign(href); });
    };
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      const editor = element?.closest('input,textarea,[contenteditable="true"]');
      const saver = useAutomaticSave.getState().saver;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault(); event.stopImmediatePropagation();
        const textEditor = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'hidden', 'image'].includes(editor.type);
        if (textEditor) {
          if (!editor.reportValidity()) return;
          editor.blur();
        } else if (editor instanceof HTMLElement && editor.isContentEditable) editor.blur();
        void Promise.resolve().then(() => {
          if (hasUnfinishedEditor()) return false;
          const phase = useAutomaticSave.getState().view.phase;
          return ['failed', 'pending'].includes(phase) ? retryAutomaticSave() : saver?.flush();
        });
      } else if (event.key.toLowerCase() === 'z' && !event.shiftKey && !editor) {
        event.preventDefault(); event.stopImmediatePropagation(); if (useStore.getState().taggerUser.trim() && !hasUnfinishedEditor()) void saver?.undo();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onLink, true);
    return () => { window.removeEventListener('beforeunload', onUnload); document.removeEventListener('keydown', onKey, true); document.removeEventListener('click', onLink, true); };
  }, []);
  return <>{children}</>;
}

export function AutomaticSaveStatus() {
  const { view, saver, repair, repairError } = useAutomaticSave();
  const unfinished = useEditorState(s => Object.keys(s.unfinished).length > 0);
  const cfg = useStore(s => s.s3Config);
  const actor = useStore(s => s.taggerUser);
  if (!useStore(s => s.selectedUploadPrefix)) return null;
  return <div className="border-b border-rule px-4 py-2 text-[13px] flex flex-wrap items-center gap-3" data-testid="automatic-save">
    <span role="status" aria-live="polite" aria-atomic="true">{unfinished && view.phase === 'saved' ? 'Uncommitted input — finish editing to save.' : view.message}</span>
    <button type="button" onClick={() => void saver?.undo()} disabled={!!view.undoReason || unfinished || !actor.trim()} aria-describedby="automatic-undo-help" className="min-h-11 underline disabled:opacity-50">Undo latest action</button>
    <span id="automatic-undo-help">{!actor.trim() ? 'Set the Tagger identity before Undo.' : unfinished ? 'Finish the active input before Undo.' : view.undoReason}</span>
    {['failed', 'pending'].includes(view.phase) && <>
      <button type="button" onClick={() => void retryAutomaticSave()} className="min-h-11 underline">Retry save</button>
      <button type="button" onClick={() => useAutomaticSave.setState({ repair: !repair })} className="min-h-11 underline">Repair credentials for this account</button>
      {view.phase === 'failed' && <button type="button" onClick={() => void saver?.resolve(false)} className="min-h-11 underline">Discard local changes and use current storage</button>}
    </>}
    {view.phase === 'recovery' && saver?.record.adoptionRequired && <button type="button" onClick={() => void saver.adopt()} className="min-h-11 underline">Recover pending work for this account and upload</button>}
    {view.phase === 'conflict' && <div role="region" aria-label="Review save conflict" className="w-full space-x-3">
      <p>Your pending changes are retained. Review the latest stored data before choosing. Stored data can include part of an interrupted save.</p>
      <details><summary>Compare local changes with storage</summary><ConflictReview /></details>
      <button type="button" onClick={() => location.reload()} className="min-h-11 underline">Reload retained recovery</button>
      <button type="button" onClick={() => void saver?.resolve(false)} className="min-h-11 underline">Discard local changes and use current storage</button>
      <button type="button" onClick={() => void saver?.resolve(true)} className="min-h-11 underline">Reapply my affected values to current storage</button>
    </div>}
    {repair && cfg && <div role="region" aria-label="Repair credentials" className="w-full">
      <p>Use the same account and destination. Pending changes keep their original attribution.</p>
      <Connection embedded toolName="Tagger" initialConfig={{ ...cfg, secretKey: '' }} onConnect={(next, remember) => {
        if (accountScope(next) !== accountScope(cfg)) { useAutomaticSave.setState({ repairError: 'Use the same connected account and destination to recover these pending saves.' }); return; }
        // Preserve the active upload and queue while replacing only credentials.
        useStore.setState(state => ({ s3Config: next, ...(!saver ? { connectionId: state.connectionId + 1 } : {}) }));
        saveSharedConnection(next, remember);
        useAutomaticSave.setState({ repair: false, repairError: undefined }); void saver?.retry();
      }} />
      {repairError && <p role="alert">{repairError}</p>}
    </div>}
  </div>;
}
function valueLabel(value: ValueChange['after']): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'Needs expert' : 'Does not need expert';
  if (typeof value === 'string') return value;
  if ('scientificName' in value) return `${value.commonName || value.scientificName} × ${value.count}${value.reviewEvents?.some(event => !event.reversedAt) ? ' · reviewed' : ''}`;
  return `${value.locationName} (${value.locationId}) · ${value.latitude}, ${value.longitude}`;
}
function ConflictReview() {
  const saver = useAutomaticSave(s => s.saver);
  const [rows, setRows] = useState<{ key: string; name: string; desired: string; current: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const cfg = useStore.getState().s3Config;
    if (cfg && saver) void loadCanonicalState(cfg, saver.record.bucket, saver.record.uploadPrefix).then(state => {
      const images = buildTagImages({ mediaCsv: state.media.text, observationsCsv: state.observations.text });
      const location = parseDeployments(state.deployments.text)[0] ?? null;
      const actions = [...saver.record.actions, ...(saver.record.recoveryBranches ?? []).flatMap(branch => branch.actions)];
      if (live) setRows(actions.flatMap(action => action.changes.map((field, index) => ({ key: `${action.id}:${index}`,
        name: `${field.path.split('/').pop() || 'Upload'} · ${field.species || field.field} · ${action.user}`,
        desired: valueLabel(field.after), current: images.some(i => i.key === field.path) || field.field === 'location' ? valueLabel(canonicalValue(field, images, location)) : 'Image removed from storage',
      }))));
    }).catch(error => { if (live) setError(String(error)); });
    return () => { live = false; };
  }, [saver]);
  return <div className="space-y-2 max-h-64 overflow-auto">
    {error && <p role="alert">{error}</p>}
    {!rows.length && !error && <p>Loading current stored data…</p>}
    {rows.map(row => <div key={row.key} className="border p-2"><p>{row.name}</p><p>Retained change: {row.desired}</p><p>Currently stored: {row.current}</p></div>)}
  </div>;
}

export function FocusSaveControls({ onReview }: { onReview: () => void }) {
  const { saver, view } = useAutomaticSave();
  const actor = useStore(s => s.taggerUser);
  const id = useId();
  const unfinished = useEditorState(s => Object.keys(s.unfinished).length > 0);
  const reason = !actor.trim() ? 'Set the Tagger identity before Undo.' : unfinished ? 'Finish the active input before Undo.' : view.undoReason;
  return <div className="flex items-center gap-1 text-[12px] min-w-0">
    <span role="status" aria-live="polite" className="max-w-24 truncate" title={view.message}>{unfinished && view.phase === 'saved' ? 'Uncommitted input — finish editing to save.' : view.message}</span>
    <button type="button" disabled={!!reason} aria-describedby={id} title={reason || 'Undo the latest completed action'} aria-label="Undo latest action" className="min-h-11 min-w-11 underline disabled:opacity-40" onClick={() => void saver?.undo()}>Undo</button>
    <span id={id} className="sr-only">{reason}</span>
    {['failed', 'conflict', 'pending', 'recovery'].includes(view.phase) && <button type="button" aria-label="Review save problem" className="min-h-11 min-w-11 underline" onClick={onReview}>!</button>}
  </div>;
}
