import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { recoveryGuard, listPreparations, recoverPreparation, recoverPreparationFromHandle, preparationStatus, subscribePreparation, retryPreparation, type LocalPreparation } from '../lib/preparation';
import { reselectFolder } from '../lib/resume';
import { canPickFolder, supportsDirectoryHandle } from '../lib/scanFiles';
import { sourceFolderCopy, summarizeSourceFolders } from '../lib/sourceFolders';
import { listBatches, type BatchRecord } from '../lib/db';
import { useStore } from '../store';
import { formatHistoryBatchStart } from '../lib/uploadDisplay';
import { flipDb, isValidFlipOwnerScope } from '@sparcd/flip';
import { taggerBatchUrl } from '../lib/siblings';
export function PreparationSaveStatus() {
  const message = useSyncExternalStore(subscribePreparation, preparationStatus);
  if (!message) return null;
  if (message.kind === 'saving') return <div className="p-3 text-sm"><p role="status">Saving local preparation…</p></div>;
  if (message.kind === 'failed') return <div className="p-3 text-sm"><p role="alert">Local preparation could not be saved. Keep this tab open, free browser storage, and retry before leaving.</p><button type="button" onClick={retryPreparation} className="border px-3 py-2">Retry saving preparation</button></div>;

  const copy = sourceFolderCopy(message.sourceFolders);
  return <div className="p-3 text-sm"><p role="status" className="min-w-0 break-words select-text">
    <span>Local preparation saved.</span> {copy.beforeNames}{copy.names.map((name, index) => <span key={`${name}-${index}`}>
      {index > 0 ? ', ' : ''}<strong className="font-[700]">{name}</strong>
    </span>)}{copy.afterNames}
  </p></div>;
}
function preparationLabel(saved: LocalPreparation): string {
  const folders = saved.sourceFolders ?? summarizeSourceFolders(saved.files.map(file => file.relPath));
  const source = folders.names.length ? folders.names.join(', ') : 'Original files';
  return `${source} (${saved.files[0].fileName}) — ${saved.files.length} ${saved.files.length === 1 ? 'file' : 'files'} — saved ${formatHistoryBatchStart(saved.savedAt)}`;
}

function RecoveryAction({ label, help, disabled, onClick }: {
  label: string; help: string; disabled: boolean; onClick: () => void;
}) {
  const id = useId();
  const [showHelp, setShowHelp] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!showHelp) { setPosition(null); return; }
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const popup = tooltip.current!.getBoundingClientRect();
      const margin = 16, gap = 8;
      const below = anchor.bottom + gap;
      const top = below + popup.height <= window.innerHeight - margin ? below : anchor.top - gap - popup.height;
      setPosition({
        left: Math.max(margin, Math.min(anchor.left, window.innerWidth - margin - popup.width)),
        top: Math.max(margin, Math.min(top, window.innerHeight - margin - popup.height)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [showHelp]);
  return <div className="relative min-w-0">
    <button ref={trigger} type="button" disabled={disabled} aria-describedby={id}
      onMouseEnter={() => setShowHelp(true)} onMouseLeave={() => setShowHelp(false)}
      onFocus={() => setShowHelp(true)} onBlur={() => setShowHelp(false)}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setShowHelp(false); } }}
      onClick={onClick}
      className="min-h-11 w-full sm:w-auto border border-ink px-3 py-2 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      {label}
    </button>
    {showHelp ? createPortal(<span ref={tooltip} id={id} role="tooltip"
      className="pointer-events-none fixed z-[100] border border-rule bg-ink p-3 text-paper text-xs shadow-lg"
      style={{ ...position, visibility: position ? 'visible' : 'hidden', width: 'min(18rem, calc(100vw - 32px))' }}>{help}</span>, document.body)
      : <span id={id} className="sr-only">{help}</span>}
  </div>;
}

