import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { recoveryGuard, listPreparations, recoverPreparation, recoverPreparationFromHandle, preparationStatus, subscribePreparation, retryPreparation, type LocalPreparation } from '../lib/preparation';
import { reselectFolder } from '../lib/resume';
import { canPickFolder, supportsDirectoryHandle } from '../lib/scanFiles';
export function PreparationSaveStatus() {
  const message = useSyncExternalStore(subscribePreparation, preparationStatus);
  return message ? <div className="p-3 text-sm"><p role={message.includes('could not') ? 'alert' : 'status'}>{message}</p>{message.includes('could not') && <button type="button" onClick={retryPreparation} className="border px-3 py-2">Retry saving preparation</button>}</div> : null;
}
export function PreparationRecovery() {
  const [saved, setSaved] = useState<LocalPreparation | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [choices, setChoices] = useState<LocalPreparation[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const inputAttempt = useRef<{ saved: LocalPreparation; guard: () => void; kind: 'files' | 'folder' } | null>(null);
  useEffect(() => {
    const skipped: string[] = [];
    void listPreparations(id => skipped.push(id)).then(items => {
      setChoices(items); setSaved(items[0] ?? null); setUnavailable(skipped);
    }).catch(e => setError(e.message));
  }, []);
  async function choose(list?: FileList, attempt = { saved, guard: recoveryGuard() }) {
    if (!attempt.saved) return;
    setBusy(true); setError('');
    try {
      const { guard } = attempt;
      guard();
      const picked = await reselectFolder(list);
      guard();
      if (picked) await recoverPreparation(attempt.saved, picked.scanned, picked.handle ?? null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function consumeSelection(event: React.ChangeEvent<HTMLInputElement>, kind: 'files' | 'folder') {
    const attempt = inputAttempt.current;
    if (attempt?.kind !== kind) { event.target.value = ''; return; }
    inputAttempt.current = null;
    if (event.target.files?.length) void choose(event.target.files, attempt);
    event.target.value = '';
  }
  return saved || error || unavailable.length > 0 ? <section aria-label="Saved local preparation" className="mb-4 border border-rule p-4 space-y-2 text-sm">
    {choices.length > 1 && <label>Saved batch<select className="block max-w-full border p-2" value={saved?.id ?? ''} disabled={busy} onChange={event => setSaved(choices.find(item => item.id === event.target.value) ?? null)}>{choices.map(item => <option key={item.id} value={item.id}>{item.files[0].fileName} — {item.files.length} files — {item.savedAt}</option>)}</select></label>}
    {saved && <><h2>Resume local preparation</h2><p>{saved.files.length} {saved.files.length === 1 ? 'inspected file is' : 'inspected files are'} saved, including timestamps and any returned tags. Reselect the unchanged originals to verify file contents before continuing. Choose files if you originally selected individual files; choose a folder for a folder batch.</p><p>No original image or video files are stored here.</p>
      {saved.dirHandle && <button type="button" disabled={busy} className="min-h-11 border border-ink px-3" onClick={() => {
        setBusy(true); setError('');
        void recoverPreparationFromHandle(saved).catch(e => setError(e.message)).finally(() => setBusy(false));
      }}>Reopen saved folder</button>}
      {(supportsDirectoryHandle || canPickFolder()) && <button type="button" disabled={busy} onClick={() => {
        if (supportsDirectoryHandle) void choose();
        else if (saved) {
          inputAttempt.current = { saved, guard: recoveryGuard(), kind: 'folder' };
          ref.current?.click();
        }
      }} className="min-h-11 border border-ink px-3">{busy ? 'Verifying files…' : 'Reselect saved batch folder'}</button>}
      <button type="button" disabled={busy} onClick={() => {
        inputAttempt.current = { saved, guard: recoveryGuard(), kind: 'files' };
        filesRef.current?.click();
      }} className="min-h-11 border border-ink px-3">Reselect saved files</button>
      <input aria-label="Saved preparation folder" ref={ref} type="file" multiple hidden {...{ webkitdirectory: '', directory: '' }} onChange={e => consumeSelection(e, 'folder')} />
      <input aria-label="Saved preparation files" ref={filesRef} type="file" multiple accept="image/jpeg,video/mp4" hidden onChange={e => consumeSelection(e, 'files')} />
      {saved.flipId && <a className="underline block" href={`../tagger/?batch=${encodeURIComponent(saved.flipId)}`}>Reopen saved tags using thumbnails</a>}
    </>}
    {unavailable.length > 0 && <p role="alert">{unavailable.length} saved {unavailable.length === 1 ? 'batch is' : 'batches are'} damaged or from an unsupported version. {unavailable.length === 1 ? 'Its' : 'Their'} stored data has been kept. Reopen a compatible app to recover {unavailable.length === 1 ? 'it' : 'them'}; other saved batches remain available.</p>}
    {error && <p role="alert">{error}</p>}
  </section> : null;
}
