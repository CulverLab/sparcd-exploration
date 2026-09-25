import { beforeAll, describe, expect, it } from 'vitest';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  },
});

let useStore: typeof import('../src/store').useStore;

beforeAll(async () => {
  ({ useStore } = await import('../src/store'));
});

describe('display preferences across a disconnect', () => {
  it('keeps the date, time and distance choices, like the theme', () => {
    const store = useStore.getState();
    store.setDateFormat('numeric');
    store.setTimeFormat('12h');
    store.setDistanceUnit('feet');

    useStore.getState().disconnect();

    expect(useStore.getState().dateFormat).toBe('numeric');
    expect(useStore.getState().timeFormat).toBe('12h');
    expect(useStore.getState().distanceUnit).toBe('feet');
    expect(localStorage.getItem('sparcd-tagger-display-preferences')).toContain('feet');
  });
});
