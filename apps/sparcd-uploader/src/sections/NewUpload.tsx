import { useOnline } from '@sparcd/auth-ui';
import { deriveFlipOwnerScope, flipRecordUnavailableReason, bindPreparedSpecies, readFlipRecord, validPreparedSpecies } from '@sparcd/flip';
import { WorkflowNotice } from '../components/WorkflowNotice';
import { loadMasterSpecies, refreshMasterSpecies } from '../lib/masterSpecies';
import { acceptPreparationSpecies, readBoundPreparationSpecies, readPreparation } from '../lib/preparation';
import { PreparationRecovery, PreparationSaveStatus } from '../components/PreparationRecovery';
import { flushPreparation, recoveryGuard } from '../lib/preparation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Severity } from '../lib/validation';
import { StepIndicator } from '../components/StepIndicator';
import { DropZone } from '../components/DropZone';
import { FileList } from '../components/FileList';
import { Assign } from './Assign';
import { Upload } from './Upload';
import { canPickFolder, formatBytes, supportsDirectoryHandle } from '../lib/scanFiles';
import { summarize } from '../lib/validation';
import { ensureProcessing } from '../lib/processing';
import { selectResumeNotice } from '../lib/resumeNotice';
import { listResumable, fileStateCounts } from '../lib/db';
import type { FlipRecord } from '@sparcd/flip';
import {
  adoptRecord,
  reselectFlip,
  handOffToTagger,
  returningFlipOwnerScope,
  reopenTagger,
  resumeFromFlip,
  returningFlipId,
  type FlipReturn,
} from '../lib/flip';


type OpenSession = NonNullable<ReturnType<typeof selectResumeNotice>>;

// A reload lands on the empty Drop step, which gives no sign that an
// interrupted wet upload is still resumable in IndexedDB. Point at History,
// which owns the actual resume flow.
function ResumeNotice() {
  const setSection = useStore((s) => s.setSection);
  const [open, setOpen] = useState<OpenSession | null>(null);
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const batches = await listResumable();
      const candidates = await Promise.all(batches.map(async (batch) => ({
        batch, counts: await fileStateCounts(batch.id),
      })));
      if (live) setOpen(selectResumeNotice(candidates));
    })().catch(() => {
      // IndexedDB access can be unavailable; do not leave an unhandled rejection.
      if (live) setReadFailed(true);
    });
    return () => { live = false; };
  }, []);

  if (readFailed) return <div role="status" className="mb-4 border border-warn bg-paper p-3 text-warn">
    Could not check unfinished uploads. <button type="button" className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setSection('history')}>Open History</button> to review saved uploads.
  </div>;
  if (!open) return null;

  const hasFailures = open.failed > 0;

  return (
    <div role="status" aria-label="Unfinished uploads"
      className={`mb-4 flex flex-col gap-2 border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${
        hasFailures || open.publicationIncomplete ? 'border-warn bg-paper' : 'border-warn/40 bg-paper'
      }`}
    >
      <p className="min-w-0 break-words font-body text-[13px] text-warn">
        {hasFailures ? 'An interrupted upload failed:' : open.publicationIncomplete ? 'An upload needs publication:' : 'An interrupted upload is waiting:'}{' '}
        <span className="font-mono text-ink break-all">{open.stamp}</span> —{' '}
        <span className="font-mono text-ink">{open.done}</span> of{' '}
        <span className="font-mono text-ink">{open.total}</span> files uploaded
        {hasFailures && (
          <>
            , <span className="font-mono font-[600] text-warn">✕ {open.failed} failed</span>
          </>
        )}
        .{open.others > 0 && ` (+${open.others} more in History)`}
        {open.failedUploads > 1 && ` ${open.failedUploads} uploads have failed files.`}
        {hasFailures ? ' Open History to fix.' : open.publicationIncomplete
          ? ' All files uploaded, but publication is incomplete. Open History to review and finish.'
          : ' Open History to review and continue.'}
      </p>
      <button
        type="button"
        onClick={() => setSection('history')}
        className="shrink-0 min-h-[44px] sm:min-h-0 border border-ink text-ink px-3 py-2.5 sm:py-1 text-[13px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        Open History
      </button>
    </div>
  );
}

