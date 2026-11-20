import { readBoundPreparationSpecies, acceptPreparationSpecies } from '../lib/preparation';
import { returningFlipOwnerScope } from '../lib/flip';
import { useEffect, useRef, useState } from 'react';
import { useOnline, useKeyBindings, activeKeyProfile } from '@sparcd/auth-ui';
import { bindPreparedSpecies, deriveFlipOwnerScope, loadPreparedSpecies, readFlipRecord, savePreparedSpecies, validPreparedSpecies, type PreparedSpecies } from '@sparcd/flip';
import type { SpeciesResult } from '@sparcd/s3-safe';
import { useStore } from '../store';
import { useCollections } from '../lib/useCollections';
import { fetchPreparation, snapshotPreparation, stagePreparation } from '../lib/preparedSpecies';
import { CollectionPicker } from './CollectionPicker';

/** Preparation deliberately never changes Assign's selected collection/location. */
export function PreparedSpeciesPanel({ onReady }: { onReady: (ready: boolean) => void }) {
  const cfg = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const batchToken = useStore(s => s.batchToken);
  const hasFiles = useStore(s => s.files.length > 0);
  const flipId = useStore((s) => s.flipId);
  const online = useOnline();
  const collections = useCollections(cfg, connectionId);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PreparedSpecies | null>(null);
  const [result, setResult] = useState<SpeciesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const bindings = useKeyBindings();
  const source = result ? `${result.sourceBucket}/${result.sourceKey}` : '';
  const pending = source ? activeKeyProfile(bindings).speciesSources?.[source]?.pendingSpeciesChange : undefined;
  const collection = collections.data?.find((item) => item.key === selected);

  useEffect(() => {
    const attempt = ++generation.current;
    setSelected(null); setResult(null); setSnapshot(null); setError(''); setBusy(false);
    onReady(false);
    void (async () => {
      // A connected login takes precedence; offline return uses the same
      // verified scope as file recovery and reopening Tagger.
      const ownerScope = cfg ? await deriveFlipOwnerScope(cfg) : returningFlipOwnerScope();
      const saved = flipId
        ? ownerScope ? (await readFlipRecord(flipId, ownerScope))?.preparedSpecies : null
        : useStore.getState().files.length ? await readBoundPreparationSpecies() : await loadPreparedSpecies(cfg ?? undefined);
      if (generation.current !== attempt) return;
      if (validPreparedSpecies(saved)) { setSnapshot(saved); acceptPreparationSpecies(saved); onReady(true); }
    })().catch(() => {
      if (generation.current === attempt) setError('Could not read prepared species. Prepare again online; your inspected files are unchanged.');
    });
    return () => { generation.current++; };
  }, [cfg, connectionId, flipId, batchToken, onReady]);

  async function prepare() {
    if (!cfg || !collection || !online) return;
    const attempt = ++generation.current;
    setBusy(true); setError(''); onReady(false);
    try {
      const loaded = result ?? await fetchPreparation(cfg, collection);
      if (attempt !== generation.current || useStore.getState().s3Config !== cfg) return;
      stagePreparation(cfg, loaded);
      setResult(loaded);
      const changes = activeKeyProfile(useKeyBindings.getState()).speciesSources?.[`${loaded.sourceBucket}/${loaded.sourceKey}`]?.pendingSpeciesChange;
      if (changes) return;
      const prepared = await snapshotPreparation(cfg, collection, loaded);
      if (attempt !== generation.current || useStore.getState().s3Config !== cfg) return;
      if (flipId) await bindPreparedSpecies(flipId, prepared, await deriveFlipOwnerScope(cfg));
      else {
        await savePreparedSpecies(prepared);
        if (attempt !== generation.current || useStore.getState().s3Config !== cfg) return;
        acceptPreparationSpecies(prepared);
      }
      if (attempt !== generation.current || useStore.getState().s3Config !== cfg) return;
      setSnapshot(prepared); setSelected(null); onReady(true); setResult(null);
    } catch (failure) {
      if (attempt === generation.current) setError((failure as Error).message);
    } finally { if (attempt === generation.current) setBusy(false); }
  }

  return (
    <section className="border border-rule bg-panel p-4 space-y-3 mb-4" aria-label="Prepare species for local tagging">
      <h2 className="font-display text-[18px]">Species for local tagging</h2>
      <p className="text-[13px] text-inkSoft">Choose a collection and prepare its species online before tagging. This does not assign your batch or prepare the apps for offline reopening.</p>
      {snapshot && <p role="status" className="text-[13px] break-words">Species prepared for {snapshot.collectionName}: {snapshot.species.length} {snapshot.species.length === 1 ? 'entry' : 'entries'}. Source: {snapshot.sourceBucket}/{snapshot.sourceKey}. {(flipId || hasFiles) ? 'This batch keeps this list.' : 'This list will be copied into your next tagging handoff.'}</p>}
      {(!snapshot || selected) && <p id="species-preparation-help" className="text-[13px] text-inkSoft">Tagging requires prior online species preparation. You can still select files and complete Inspect.</p>}
      {!((flipId || hasFiles) && snapshot && !selected) && <>
        {cfg && online ? <>
          <p className="block text-[13px]">Collection for species preparation</p>
          {collections.isLoading && <p role="status">Loading collections…</p>}
          {collections.isError && <p role="alert">Could not load collections. Reconnect and retry preparation.</p>}
          <CollectionPicker label="Collection for species preparation" collections={collections.data ?? []} value={selected} onChange={(key) => { generation.current++; setSelected(key); setResult(null); setError(''); setBusy(false); onReady(false); }} />
          <button type="button" disabled={!collection || busy} onClick={() => void prepare()} className="border border-ink px-3 py-2 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{busy ? 'Preparing species…' : 'Prepare species'}</button>
        </> : <p className="text-[13px] text-inkSoft">Connect online to prepare a collection’s species list.</p>}
      </>}
      {pending && <div role="region" aria-label="Species-list changes" className="space-y-2 text-[13px]">
        <p>The current list differs from your previously accepted list. Review these changes before preparing.</p>
        <ul>{pending.diff.added.map((s) => <li key={`add-${s.scientificName}`}>Added: {s.commonName} ({s.scientificName})</li>)}{pending.diff.removed.map((s) => <li key={`remove-${s.scientificName}`}>Removed: {s.commonName} ({s.scientificName})</li>)}{pending.diff.modified.map(({ after }) => <li key={`change-${after.scientificName}`}>Updated: {after.commonName} ({after.scientificName})</li>)}</ul>
        <button type="button" onClick={() => { useKeyBindings.getState().acknowledgeSpeciesChange(source); void prepare(); }} className="border border-ink px-3 py-2">Accept changes and prepare species</button>
      </div>}
      {error && <p role="alert" className="text-warn text-[13px]">{error}</p>}
    </section>
  );
}
