import type { S3Config } from '@sparcd/types';

/**
 * Shared S3 session across every SPARC'd tool on one origin.
 *
 * The secret key never reaches localStorage. Only `PersistedConnection`
 * (everything except `secretKey`) lives there, purely so the Connect form can
 * be pre-filled with the endpoint/access key/region on a machine where no
 * session is running.
 *
 * The full config, secret included, is kept two places, both of which die with
 * the tab: a module-level value for this tab's own synchronous reads, and a
 * tab-scoped sessionStorage stash so the session survives navigating between
 * SPARC'd tools in this tab (the BrandSwitcher) and reloading the page.
 * BroadcastChannel relays the same config live to OTHER TABS, which is how a
 * freshly opened tab — with its own empty sessionStorage — picks up a session
 * that is already running, and keeps it: what arrives over the channel is
 * stashed in that tab too. Close every tab and the secret is gone.
 */
const STORAGE_KEY = 'sparcd-connection';
const SESSION_KEY = 'sparcd-connection-tab';
const CHANNEL_NAME = 'sparcd-connection-live';

export type PersistedConnection = Omit<S3Config, 'secretKey'>;

type LiveMessage =
  | { type: 'connect'; config: S3Config }
  | { type: 'disconnect' }
  | { type: 'request' };

/** Non-secret fields only — safe to read back to pre-fill the Connect form. */
export function loadPersistedConnection(): PersistedConnection | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedConnection;
  } catch {
    return null;
  }
}

function savePersistedConnection(cfg: PersistedConnection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable (private mode / quota) — nothing to do */
  }
}

function clearPersistedConnection(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function saveSessionConnection(cfg: S3Config): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable (private mode / quota) — nothing to do */
  }
}

function clearSessionConnection(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

// A BroadcastChannel object never receives the messages it posts itself —
// correct for `subscribeSharedConnection`'s cross-tab job, but it means
// nothing in THIS tab can learn of THIS tab's own connect that way. An
// event-based fix would still race: `connect()` calls `saveSharedConnection`
// BEFORE the store sets `s3Config`, and `ConnectionChip` only mounts (and
// could only subscribe) AFTER `s3Config` goes non-null — so it's never
// listening in time to catch its own notification. A plain synchronous
// module-level value sidesteps the race entirely: by the time anything
// reads it, `connect()`'s call to `saveSharedConnection` has already
// returned, same call stack, no event to miss.
let liveConfig: S3Config | null = null;

/** The current tab's own live connection, if any — including the secret,
 *  so read this only to answer "am I connected" / "what am I connected to
 *  right now", never to display it. */
export function getLiveConnection(): S3Config | null {
  return liveConfig;
}

/**
 * Restore this tab's session at boot — the full config, secret included, so
 * the caller can seed its own state and skip the Connect screen. Also refills
 * the module-level value, so `getLiveConnection()` agrees from the first read.
 */
export function loadSessionConnection(): S3Config | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    liveConfig = JSON.parse(raw) as S3Config;
  } catch {
    return null;
  }
  return liveConfig;
}

/**
 * Stashes the full config (secret included) in this tab's sessionStorage,
 * live-relays it to any other tab open right now — nothing secret ever hits
 * localStorage — and, only when `remember` is true, persists the non-secret
 * fields so a later reload/restart pre-fills the Connect form.
 * `remember: false` explicitly clears any previously-remembered connection
 * rather than merely skipping the write, so unchecking "Remember me" actually
 * forgets a stale value from an earlier session.
 */
export function saveSharedConnection(cfg: S3Config, remember: boolean): void {
  const { secretKey: _secretKey, ...persisted } = cfg;
  if (remember) savePersistedConnection(persisted);
  else clearPersistedConnection();
  saveSessionConnection(cfg);
  liveConfig = cfg;
  getChannel()?.postMessage({ type: 'connect', config: cfg } satisfies LiveMessage);
}

/**
 * Live-relays a disconnect to any other tab open right now. Deliberately
 * does NOT clear a remembered connection — like "remember me" on most sites,
 * the preference is standing and survives an explicit logout; the endpoint/
 * access key stay pre-filled next time. It's only ever cleared by connecting
 * again with "Remember me" unchecked (see `saveSharedConnection`).
 */
export function clearSharedConnection(): void {
  clearSessionConnection();
  liveConfig = null;
  getChannel()?.postMessage({ type: 'disconnect' } satisfies LiveMessage);
}

/**
 * Fire `cb` whenever another tab connects/disconnects live. `getCurrentConfig`
 * lets this tab answer a `request` from a tab that just opened (it has no
 * stash of its own to fall back on, so it asks whoever's already connected).
 * Also fires its own `request` immediately on subscribe, so a freshly opened
 * tab picks up an already-connected session from a sibling tab. What arrives
 * goes into this tab's own stash, making an adopted session as durable here as
 * one the user typed in. Returns an unsubscribe function.
 */
export function subscribeSharedConnection(
  cb: (cfg: S3Config | null) => void,
  getCurrentConfig: () => S3Config | null,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent<LiveMessage>) => {
    // Straight to the private helpers: `saveSharedConnection` would rebroadcast
    // what we just received and bounce the message between tabs forever.
    if (e.data.type === 'connect') {
      saveSessionConnection(e.data.config);
      cb(e.data.config);
    } else if (e.data.type === 'disconnect') {
      clearSessionConnection();
      cb(null);
    } else if (e.data.type === 'request') {
      const current = getCurrentConfig();
      if (current) ch.postMessage({ type: 'connect', config: current } satisfies LiveMessage);
    }
  };
  ch.addEventListener('message', handler);
  ch.postMessage({ type: 'request' } satisfies LiveMessage);
  return () => ch.removeEventListener('message', handler);
}