export function NewUpload() {
  const step = useStore((s) => s.step);
  const files = useStore((s) => s.files);
  const validations = useStore((s) => s.validations);
  const batchToken = useStore((s) => s.batchToken);
  const flipId = useStore((s) => s.flipId);
  const online = useOnline();
  const [notice, setNotice] = useState<{title:string;message:string} | null>(null);
  const [tagError, setTagError] = useState('');
  const [tagging, setTagging] = useState(false);
  const resetBatch = useStore((s) => s.resetBatch);
  const setStep = useStore((s) => s.setStep);

  // Start (or adopt) processing whenever a fresh batch reaches the inspect step.
  // ensureProcessing is idempotent per batch token, so this is safe to re-run.
  useEffect(() => {
    if (step === 'inspect' && files.length > 0) ensureProcessing();
  }, [step, batchToken, files.length]);

  const flip = useFlipReturn();

  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const summary = useMemo(() => summarize(files, validations), [files, validations]);
  const tagged = useMemo(() => files.filter((f) => f.preTags?.length).length, [files]);
  const missingOriginals = files.filter(file => file.needsOriginal);

  // Clicking a severity counter filters the list to just those files —
  // scrolling a 5000-row list for the one flagged file is not an option.
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  useEffect(() => setShowFiles(false), [batchToken]);
  const toggleFilter = (filter: Severity) => {
    setSeverityFilter((f) => (f === filter ? null : filter));
    setShowFiles(true);
  };
  useEffect(() => {
    if (severityFilter === 'error' && summary.errors === 0) setSeverityFilter(null);
    if (severityFilter === 'warning' && summary.warnings === 0) setSeverityFilter(null);
  }, [severityFilter, summary.errors, summary.warnings]);

  const counterClass = (filter: Severity, tone: string) =>
    `font-mono ${tone} underline-offset-2 hover:underline ${
      severityFilter === filter ? 'underline' : ''
    }`;

  // Draw the eye to Continue the moment it becomes enabled, then settle down
  // — a permanent throb reads as nagging, not helpful. Re-triggers if it goes
  // back to disabled (e.g. a new error surfaces) and becomes ready again.
  const [throb, setThrob] = useState(false);
  useEffect(() => {
    if (!summary.ready) {
      setThrob(false);
      return;
    }
    setThrob(true);
    const timer = setTimeout(() => setThrob(false), 10_000);
    return () => clearTimeout(timer);
  }, [summary.ready]);

  return (
    <div className="px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <StepIndicator current={step} />
        {step === 'inspect' && (
          <button
            disabled={!summary.ready || tagging}
            onClick={() => {
              setTagging(true); setTagError('');
              const guard = recoveryGuard();
              void (async () => {
                await flushPreparation();
                const cfg = useStore.getState().s3Config;
                const ownerScope = flipId ? cfg ? await deriveFlipOwnerScope(cfg) : returningFlipOwnerScope() ?? undefined : undefined;
                if (flipId && !ownerScope) throw new Error('Reconnect with the login that owns this batch before reopening Tagger.');
                const record = flipId ? await readFlipRecord(flipId, ownerScope) : undefined;
                guard();
                if (flipId && !record) throw new Error(await flipRecordUnavailableReason(flipId, ownerScope));
                let saved = flipId ? record?.preparedSpecies : (await readPreparation())?.species ?? await readBoundPreparationSpecies();
                guard();
                if (saved && !validPreparedSpecies(saved)) throw new Error('This batch’s saved species list cannot be read by this version. Your files and tags are unchanged. Use a compatible version to continue tagging.');
                if (!validPreparedSpecies(saved)) {
                  saved = await loadMasterSpecies(cfg ?? undefined);
                  if (!saved && cfg && online) {
                    try { saved = await refreshMasterSpecies(cfg, () => { try { guard(); return true; } catch { return false; } }); }
                    catch { throw new Error('The species list could not be downloaded. Check your connection and access, then try tagging again. Your files and tags are unchanged.'); }
                  }
                  guard();
                  if (!saved) throw new Error('The species list is not available on this device. Connect online to download the Settings species list, then try tagging again. You can keep selecting and inspecting files.');
                  if (flipId) await bindPreparedSpecies(flipId, saved, ownerScope);
                  else await acceptPreparationSpecies(saved);
                }
                guard();
                await (flipId ? reopenTagger(flipId) : handOffToTagger());
              })().catch(error => { setNotice({title:'Tagging species',message:(error as Error).message}); setTagging(false); });
            }}
            title={
              flipId
                ? 'Go back to the tagger and pick up where you left off'
                : summary.ready
                  ? 'Identify species in the Tagger before uploading'
                  : 'Resolve files that need attention first'
            }
            className={`min-h-[44px] sm:min-h-0 bg-mark text-ink border border-ink px-3.5 py-2.5 sm:py-1.5 text-[14px] font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
              summary.ready && !tagging ? 'hover:bg-paperHover' : 'opacity-40 cursor-not-allowed'
            }`}
          >
            {flipId ? 'Edit tags' : 'Tag species before upload'}
          </button>
        )}
      </div>

      {step === 'drop' && !flip && <ResumeNotice />}
      {notice && <WorkflowNotice title={notice.title} onClose={() => setNotice(null)}><p>{notice.message}</p></WorkflowNotice>}
      <PreparationSaveStatus />
      {tagError && <p role="alert" className="text-warn">{tagError}</p>}

      {step === 'drop' &&
        (flip ? (
          <FlipReturnPanel state={flip} />
        ) : (
          <>
            <PreparationRecovery />
            <DropZone />
          </>
        ))}

      {step === 'inspect' && (
        <div className="space-y-4">
          {missingOriginals.length > 0 && <section aria-label="Original files need recovery" className="border border-warn p-3 space-y-2">
            <p role="alert">Verified files and saved tags were restored. {missingOriginals.length} original {missingOriginals.length === 1 ? 'file needs' : 'files need'} recovery before continuing. Their saved hashes and tags are retained.</p>
            <ul>{missingOriginals.map(file => <li key={file.id} className="break-words">{file.relPath}: {file.processError}</li>)}</ul>
            <button type="button" className="min-h-11 border border-ink px-3" onClick={() => {
              const guard = recoveryGuard();
              void flushPreparation().then(() => { guard(); setStep('drop'); }).catch(error => setTagError((error as Error).message));
            }}>Reselect original files</button>
          </section>}
          <div className="space-y-3">
            <p className="font-body text-[14px] text-inkSoft">
              <span className="font-mono text-ink">{summary.processed}</span> of{' '}
              <span className="font-mono text-ink">{files.length}</span> files processed ·{' '}
              <span className="font-mono text-ink">{formatBytes(totalBytes)}</span>
              {flipId && (
                <>
                  {' · '}
                  <span className="font-mono text-ink">{tagged}</span> tagged
                </>
              )}
              {summary.errors > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => toggleFilter('error')}
                    aria-pressed={severityFilter === 'error'}
                    title={severityFilter === 'error' ? 'Show all files' : 'Show only files needing attention'}
                    className={counterClass('error', 'text-warn')}
                  >
                    {summary.errors} need attention
                  </button>
                </>
              )}
              {summary.warnings > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => toggleFilter('warning')}
                    aria-pressed={severityFilter === 'warning'}
                    title={severityFilter === 'warning' ? 'Show all files' : 'Show only warnings'}
                    className={counterClass('warning', 'text-warn')}
                  >
                    {summary.warnings} warnings
                  </button>
                </>
              )}
              {summary.noCameraTime > 0 && (
                <>
                  {' · '}
                  <span className="font-mono text-warn">
                    {summary.noCameraTime} without camera time
                  </span>
                </>
              )}
              {severityFilter && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setSeverityFilter(null)}
                    className="font-body text-[12px] text-inkSoft underline underline-offset-2"
                  >
                    clear filter
                  </button>
                </>
              )}
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={resetBatch}
                title="Discard this batch and return to Choose"
                className="min-h-[44px] sm:min-h-0 border border-ink text-ink px-3.5 py-2.5 sm:py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                Back
              </button>
              <button
                disabled={!summary.ready}
                onClick={() => online ? setStep('assign') : setNotice({title:'Connect before Describe',message:'Connect online before Describe so locations and collections can be loaded. Your files and tags are saved on this device.'})}
                title={summary.ready ? 'Continue to Describe' : 'Resolve files that need attention first'}
                className={`min-h-[44px] sm:min-h-0 bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 text-[14px] font-body font-[600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
                  summary.ready
                    ? `hover:opacity-90 hover:animate-none ${throb ? 'animate-throb' : ''}`
                    : 'opacity-40 cursor-not-allowed'
                }`}
              >
                Continue
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowFiles((v) => !v)}
            aria-expanded={showFiles}
            className="inline-flex min-h-[40px] items-center gap-1.5 px-2 sm:min-h-0 sm:px-0 font-body text-[13px] text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span aria-hidden>{showFiles ? '▾' : '▸'}</span>
            {showFiles ? 'Hide files' : 'Show files'}
          </button>
          {showFiles && <FileList severityFilter={severityFilter} />}
          {(showFiles || summary.noCameraTime > 0) && (
            <p className="font-body text-[13px] text-inkMute">
              {showFiles && (
                <>
                  Press <span className="font-mono">D</span> to drop a flagged duplicate — it's
                  kept otherwise.{' '}
                </>
              )}
              {summary.noCameraTime > 0 && 'A timestamp needs review in Assign before upload.'}
            </p>
          )}
        </div>
      )}

      {step === 'assign' && <Assign />}

      {step === 'upload' && <Upload />}
    </div>
  );
}

