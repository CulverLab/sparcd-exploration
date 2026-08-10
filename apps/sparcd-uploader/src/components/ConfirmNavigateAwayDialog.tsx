import { useEffect } from 'react';

export function ConfirmNavigateAwayDialog({
  onContinue,
  onCancel,
}: {
  onContinue: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-navigate-away-title"
        className="w-full max-w-[440px] bg-paper border border-ink shadow-xl"
      >
        <div className="px-5 py-5 space-y-2">
          <h2 id="confirm-navigate-away-title" className="font-display text-[18px] text-ink">
            Leave the running upload?
          </h2>
          <p className="font-body text-[14px] text-ink">
            An upload is still in progress. Leaving now cancels it — files that already finished
            uploading stay safely in the bucket, but the batch won't publish. Restarting later
            creates a new destination, so it won't pick up where this one left off.
          </p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-rule px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onContinue}
            className="border border-warn text-warn px-3.5 py-1.5 text-[14px] font-body hover:bg-warn hover:text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Continue
          </button>
        </footer>
      </div>
    </div>
  );
}
