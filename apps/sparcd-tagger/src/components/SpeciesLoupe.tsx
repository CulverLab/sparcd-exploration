import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Species } from '../lib/species';

// A read-only loupe: the enlarged species reference image, so a volunteer can
// confirm an ID without leaving the panel. The image is the upstream external
// `iconUrl` (Settings/species.json), rendered directly into <img> exactly like
// the panel thumbnail — no presign, no S3, no canvas, no writeback.
export function SpeciesLoupe({ species, onClose }: { species: Species; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Consume Escape completely: closing this viewer may restore a native
  // modal rail, which must not receive the same key's default dismiss action.
  // Propagation must also stop before the tagger's global shortcut handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = (event.target as Element | null)?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-ink/40 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${species.commonName} reference image`}
    >
      <div
        className="w-full max-w-[720px] bg-panel border border-rule shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-4 py-3 border-b border-rule">
          <div className="min-w-0">
            <div className="text-[15px] text-ink truncate">{species.commonName}</div>
            <div className="text-[12px] text-inkMute font-mono italic truncate">
              {species.scientificName}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto w-11 h-11 md:w-8 md:h-8 grid place-items-center text-[18px] leading-none text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            title="Close (Esc)"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-4 grid place-items-center">
          {species.iconUrl && !failed ? (
            <img
              src={species.iconUrl}
              alt={species.commonName}
              onError={() => setFailed(true)}
              className="max-w-full max-h-[70svh] object-contain bg-paperHover border border-rule"
            />
          ) : (
            <div className="w-full h-48 grid place-items-center font-mono text-[13px] text-inkMute bg-paperHover border border-rule">
              No reference image
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