/**
 * Pick the batch back up when the tagger sends the user here with `?flip=<id>`.
 * A page load is not a user gesture, so the restore can legitimately stop and
 * ask for a click — see `resumeFromFlip`. Returns null once the batch is in the
 * store (or when this was an ordinary visit), so the drop zone shows as usual.
 */
function useFlipReturn(): FlipPending | null {
  const [state, setState] = useState<FlipPending | null>(null);

  useEffect(() => {
    const id = returningFlipId();
    if (!id) return;
    void resumeFromFlip(id).then((r) => setState(r.kind === 'restored' ? null : r)).catch(() => {
      setState({ kind: 'not-found', message: 'This batch is unavailable for the connected login. Its saved work has been kept.' });
    });
  }, []);

  return state;
}

/** Everything that still needs the user before the batch is back on screen. */
type FlipPending = Exclude<FlipReturn, { kind: 'restored' }>;

function FlipReturnPanel({ state }: { state: FlipPending }) {
  if (state.kind === 'not-found') {
    return (
      <Panel title="That batch isn't here">
        <p>
          {state.message ?? 'The tagger pointed back at a batch this browser has no compatible record of.'} It may have been
          cleared, or the two tools may be running on different origins — in development they are.
          Choose the folder again to start over.
        </p>
      </Panel>
    );
  }
  if (state.kind === 'needs-reselect') return <ReselectPanel record={state.record} />;
  return <ReopenPanel record={state.record} />;
}

