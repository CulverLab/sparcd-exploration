import { localBatchId } from '../lib/localBatch';
import { useEffect, useRef } from 'react';

// The `?` keyboard cheatsheet. Mirrors the plan's "Keyboard shortcuts (initial
// set)" table; the actual handling lives in Tag.tsx so this stays a passive
// reference card. Closes on backdrop click, the × button, Escape, or `?` again
// (the last two are handled by Tag's global key handler).

type Shortcut = { keys: string[]; action: string };

const GROUPS: { title: string; rows: Shortcut[] }[] = [
  {
    title: 'Navigate',
    rows: [
      { keys: ['↓', '→'], action: 'Next image' },
      { keys: ['↑', '←'], action: 'Previous image' },
      { keys: ['PgDn'], action: 'Next burst' },
      { keys: ['PgUp'], action: 'Previous burst' },
      { keys: ['Enter'], action: 'Open focused image (Overview)' },
      { keys: ['/'], action: 'Find image by filename' },
    ],
  },
  {
    title: 'Tag',
    rows: [
      { keys: ['Space'], action: 'Open species filter' },
      { keys: ['Enter'], action: 'Add top displayed species result (add-only)' },
      { keys: ['key'], action: 'Add the species bound to that key' },
      { keys: ['✕'], action: 'Chip ✕ removes one; Clear Species clears all' },
      { keys: ['⇧Space'], action: 'Toggle Need expert' },
    ],
  },
  {
    title: 'Select & save',
    rows: [
      { keys: ['⌘A', '^A'], action: 'Select the current burst' },
      { keys: ['Esc'], action: 'Clear selection / blur filter' },
      { keys: ['⌘S', '^S'], action: 'Finish valid input and flush or retry automatic saving' },
      { keys: ['⌘Z', '^Z'], action: 'Undo the latest completed action outside text editors' },
      { keys: ['?'], action: 'Toggle this cheatsheet' },
    ],
  },
];

export function Cheatsheet({ onClose }: { onClose: () => void }) {
  const automatic = !localBatchId;
  const groups = automatic ? GROUPS : GROUPS.map(group => ({ ...group, rows: group.rows.filter(row => !row.keys.includes('⌘Z')).map(row => row.keys.includes('⌘S') ? { ...row, action: 'Save local work in this browser' } : row) }));
  const closeRef = useRef<HTMLButtonElement>(null);
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
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-full max-w-[640px] max-h-[90dvh] overflow-y-auto bg-paper border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <h2 className="font-display text-[18px] font-[600] text-ink">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            className="w-11 h-11 md:w-7 md:h-7 grid place-items-center border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 p-5">
          {groups.map((g) => (
            <section key={g.title} className="min-w-0">
              <h3 className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft mb-2">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.rows.map((r) => (
                  <li key={r.action} className="flex items-baseline gap-2 text-[13px]">
                    <span className="flex gap-1 shrink-0">
                      {r.keys.map((k) => (
                        <kbd
                          key={k}
                          className="px-1.5 h-5 grid place-items-center border border-ink text-[11px] font-mono text-ink"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-inkSoft font-body">{r.action}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="lg:hidden border-t border-rule px-5 py-3 text-[12px] text-inkSoft font-body">
          These are desktop keyboard accelerators. On touch, use the on-screen
          controls.
        </p>
      </div>
    </div>
  );
}
