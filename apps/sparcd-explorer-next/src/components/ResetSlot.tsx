import { useEffect, useRef } from 'react';
import { canReset } from '@/data';
import { useStore, type ResetSlot as Slot } from '@/store';

/**
 * Reset filters, in a fixed place. After a reset, Undo takes its place for
 * about 8 s, with focus on it when this slot was the one pressed. The slot
 * keeps its size in every state, so nothing moves.
 */
export function ResetSlot({ slot }: { slot: Slot }) {
  const active = useStore((s) => canReset(s.filters));
  const undo = useStore((s) => s.resetUndo);
  const reset = useStore((s) => s.resetFilters);
  const undoReset = useStore((s) => s.undoReset);
  const resetRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  // Focus follows the button that takes the pressed one's place.
  const hadUndoFocus = useRef(false);
  useEffect(() => {
    if (undo) {
      if (undo.from !== slot) return;
      undoRef.current?.focus({ preventScroll: true });
      // Reset and Undo are one element to React: a Reset that had the focus keeps it, and no focus event comes.
      hadUndoFocus.current = true;
    } else if (hadUndoFocus.current) {
      hadUndoFocus.current = false;
      // Undo ran out, leaving Reset disabled: the Filters toggle takes the focus, or on a phone the open sheet's.
      const to = active ? resetRef.current : document.getElementById(useStore.getState().sheet ? 'closesheet' : 'filtersbtn');
      to?.focus({ preventScroll: true });
    }
  }, [undo, slot]);
  return (
    <div className={slot === 'top' ? 'resetslot topslot' : 'resetslot'}>
      {undo ? (
        <button
          ref={undoRef}
          type="button"
          className={slot === 'top' ? 'btn primary undobtn' : 'btn big primary undobtn'}
          onClick={() => {
            hadUndoFocus.current = true;
            undoReset();
          }}
          onFocus={() => (hadUndoFocus.current = true)}
          onBlur={() => (hadUndoFocus.current = false)}
        >
          Undo
          <i aria-hidden="true" />
        </button>
      ) : (
        <button ref={resetRef} type="button" className={slot === 'top' ? 'btn resetbtn' : 'btn big resetbtn'} disabled={!active} onClick={() => reset(slot)}>
          Reset filters
        </button>
      )}
    </div>
  );
}
