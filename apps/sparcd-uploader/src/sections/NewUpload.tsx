import { useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { StepIndicator } from '../components/StepIndicator';
import { DropZone } from '../components/DropZone';
import { FileList } from '../components/FileList';
import { Assign } from './Assign';
import { Upload } from './Upload';
import { formatBytes } from '../lib/scanFiles';
import { summarize } from '../lib/validation';
import { ensureProcessing } from '../lib/processing';

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

  return (
    <div className="px-6 py-6">
      <div className="mb-6">
        <StepIndicator current={step} />
      </div>

      {step === 'drop' && <DropZone />}

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
                  <span className="font-mono text-warn">{summary.errors}</span> need attention
                </>
              )}
              {summary.warnings > 0 && (
                <>
                  {' · '}
                  <span className="font-mono text-warn">{summary.warnings}</span> warnings
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
                  summary.ready ? 'hover:opacity-90' : 'opacity-40 cursor-not-allowed'
                }`}
              >
                Continue
              </button>
            </div>
          </div>
          <FileList />
          <p className="font-body text-[13px] text-inkMute">
            EXIF, SHA-256, thumbnails, and validation run in Web Workers. Files with no capture time
            get manual entry in Assign; duplicates are warnings you can keep or drop with{' '}
            <span className="font-mono">D</span>.
          </p>
        </div>
      )}

      {step === 'assign' && <Assign />}

      {step === 'upload' && <Upload />}
    </div>
  );
}
