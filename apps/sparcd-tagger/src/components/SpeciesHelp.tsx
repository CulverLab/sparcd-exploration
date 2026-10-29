import { useEffect, useRef } from 'react';

// The "ⓘ" popup beside "Available species". Mirrors Cheatsheet.tsx's dismissal
// behavior (backdrop click, the × button, Escape, focus trap) since that's
// already the established pattern for a small informational overlay here.

export function SpeciesHelp({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-ink/40 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Using the species list"
    >
      <div
        className="w-full max-w-[520px] max-h-[90dvh] overflow-y-auto bg-paper border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <h2 className="font-display text-[18px] font-[600] text-ink">Using the species list</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            className="w-11 h-11 md:w-7 md:h-7 grid place-items-center border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4 text-[13px] text-inkSoft font-body">
          <p>
            Each row is one species: its reference photo, common and scientific name, and (on
            the right) the keyboard key assigned to it, if any.
          </p>

          <section>
            <h3 className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft mb-1.5">
              Applying a species
            </h3>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                Click <strong className="text-ink">+</strong> to add it to the focused image (or
                every selected image, if more than one is selected).
              </li>
              <li>Press its assigned key — the fastest way once you know the keys.</li>
              <li>
                Drag it onto an image to add it there.
              </li>
              <li>
                Type to filter the visible list. Enter adds the top displayed result, including
                close spelling matches. An empty filter or a search with no results adds nothing.
              </li>
              <li>A ✓ means that species is already on the focused image.</li>
            </ul>
          </section>

          <section>
            <h3 className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft mb-1.5">
              Reference photos
            </h3>
            <p>Click a thumbnail to see the reference image enlarged.</p>
          </section>

          <section>
            <h3 className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft mb-1.5">
              Keyboard keys
            </h3>
            <p>
              Hover (or focus) a row to assign or change its key, or to clear it. A
              struck-through key means another species is already using it.
            </p>
          </section>

          <section>
            <h3 className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft mb-1.5">
              List order
            </h3>
            <p>
              By default the list stays sorted alphabetically by common name. Turn on "Sort by
              latest species assigned" in Settings to float recently applied species to the top
              instead.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
