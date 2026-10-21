import { keyProfileId } from './speciesKeyProfiles';

/**
 * A browser-local attribution preference associated with one connected login.
 * The login identifier is not a credential secret; never pass secret keys to
 * this module. Custom identity and resolved default are stored separately so
 * a refreshed account name never overwrites a user's choice.
 */
const LEGACY_STORAGE_PREFIX = 'sparcd-login-identity-v1:';
const STORAGE_PREFIX = 'sparcd-login-identity-v2:';
const RECORD_VERSION = 2;

type IdentityRecord = {
  version: typeof RECORD_VERSION;
  /** A custom display name; an exact login-ID override uses the marker below. */
  identity?: string;
  identityUsesLogin?: boolean;
  defaultIdentity?: string;
  defaultSource?: 'whoami' | 'access-key';
};

export type LoginIdentityPreference = {
  customIdentity: string | null;
  defaultIdentity: string | null;
  defaultSource: IdentityRecord['defaultSource'] | null;
};

export type LoginIdentityChange = {
  /** `null` represents `localStorage.clear()`. */
  preferenceKey: string | null;
};

function normalizeLoginIdentifier(loginIdentifier: string | null | undefined): string {
  return loginIdentifier?.trim() ?? '';
}

/** Opaque browser preference key; it never contains the connected Access key. */
export function loginIdentityPreferenceKey(loginIdentifier: string): string {
  return `${STORAGE_PREFIX}${keyProfileId('login-identity', loginIdentifier)}`;
}

function removeExposedLegacyRecords(): void {
  // The old format exposed login IDs in both keys and fallback values. Discard
  // it rather than copying information with no safe retention guarantee.
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Blocked browser storage must not prevent login or identity editing.
  }
}

removeExposedLegacyRecords();

function readRecord(loginIdentifier: string): IdentityRecord | null {
  try {
    removeExposedLegacyRecords();
    const raw = localStorage.getItem(loginIdentityPreferenceKey(loginIdentifier));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<IdentityRecord> | null;
    if (!value || value.version !== RECORD_VERSION) return null;
    return {
      version: RECORD_VERSION,
      identityUsesLogin: value.identityUsesLogin === true || undefined,
      identity: typeof value.identity === 'string' && value.identity.trim() ? value.identity : undefined,
      defaultIdentity: value.defaultSource === 'whoami' && typeof value.defaultIdentity === 'string' && value.defaultIdentity.trim()
        ? value.defaultIdentity
        : undefined,
      defaultSource: value.defaultSource === 'whoami' || value.defaultSource === 'access-key'
        ? value.defaultSource
        : undefined,
    };
  } catch {
    // Storage may be unavailable, or an older/corrupt record may be present.
    return null;
  }
}

function writeRecord(login: string, record: IdentityRecord): boolean {
  try {
    removeExposedLegacyRecords();
    const key = loginIdentityPreferenceKey(login);
    if (!record.identity && !record.identityUsesLogin && !record.defaultSource) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Read the saved custom and resolved default values without inventing a fallback. */
export function loadLoginIdentityPreference(
  loginIdentifier: string | null | undefined,
): LoginIdentityPreference {
  const login = normalizeLoginIdentifier(loginIdentifier);
  const record = login ? readRecord(login) : null;
  return {
    customIdentity: record?.identityUsesLogin ? login : record?.identity ?? null,
    defaultIdentity: record?.defaultSource === 'access-key' ? login : record?.defaultIdentity ?? null,
    defaultSource: record?.defaultSource ?? null,
  };
}

/** Read this login's custom identity or resolved default; unresolved stays blank. */
export function loadLoginIdentity(loginIdentifier: string | null | undefined): string {
  const login = normalizeLoginIdentifier(loginIdentifier);
  if (!login) return '';
  const preference = loadLoginIdentityPreference(login);
  return preference.customIdentity ?? preference.defaultIdentity ?? '';
}

/**
 * Save a custom identity for one login. Empty/whitespace removes the custom
 * override but preserves the resolved default so it returns on blur.
 */
export function saveLoginIdentity(
  loginIdentifier: string | null | undefined,
  identity: string,
): boolean {
  const login = normalizeLoginIdentifier(loginIdentifier);
  if (!login) return false;
  const current = readRecord(login);
  return writeRecord(login, {
    version: RECORD_VERSION,
    identity: identity.trim() && identity !== login ? identity : undefined,
    identityUsesLogin: identity === login || undefined,
    defaultIdentity: current?.defaultIdentity,
    defaultSource: current?.defaultSource,
  });
}

/** Cache a default attribution name without replacing the user's custom value. */
export function saveLoginIdentityDefault(
  loginIdentifier: string | null | undefined,
  identity: string,
  source: NonNullable<IdentityRecord['defaultSource']>,
): boolean {
  const login = normalizeLoginIdentifier(loginIdentifier);
  if (!login || !identity.trim()) return false;
  const current = readRecord(login);
  return writeRecord(login, {
    version: RECORD_VERSION,
    identity: current?.identity,
    identityUsesLogin: current?.identityUsesLogin,
    defaultIdentity: source === 'whoami' ? identity : undefined,
    defaultSource: source,
  });
}

/** Subscribe to identity changes made in another same-origin tab/app. */
export function subscribeLoginIdentityChanges(
  listener: (change: LoginIdentityChange) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === null) {
      listener({ preferenceKey: null });
      return;
    }
    if (!event.key.startsWith(STORAGE_PREFIX)) return;
    listener({ preferenceKey: event.key });
  };

  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
