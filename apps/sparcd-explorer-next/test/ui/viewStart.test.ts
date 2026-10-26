import { describe, expect, it, vi } from 'vitest';

// An older build remembered the table view; this visit starts with it stored.
const stored = vi.hoisted(() => {
  const data = new Map<string, string>([['sparcd-explorer-view', '"photos"']]);
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    },
  });
  return data;
});

import { useStore } from '../../src/store';

describe('the table view at the start of a visit', () => {
  it('is Locations, whatever an older build remembered, which is forgotten', () => {
    expect(useStore.getState().view).toBe('locations');
    expect(stored.has('sparcd-explorer-view')).toBe(false);
  });
});
