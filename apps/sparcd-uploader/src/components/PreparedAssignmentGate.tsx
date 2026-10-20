import { useEffect, useMemo, useRef, useState } from 'react';
import { readFlipRecord, validPreparedSpecies } from '@sparcd/flip';
import { diffSpecies, activeKeyProfile, useKeyBindings } from '@sparcd/auth-ui';
import type { CollectionRef } from '@sparcd/s3-safe';
import { useStore } from '../store';
import { fetchPreparation, assessPreparedAssignment, stagePreparation } from '../lib/preparedSpecies';

/** Fresh canonical comparison before Assign continues; never rewrites tags or the baseline snapshot. */
export function PreparedAssignmentGate({ collection, onReady }: { collection: CollectionRef | null; onReady: (ready: boolean) => void }) {
  const cfg = useStore((s) => s.s3Config);
  const flipId = useStore((s) => s.flipId);
  const files = useStore((s) => s.files);
  const tagSignature = JSON.stringify(files.flatMap((file) => file.preTags ?? []));
  const tags = useMemo(() => JSON.parse(tagSignature) as { scientificName: string; requestedSpecies?: string }[], [tagSignature]);
  const reviewSource = useRef<{ profile: string; source: string } | null>(null);
  const [message, setMessage] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [incompatible, setIncompatible] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    reviewSource.current = null;
    setConfirmed(false); setNeedsConfirmation(false); setIncompatible(false); setMessage('');
    if (!flipId) { onReady(true); return; }
    onReady(false);
    if (!cfg || !collection) return;
    setMessage('Checking the prepared species against the assigned collection…');
    void (async () => {
      const snapshot = (await readFlipRecord(flipId))?.preparedSpecies;
      if (!validPreparedSpecies(snapshot)) throw new Error('This batch needs species prepared online. Return to Inspect to prepare its list; existing tags are preserved.');
      const loaded = await fetchPreparation(cfg, collection);
      if (!current) return;
      const profile = stagePreparation(cfg, loaded);
      const source = `${loaded.sourceBucket}/${loaded.sourceKey}`;
      reviewSource.current = { profile, source };
      const pending = activeKeyProfile(useKeyBindings.getState()).speciesSources?.[source]?.pendingSpeciesChange;
      const { missing, changed } = assessPreparedAssignment(snapshot, loaded, cfg, collection.key, tags);
      if (missing.length) {
        setIncompatible(true);
        setMessage(`These identifications are not in the assigned collection’s current species list: ${missing.join(', ')}. Return to Inspect and review the tags before uploading. No tags have been removed.`);
        return;
      }
      const diff = diffSpecies(snapshot.species, loaded.species);

      if (changed || pending) {
        setMessage(`The assigned collection or species list differs from the prepared list for ${snapshot.collectionName}. Current list: ${collection.name || collection.uuid}. Added: ${diff.added.length}; removed: ${diff.removed.length}; updated: ${diff.modified.length}. Your identifications remain unchanged.`);
        setNeedsConfirmation(true);
      } else { setMessage('Prepared species match the assigned collection’s current list.'); onReady(true); }
    })().catch((error) => { if (current) { setIncompatible(true); setMessage((error as Error).message); } });
    return () => { current = false; };
  }, [cfg, flipId, collection, tags, retry, onReady]);
  if (!flipId) return null;
  return <section aria-label="Prepared species assignment review" className="border border-rule p-3 space-y-2 text-[13px]">
    <p role={incompatible ? 'alert' : 'status'}>{message || 'Select a collection to check prepared species.'}</p>
    {needsConfirmation && <label className="flex gap-2 items-start"><input type="checkbox" checked={confirmed} onChange={(event) => {
      const checked = event.target.checked;
      if (checked && reviewSource.current) {
        useKeyBindings.getState().activateProfile(reviewSource.current.profile);
        useKeyBindings.getState().acknowledgeSpeciesChange(reviewSource.current.source);
      }
      setConfirmed(checked); onReady(checked);
    }} />Use the current species list for this assignment; preserve my existing identifications.</label>}
    {incompatible && <button type="button" className="border border-ink px-3 py-2" onClick={() => setRetry((n) => n + 1)}>Retry species check</button>}
  </section>;
}
