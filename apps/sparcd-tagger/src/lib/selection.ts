// Pure selection-model helpers, shared by the Overview gestures and the keyboard
// handler. Selection is a `Set<number>` of image indices; with virtualization
// only visible cells mount, so re-deriving membership per visible cell is cheap
// even on a 5,000-image upload (the plan's "index-range selection" perf goal —
// achieved here by combining a small index set with a virtualized grid rather
// than per-cell React state).

import type { BurstGrouping } from './bursts';

/** Inclusive range from `a` to `b` regardless of order (Shift-click range). */
export function rangeSet(a: number, b: number): Set<number> {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const s = new Set<number>();
  for (let i = lo; i <= hi; i++) s.add(i);
  return s;
}

export function visibleRangeSet(indices: number[], a: number, b: number): Set<number> {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return new Set(indices.filter((i) => i >= lo && i <= hi));
}

/** Add `i` if absent, remove it if present (Cmd/Ctrl-click additive toggle). */
export function toggleIndex(set: Set<number>, i: number): Set<number> {
  const next = new Set(set);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  return next;
}

/** Every image index in the burst that contains image `i` (whole-burst select). */
export function burstIndexSet(g: BurstGrouping, i: number): Set<number> {
  const b = g.bursts[g.burstOf[i]];
  if (!b) return new Set();
  return rangeSet(b.start, b.end);
}

/** True when every index in `[start, end]` is selected (band "fully selected" cue). */
export function isRangeFullySelected(start: number, end: number, selected: Set<number>): boolean {
  if (!selected.size) return false;
  for (let i = start; i <= end; i++) if (!selected.has(i)) return false;
  return true;
}
