import { useEffect } from 'react';
import { formatTransferBreakdown } from '../lib/uploadDisplay';

export function UploadCompleteDialog({
  uploadedCount,
  verifiedCount,
  collectionId,
  onClose,
}: {
  uploadedCount: number;
  verifiedCount: number;
  collectionId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-complete-title"
        className="w-full max-w-[420px] bg-paper border border-ink shadow-xl"
      >
        <div className="px-5 py-5 space-y-2">
          <h2 id="upload-complete-title" className="font-display text-[18px] text-ink">
            Upload complete
          </h2>
          <p className="font-body text-[14px] text-ink">
            Published {uploadedCount + verifiedCount} file{uploadedCount + verifiedCount === 1 ? '' : 's'} to {collectionId}.
          </p>
          <p className="font-body text-[14px] text-inkSoft">{formatTransferBreakdown(uploadedCount, verifiedCount)}</p>
        </div>
        <footer className="flex items-center justify-end border-t border-rule px-5 py-3">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="bg-ink text-paper border border-ink px-3.5 py-1.5 text-[14px] font-body font-[600] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}
