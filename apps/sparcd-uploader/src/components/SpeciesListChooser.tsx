import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SPECIES_KEY, loadSpeciesVocabulary, type CollectionRef } from '@sparcd/s3-safe';
import { listSpeciesVocabularies, savePreparedSpecies, saveSpeciesVocabulary, type PreparedSpecies } from '@sparcd/flip';
import type { S3Config } from '@sparcd/types';
import { useStore } from '../store';
import { useCollections } from '../lib/useCollections';
import { getClient } from '../lib/s3';
import { snapshotPreparation, stageSavedPreparation } from '../lib/preparedSpecies';

type Props = {
  open: boolean;
  online: boolean;
  cfg: S3Config | null;
  onCancel: () => void;
  onContinue: (snapshot: PreparedSpecies) => Promise<void>;
};

const MASTER = '__master__';

/** Selects a vocabulary only; it never changes the batch's upload destination. */
export function SpeciesListChooser({ open, online, cfg, onCancel, onContinue }: Props) {
  const connectionId = useStore(s => s.connectionId);
  const collections = useCollections(cfg, connectionId, open && online);
  const dialog = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState(MASTER);
  const [collectionKey, setCollectionKey] = useState('');
  const [cached, setCached] = useState<PreparedSpecies[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const cancel = useCallback(() => {
    generation.current++;
    setBusy(false);
    onCancel();
  }, [onCancel]);

  useEffect(() => {
    if (!open || online) return;
    let live = true;
    void listSpeciesVocabularies().then(items => { if (live) setCached(items); })
      .catch(() => { if (live) setCached([]); });
    return () => { live = false; };
  }, [open, online]);

  const cachedOptions = useMemo(() => {
    const byCollection = new Map<string, PreparedSpecies>();
    for (const item of cached) {
      const key = item.collectionKey === SPECIES_KEY ? MASTER : item.collectionKey;
      const existing = byCollection.get(key);
      if (!existing || existing.preparedAt < item.preparedAt) byCollection.set(key, item);
    }
    return [...byCollection.entries()];
  }, [cached]);
  const selectedCached = cachedOptions.find(([key]) => key === choice)?.[1];

  useEffect(() => {
    if (!open || online || cachedOptions.length === 0 || cachedOptions.some(([key]) => key === choice)) return;
    setChoice(cachedOptions[0][0]);
  }, [open, online, cachedOptions, choice]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusTarget = dialog.current?.querySelector<HTMLElement>('input, select, button');
    focusTarget?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); cancel(); return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, cancel]);

  if (!open) return null;

  async function proceed() {
    const attempt = ++generation.current;
    setBusy(true); setError('');
    try {
      let snapshot: PreparedSpecies;
      if (!online) {
        if (!selectedCached) return;
        snapshot = selectedCached;
        stageSavedPreparation(snapshot);
      } else {
        if (!cfg) throw new Error('Connect before loading a species list.');
        let result;
        let collection: CollectionRef;
        if (choice === MASTER) {
          result = await loadSpeciesVocabulary(getClient(cfg));
          collection = { key: SPECIES_KEY, bucket: result.sourceBucket, uuid: '', name: 'Master species list', organization: null, contact: null, description: null };
        } else {
          const selected = collections.data?.find(item => item.key === collectionKey);
          if (!selected) throw new Error('Choose an available collection, then try again.');
          collection = selected;
          // The shared loader uses Settings only when the collection object is missing or empty.
          // Read failures and invalid files are surfaced by the loader.
          result = await loadSpeciesVocabulary(getClient(cfg), selected.key);
        }
        if (attempt !== generation.current || useStore.getState().s3Config !== cfg) return;
        if (!result.species.length || result.skipped.length) throw new Error('The species list is empty or contains invalid entries. Ask an administrator to correct it.');
        snapshot = await snapshotPreparation(cfg, collection, result);
        if (attempt !== generation.current || useStore.getState().s3Config !== cfg) return;
        if (choice === MASTER) await savePreparedSpecies(snapshot);
        else await saveSpeciesVocabulary(snapshot);
      }
      if (attempt !== generation.current) return;
      await onContinue(snapshot);
      if (attempt === generation.current) onCancel();
    } catch (failure) {
      if (attempt === generation.current) setError((failure as Error).message || 'The species list could not be loaded.');
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }

  return createPortal(<div className="fixed inset-0 z-[180] grid place-items-center bg-ink/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) cancel(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="species-list-title" className="max-h-[90svh] w-full max-w-xl overflow-auto border border-rule bg-paper p-5 shadow-xl">
      <h2 id="species-list-title" className="font-display text-[20px] text-ink">Choose a species list</h2>
      {online ? <div className="mt-4 space-y-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 border border-ruleSoft p-3">
          <input type="radio" name="species-list-choice" checked={choice === MASTER} onChange={() => { setChoice(MASTER); setError(''); }} />
          <span><span className="block font-body text-[14px] text-ink">Master species list</span><span className="block text-[12px] text-inkSoft">Settings/species.json</span></span>
        </label>
        <div className="space-y-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 border border-ruleSoft p-3">
            <input type="radio" name="species-list-choice" checked={choice === 'collection'} onChange={() => { setChoice('collection'); setError(''); }} />
            <span className="font-body text-[14px] text-ink">Use a collection’s species list</span>
          </label>
          {choice === 'collection' && <div className="pl-8">
            <label htmlFor="species-list-collection" className="mb-1 block text-[13px] text-ink">Collection</label>
            <select id="species-list-collection" value={collectionKey} onChange={event => { setCollectionKey(event.target.value); setError(''); }} className="min-h-11 w-full border border-rule bg-paper px-3 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <option value="">Choose a collection…</option>
              {(collections.data ?? []).map(item => <option key={item.key} value={item.key}>{item.name || item.uuid} — {item.bucket}</option>)}
            </select>
            {collections.isLoading && <p role="status" className="mt-2 text-[13px]">Loading available collections…</p>}
            {collections.isError && <p role="alert" className="mt-2 text-[13px] text-warn">Could not load available collections. Retry or choose the Master species list.</p>}
            {!collections.isLoading && !collections.isError && collections.data?.length === 0 && <p role="status" className="mt-2 text-[13px]">No collections are available. Choose the Master species list.</p>}
          </div>}
        </div>
      </div> : <div className="mt-4 space-y-3">
        {cachedOptions.length > 0 ? <>
          <p className="text-[14px] text-ink">You’re offline. Only species lists saved on this device are available.</p>
          <fieldset className="space-y-2">
          <legend className="mb-2 text-[13px] text-inkSoft">Available saved species lists</legend>
          {cachedOptions.map(([key, item]) => <label key={key} className="flex min-h-11 cursor-pointer items-start gap-3 border border-ruleSoft p-3">
            <input type="radio" name="species-list-choice" checked={choice === key} onChange={() => { setChoice(key); setError(''); }} className="mt-1" />
            <span><span className="block font-body text-[14px] text-ink">{key === MASTER ? 'Master species list' : item.collectionName}</span><span className="block text-[12px] text-inkSoft">{item.species.length} {item.species.length === 1 ? 'species' : 'species'}</span></span>
          </label>)}
          </fieldset>
        </> : <p className="text-[14px] text-inkSoft">You’re offline, and no species lists are saved on this device.</p>}
      </div>}
      {error && <p role="alert" className="mt-3 text-[13px] text-warn">{error}</p>}
      <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-ruleSoft pt-4">
        <button type="button" disabled={busy} onClick={cancel} className="min-h-11 border border-ink px-4 text-[14px] disabled:opacity-50">Cancel</button>
        {(online || cachedOptions.length > 0) && <button type="button" disabled={busy || (online && choice === 'collection' && !collectionKey)} onClick={() => void proceed()} className="min-h-11 border border-ink bg-ink px-4 text-[14px] text-paper disabled:opacity-50">{busy ? 'Loading species…' : 'Continue'}</button>}
      </footer>
    </section>
  </div>, document.body);
}
