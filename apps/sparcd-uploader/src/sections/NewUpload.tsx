import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Severity } from '../lib/validation';
import { StepIndicator } from '../components/StepIndicator';
import { DropZone } from '../components/DropZone';
import { FileList } from '../components/FileList';
import { Assign } from './Assign';
import { Upload } from './Upload';
import { formatBytes } from '../lib/scanFiles';
import { summarize } from '../lib/validation';
import { ensureProcessing } from '../lib/processing';
import { listResumable, fileStateCounts } from '../lib/db';

type OpenSession = { stamp: string; done: number; total: number; others: number };

// A reload lands on the empty Drop step, which gives no sign that an
// interrupted wet upload is still resumable in IndexedDB. Point at History,
// which owns the actual resume flow.
function ResumeNotice() {
  const setSection = useStore((s) => s.setSection);
  const [open, setOpen] = useState<OpenSession | null>(null);

  useEffect(() => {
    void (async () => {
      const [latest, ...others] = await listResumable();
      if (!latest) return;
      const counts = await fileStateCounts(latest.id);
      setOpen({
        stamp: latest.uploadPrefix.slice(latest.uploadPrefix.lastIndexOf('/') + 1),
        done: counts.done,
        total: latest.totalFiles,
        others: others.length,
      });
    })();
  }, []);

  if (!open) return null;

  return (
    <div className="mb-4 flex flex-col gap-2 border border-ruleSoft bg-paper px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-body text-[13px] text-inkSoft">
        An interrupted upload is waiting:{' '}
        <span className="font-mono text-ink">{open.stamp}</span> —{' '}
        <span className="font-mono text-ink">{open.done}</span> of{' '}
        <span className="font-mono text-ink">{open.total}</span> files uploaded.
        {open.others > 0 && ` (+${open.others} more in History)`}
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
  const resetBatch = useStore((s) => s.resetBatch);
  const setStep = useStore((s) => s.setStep);

  // Start (or adopt) processing whenever a fresh batch reaches the inspect step.
  // ensureProcessing is idempotent per batch token, so this is safe to re-run.
  useEffect(() => {
    if (step === 'inspect' && files.length > 0) ensureProcessing();
  }, [step, batchToken, files.length]);

  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const summary = useMemo(() => summarize(files, validations), [files, validations]);

  // Clicking a severity counter filters the list to just those files —
  // scrolling a 5000-row list for the one flagged file is not an option.
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null);
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
      <div className="mb-6">
        <StepIndicator current={step} />
      </div>

      {step === 'drop' && (
        <>
          <ResumeNotice />
          <DropZone />
        </>
      )}

      {step === 'inspect' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-body text-[14px] text-inkSoft">
              <span className="font-mono text-ink">{files.length}</span> files ·{' '}
              <span className="font-mono text-ink">{formatBytes(totalBytes)}</span>
              {summary.pending > 0 && (
                <>
                  {' · '}
                  <span className="font-mono text-inkSoft">{summary.pending}</span> processing
                </>
              )}
              {summary.errors > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setSeverityFilter((f) => (f === 'error' ? null : 'error'))}
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
                    onClick={() => setSeverityFilter((f) => (f === 'warning' ? null : 'warning'))}
                    aria-pressed={severityFilter === 'warning'}
                    title={severityFilter === 'warning' ? 'Show all files' : 'Show only warnings'}
                    className={counterClass('warning', 'text-warn')}
                  >
                    {summary.warnings} warnings
                  </button>
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
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={resetBatch}
                className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0 border border-ink text-ink px-3.5 py-2.5 sm:py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                Start over
              </button>
              <button
                disabled={!summary.ready}
                onClick={() => setStep('assign')}
                title={summary.ready ? 'Continue to assignment' : 'Resolve files that need attention first'}
                className={`flex-1 sm:flex-none min-h-[44px] sm:min-h-0 bg-ink text-paper border border-ink px-3.5 py-2.5 sm:py-1.5 text-[14px] font-body font-[600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
                  summary.ready
                    ? `hover:opacity-90 hover:animate-none ${throb ? 'animate-throb' : ''}`
                    : 'opacity-40 cursor-not-allowed'
                }`}
              >
                Continue
              </button>
            </div>
          </div>
          <FileList severityFilter={severityFilter} />
          <p className="font-body text-[13px] text-inkMute">
            Press <span className="font-mono">D</span> to drop a flagged duplicate — it's kept
            otherwise. Missing a timestamp? Add one in Assign or Upload.
          </p>
        </div>
      )}

      {step === 'assign' && <Assign />}

      {step === 'upload' && <Upload />}
    </div>
  );
}