/**
 * No durable handle rode along with the batch, so the folder has to be pointed
 * at again. Same three-way choice the drop zone makes: the File System Access
 * picker where it exists (it hands back a handle for next time), the rendered
 * `webkitdirectory` input on a desktop browser without it, and individual files
 * on a device that cannot present a folder picker at all.
 */
function ReselectPanel({ record }: { record: FlipRecord }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputGuard = useRef<(() => void) | null>(null);
  const folderPick = canPickFolder();

  async function adopt(list?: FileList, guard = recoveryGuard()) {
    setBusy(true); setError('');
    try {
      guard();
      await reselectFlip(record, list);
    } catch (e) { setError((e as Error).message); } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Choose the folder again">
      {error && <p role="alert">{error}</p>}
      <p>
        Your tags are safe. This browser doesn't keep a durable handle on the folder, so it needs
        you to point at <span className="font-mono text-ink">{record.files.length}</span> files
        once more before they can be uploaded.
      </p>
      <PanelButton
        busy={busy}
        label={folderPick ? 'Choose folder' : 'Choose photos or videos'}
        onClick={() => {
          if (supportsDirectoryHandle) void adopt();
          else {
            // A cancelled picker does no work; reopening captures a fresh scope.
            inputGuard.current = recoveryGuard();
            inputRef.current?.click();
          }
        }}
      />
      {folderPick ? (
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error — non-standard but widely supported folder picker
          webkitdirectory=""
          directory=""
          multiple
          hidden
          onChange={onPick}
        />
      ) : (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,video/mp4"
          multiple
          hidden
          onChange={onPick}
        />
      )}
    </Panel>
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    const guard = inputGuard.current;
    inputGuard.current = null;
    if (list?.length && guard) void adopt(list, guard);
    e.target.value = '';
  }
}

function ReopenPanel({ record }: { record: FlipRecord }) {
  const [error, setError] = useState('');
  const [reselect, setReselect] = useState(false);
  const [busy, setBusy] = useState(false);
  if (reselect) return <ReselectPanel record={record} />;
  return (
    <Panel title="Reopen the batch">
      {error && <p role="alert">{error}</p>}
      <button type="button" className="underline" onClick={() => setReselect(true)}>Reselect folder instead</button>
      <p>
        Your tags are safe. The browser wants a click before it hands the folder's{' '}
        <span className="font-mono text-ink">{record.files.length}</span> files back — reading them
        from a page load alone isn't allowed.
      </p>
      <PanelButton
        busy={busy}
        label="Reopen batch"
        onClick={async () => {
          setBusy(true);
          // Straight into adoptRecord: the permission request has to be the
          // first thing this click awaits, or Safari and Firefox drop it.
          try {
            const result = await adoptRecord(record);
            if (result.kind !== 'restored') setError('Folder permission is unavailable. Reselect the folder instead.');
          } catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        }}
      />
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-rule bg-panel px-6 py-8 max-w-[640px] space-y-4">
      <h2 className="font-display text-[20px] font-[600] text-ink">{title}</h2>
      <div className="font-body text-[14px] text-inkSoft space-y-4">{children}</div>
    </div>
  );
}

function PanelButton({
  busy,
  label,
  onClick,
}: {
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="min-h-[44px] sm:min-h-0 bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 text-[14px] font-body font-[600] hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      {busy ? 'Working…' : label}
    </button>
  );
}
