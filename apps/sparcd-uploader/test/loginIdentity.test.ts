import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loginIdentityPreferenceKey,
  loadLoginIdentity,
  loadLoginIdentityPreference,
  saveLoginIdentityDefault,
  saveLoginIdentity,
  subscribeLoginIdentityChanges,
} from '../../../packages/auth-ui/src/loginIdentity';

const ACCESS_KEY_A = 'AKIATESTKEY0001';
const ACCESS_KEY_B = 'AKIATESTKEY0002';
const keyFor = loginIdentityPreferenceKey;

function memoryStorage() {
  const records = new Map<string, string>();
  return {
    records,
    get length() { return records.size; },
    key: (index: number) => [...records.keys()][index] ?? null,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => void records.set(key, value),
    removeItem: (key: string) => void records.delete(key),
  };
}

const listeners = new Map<string, Set<(event: Event) => void>>();
const windowStub = {
  addEventListener: (type: string, listener: (event: Event) => void) => {
    const handlers = listeners.get(type) ?? new Set();
    handlers.add(listener);
    listeners.set(type, handlers);
  },
  removeEventListener: (type: string, listener: (event: Event) => void) => {
    listeners.get(type)?.delete(listener);
  },
};

let storage = memoryStorage();
let originalStorage: PropertyDescriptor | undefined;
let originalWindow: PropertyDescriptor | undefined;

beforeEach(() => {
  storage = memoryStorage();
  listeners.clear();
  originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('shared per-login identity preference', () => {
  it('discards exposed legacy records and keeps login IDs out of persisted keys and fallback values', () => {
    storage.records.set(`sparcd-login-identity-v1:${ACCESS_KEY_A}`, JSON.stringify({ version: 1, identity: 'Old Custom' }));
    storage.records.set(`sparcd-login-identity-v1:${ACCESS_KEY_B}`, JSON.stringify({ version: 1, defaultIdentity: ACCESS_KEY_B }));
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('');
    expect([...storage.records.keys()]).toEqual([]);
    saveLoginIdentityDefault(ACCESS_KEY_A, ACCESS_KEY_A, 'access-key');
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe(ACCESS_KEY_A);
    expect(JSON.stringify([...storage.records])).not.toContain(ACCESS_KEY_A);
    saveLoginIdentity(ACCESS_KEY_A, ACCESS_KEY_A);
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe(ACCESS_KEY_A);
    expect(JSON.stringify([...storage.records])).not.toContain(ACCESS_KEY_A);
  });

  it('keeps an unresolved default blank and stores custom identities separately per login', () => {
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('');
    expect(loadLoginIdentity(ACCESS_KEY_B)).toBe('');

    expect(saveLoginIdentity(ACCESS_KEY_A, 'Ada Lovelace')).toBe(true);
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('Ada Lovelace');
    expect(loadLoginIdentity(ACCESS_KEY_B)).toBe('');
    expect(JSON.parse(storage.records.get(keyFor(ACCESS_KEY_A))!)).toEqual({
      version: 2,
      identity: 'Ada Lovelace',
    });
    expect(storage.records.has(keyFor(ACCESS_KEY_B))).toBe(false);
  });

  it('removes a blank custom value but preserves a resolved account-name default', () => {
    saveLoginIdentityDefault(ACCESS_KEY_A, 'Account Name', 'whoami');
    saveLoginIdentity(ACCESS_KEY_A, 'Ada');
    expect(saveLoginIdentity(ACCESS_KEY_A, '  ')).toBe(true);
    expect(storage.records.has(keyFor(ACCESS_KEY_A))).toBe(true);
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('Account Name');
    expect(loadLoginIdentityPreference(ACCESS_KEY_A)).toEqual({
      customIdentity: null,
      defaultIdentity: 'Account Name',
      defaultSource: 'whoami',
    });
  });

  it('updates the cached default without overwriting a custom identity', () => {
    expect(saveLoginIdentityDefault(ACCESS_KEY_A, 'First Name', 'whoami')).toBe(true);
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('First Name');
    saveLoginIdentity(ACCESS_KEY_A, 'Ada');
    expect(saveLoginIdentityDefault(ACCESS_KEY_A, 'Updated Name', 'whoami')).toBe(true);
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('Ada');
    expect(loadLoginIdentityPreference(ACCESS_KEY_A).defaultIdentity).toBe('Updated Name');
  });

  it('ignores malformed records and safely replaces them on the next successful save', () => {
    storage.records.set(keyFor(ACCESS_KEY_A), '{broken json');
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('');
    expect(saveLoginIdentity(ACCESS_KEY_A, 'Ada')).toBe(true);
    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('Ada');

    storage.records.set(keyFor(ACCESS_KEY_B), JSON.stringify({ version: 99, identity: 'Wrong version' }));
    expect(loadLoginIdentity(ACCESS_KEY_B)).toBe('');
  });

  it('falls back without throwing when browser storage is unavailable', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new Error('storage denied');
    });

    expect(loadLoginIdentity(ACCESS_KEY_A)).toBe('');
    expect(saveLoginIdentity(ACCESS_KEY_A, 'Ada')).toBe(false);
    expect(saveLoginIdentity(ACCESS_KEY_A, '')).toBe(false);
    expect(saveLoginIdentityDefault(ACCESS_KEY_A, 'Name', 'whoami')).toBe(false);
  });

  it('notifies same-origin app tabs when a login identity record changes or is cleared', () => {
    const changed = vi.fn();
    const unsubscribe = subscribeLoginIdentityChanges(changed);
    const notify = [...(listeners.get('storage') ?? [])][0];
    expect(notify).toBeDefined();

    notify!({ key: keyFor(ACCESS_KEY_A) } as StorageEvent);
    notify!({ key: 'unrelated-preference' } as StorageEvent);
    notify!({ key: null } as StorageEvent);

    expect(changed).toHaveBeenNthCalledWith(1, { preferenceKey: keyFor(ACCESS_KEY_A) });
    expect(changed).toHaveBeenNthCalledWith(2, { preferenceKey: null });
    unsubscribe();
    expect(listeners.get('storage')?.size).toBe(0);
  });
});
