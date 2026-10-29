import { describe, it, expect } from 'vitest';
import {
  rangeSet,
  toggleIndex,
  toggleSelectionWithFocus,
  burstIndexSet,
  isRangeFullySelected,
  nextVisibleIndex,
  nearestVisibleIndex,
} from '../src/lib/selection';
import type { BurstGrouping } from '../src/lib/bursts';

describe('rangeSet', () => {
  it('builds an inclusive range regardless of direction', () => {
    expect([...rangeSet(2, 5)]).toEqual([2, 3, 4, 5]);
    expect([...rangeSet(5, 2)]).toEqual([2, 3, 4, 5]);
    expect([...rangeSet(4, 4)]).toEqual([4]);
  });
});

describe('toggleIndex', () => {
  it('adds when absent and removes when present, without mutating input', () => {
    const a = new Set([1, 2]);
    const b = toggleIndex(a, 3);
    expect([...b].sort()).toEqual([1, 2, 3]);
    expect([...a].sort()).toEqual([1, 2]); // input untouched
    const c = toggleIndex(b, 2);
    expect([...c].sort()).toEqual([1, 3]);
  });
});

describe('burstIndexSet', () => {
  // Two bursts: indices 0-2 and 3-4.
  const grouping: BurstGrouping = {
    bursts: [
      { id: 0, start: 0, end: 2, size: 3, deploymentId: 'd', startTs: '', endTs: '' },
      { id: 1, start: 3, end: 4, size: 2, deploymentId: 'd', startTs: '', endTs: '' },
    ],
    burstOf: [0, 0, 0, 1, 1],
  };

  it('returns every index in the burst containing the given index', () => {
    expect([...burstIndexSet(grouping, 1)]).toEqual([0, 1, 2]);
    expect([...burstIndexSet(grouping, 3)]).toEqual([3, 4]);
  });

  it('returns an empty set for an out-of-range index', () => {
    expect(burstIndexSet(grouping, 99).size).toBe(0);
  });
});

describe('isRangeFullySelected', () => {
  it('is true only when every index in the range is present', () => {
    expect(isRangeFullySelected(0, 2, new Set([0, 1, 2]))).toBe(true);
    expect(isRangeFullySelected(0, 2, new Set([0, 2]))).toBe(false);
    expect(isRangeFullySelected(0, 2, new Set([0, 1, 2, 7]))).toBe(true);
    expect(isRangeFullySelected(0, 2, new Set())).toBe(false);
  });
});

describe('nextVisibleIndex', () => {
  // Matches at 1, 4, 5 — a raw-list gap between 1 and 4 (#442).
  const matches = [1, 4, 5];

  it('steps to the next match by list position, skipping hidden indexes', () => {
    expect(nextVisibleIndex(matches, 1, 1)).toBe(4);
    expect(nextVisibleIndex(matches, 4, 1)).toBe(5);
  });

  it('steps to the previous match the same way', () => {
    expect(nextVisibleIndex(matches, 5, -1)).toBe(4);
    expect(nextVisibleIndex(matches, 4, -1)).toBe(1);
  });

  it('is undefined with no further match in that direction', () => {
    expect(nextVisibleIndex(matches, 5, 1)).toBeUndefined();
    expect(nextVisibleIndex(matches, 1, -1)).toBeUndefined();
  });

  it('finds the next match by position even when focus itself is not a match', () => {
    // The move that's being computed can itself be what just dropped `focus`
    // out of the visible set (tagging the last untagged image under an
    // "untagged" filter) — position must still resolve correctly, not via
    // `indexOf(focus)`, which would be -1 and silently resolve to the first
    // match instead of the next one.
    expect(nextVisibleIndex(matches, 2, 1)).toBe(4);
    expect(nextVisibleIndex(matches, 2, -1)).toBe(1);
  });
});

describe('nearestVisibleIndex', () => {
  const matches = [1, 4, 5];

  it('prefers the first match at or after focus', () => {
    expect(nearestVisibleIndex(matches, 0)).toBe(1);
    expect(nearestVisibleIndex(matches, 2)).toBe(4);
    expect(nearestVisibleIndex(matches, 4)).toBe(4);
  });

  it('falls back to the last match before focus once nothing remains at or after it', () => {
    expect(nearestVisibleIndex(matches, 6)).toBe(5);
  });
});

describe('empty filtered navigation', () => {
  it('has no destination or incidental fallback when no images match', () => {
    expect(nextVisibleIndex([], 4, 1)).toBeUndefined();
    expect(nextVisibleIndex([], 4, -1)).toBeUndefined();
    expect(nearestVisibleIndex([], 4)).toBeUndefined();
  });
});

describe('toggleSelectionWithFocus', () => {
  it('selects the focused image directly without mutating an empty selection', () => {
    const empty = new Set<number>();
    expect([...toggleSelectionWithFocus(empty, 2, 2)]).toEqual([2]);
    expect(empty.size).toBe(0);
  });

  it('includes the focused image when starting selection on a different image', () => {
    expect([...toggleSelectionWithFocus(new Set(), 2, 4)]).toEqual([2, 4]);
  });

  it('deselects the sole selected image on a second click', () => {
    const selected = new Set([2]);
    expect(toggleSelectionWithFocus(selected, 2, 2).size).toBe(0);
    expect([...selected]).toEqual([2]);
  });

  it('adds to an existing selection without inserting an unselected focus', () => {
    const selected = new Set([4]);
    expect([...toggleSelectionWithFocus(selected, 2, 3)]).toEqual([4, 3]);
    expect([...selected]).toEqual([4]);
  });

  it('removes only the clicked image from an existing selection', () => {
    const selected = new Set([2, 4]);
    expect([...toggleSelectionWithFocus(selected, 2, 2)]).toEqual([4]);
    expect([...selected]).toEqual([2, 4]);
  });
});