export function PreparationRecovery() {
  const [uploads, setUploads] = useState<BatchRecord[]>([]);
  const setSection = useStore(state => state.setSection);
  const folderAvailable = supportsDirectoryHandle || canPickFolder();
  const [saved, setSaved] = useState<LocalPreparation | null>(null);
  const [unavailable, setUnavailable] = useState<{ id: string; reason: string; fileName?: string }[]>([]);
  const [choices, setChoices] = useState<LocalPreparation[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [taggerHref, setTaggerHref] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const inputAttempt = useRef<{ saved: LocalPreparation; guard: () => void; kind: 'files' | 'folder' } | null>(null);
  useEffect(() => {
    const skipped: { id: string; reason: string; fileName?: string }[] = [];
    let mounted = true;
    void Promise.all([
      listPreparations((id, reason, fileName) => skipped.push({ id, reason: reason ?? 'Saved data is damaged or from an unsupported version.', fileName })),
      listBatches(),
    ]).then(([items, batches]) => {
      if (!mounted) return;
      setUploads(batches); setChoices(items); setSaved(items[0] ?? null); setUnavailable(skipped);
    }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, []);
  const linkedUpload = saved ? uploads.find(upload => upload.preparationId === saved.id) : undefined;
  async function showRecoveryError(error: unknown) {
    setError((error as Error).message);
    try { setUploads(await listBatches()); } catch { /* Keep recovery blocked and its error visible. */ }
  }
  useEffect(() => {
    let current = true;
    setTaggerHref('');
    if (saved?.flipId) {
      void flipDb.records.get(saved.flipId).then(record => {
        if (current && record && isValidFlipOwnerScope(record.ownerScope)) setTaggerHref(taggerBatchUrl(saved.flipId!, record.ownerScope));
      }).catch(() => {});
    }
    return () => { current = false; };
  }, [saved?.flipId]);
  async function choose(list?: FileList, attempt = { saved, guard: recoveryGuard() }) {
    if (!attempt.saved) return;
    setBusy(true); setError('');
    try {
      const { guard } = attempt;
      guard();
      const picked = await reselectFolder(list);
      guard();
      if (picked) await recoverPreparation(attempt.saved, picked.scanned, picked.handle ?? null);
    } catch (e) { await showRecoveryError(e); }
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
    <h2 className="font-display text-[18px]">{linkedUpload ? 'Find this upload in History' : 'Continue preparing an upload'}</h2>
    {choices.length > 1 && <label className="block min-w-0">Choose saved preparation
      <select aria-label="Choose saved preparation" aria-describedby="saved-preparation-choice-help" className="block w-full min-w-0 max-w-full border p-2" value={saved?.id ?? ''} disabled={busy}
        onChange={event => { setSaved(choices.find(item => item.id === event.target.value) ?? null); setError(''); }}>
        {choices.map(item => <option key={item.id} value={item.id}>{preparationLabel(item)}</option>)}
      </select>
      <span id="saved-preparation-choice-help" className="block text-inkSoft">Choose the saved work you want to continue. Each entry identifies its source, file count, and saved date.</span>
    </label>}
    {saved && <>
      <p className="break-words text-inkSoft">{preparationLabel(saved)}</p>
      {linkedUpload ? <>
        <p>{linkedUpload.completedAt ? 'This upload has already completed. View its saved upload record in History.' : 'This upload has already started. Resume it in History to continue the existing upload.'} Restoring it as a new preparation could create a duplicate upload.</p>
        <RecoveryAction label={linkedUpload.completedAt ? 'View upload in History' : 'Resume upload in History'}
          help="Open History to find the existing upload and its progress. No new upload is created." disabled={busy} onClick={() => setSection('history')} />
      </> : <>
        <p>This browser saved your file details, timestamps, and any tags while you were preparing an upload. Restore access to the original files to continue preparing this upload.</p>
        <p>{saved.files.length} {saved.files.length === 1 ? 'inspected file is' : 'inspected files are'} saved. No original image or video files are stored here.</p>
        <p id="saved-preparation-folder-help">Restore access using the same folder or individual-file selection you used originally. File contents are checked against the saved batch before your work is restored.</p>
        {saved.dirHandle && <RecoveryAction label={busy ? 'Verifying files…' : 'Reopen original folder'} disabled={busy}
          help="Restore read access to the remembered folder and verify its files before restoring your saved preparation. This does not upload files."
          onClick={() => {
            setBusy(true); setError('');
            void recoverPreparationFromHandle(saved).catch(showRecoveryError).finally(() => setBusy(false));
          }} />}
        {folderAvailable && <RecoveryAction label={busy ? 'Verifying files…' : 'Choose original folder'} disabled={busy}
          help="Select the folder you originally prepared. Its files are checked against the saved batch; nothing is uploaded yet."
          onClick={() => {
            if (supportsDirectoryHandle) void choose();
            else {
              inputAttempt.current = { saved, guard: recoveryGuard(), kind: 'folder' };
              ref.current?.click();
            }
          }} />}
        <details open={!folderAvailable} className="space-y-2">
          <summary className="cursor-pointer underline">Choose individual files instead</summary>
          <p>Use this option for batches originally selected as individual files, such as when your browser or device cannot choose a whole folder. Folder batches need the original folder to preserve file paths.</p>
          <RecoveryAction label="Choose original files" disabled={busy}
            help="Restore a batch originally prepared from individual photos and videos. Its files are checked before your saved work is restored; no upload starts."
            onClick={() => {
              inputAttempt.current = { saved, guard: recoveryGuard(), kind: 'files' };
              filesRef.current?.click();
            }} />
        </details>
        <p>After restoring your files, review the batch and upload details before starting the upload. History is for uploads that have already started.</p>
        <input aria-label="Saved preparation folder" ref={ref} type="file" multiple hidden {...{ webkitdirectory: '', directory: '' }} onChange={e => consumeSelection(e, 'folder')} />
        <input aria-label="Saved preparation files" ref={filesRef} type="file" multiple accept="image/jpeg,video/mp4" hidden onChange={e => consumeSelection(e, 'files')} />
        {saved.flipId && taggerHref && <a className="underline block" href={taggerHref}>Reopen saved tags using thumbnails</a>}
      </>}
    </>}
    {unavailable.length > 0 && <div role="alert" className="space-y-1"><p>{unavailable.length} saved {unavailable.length === 1 ? 'batch needs' : 'batches need'} attention. Their stored data has been kept; other recoverable batches remain available.</p><ul className="list-disc pl-5">{unavailable.map(item => <li key={item.id}>{item.fileName ? `${item.fileName}: ` : ''}{item.reason}</li>)}</ul></div>}
    {error && <p role="alert">{error}</p>}
  </section> : null;
}
