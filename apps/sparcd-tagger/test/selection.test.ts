import { describe, it, expect } from 'vitest';
import { rangeSet, toggleIndex, toggleSelectionWithFocus, burstIndexSet, isRangeFullySelected } from '../src/lib/selection';
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
