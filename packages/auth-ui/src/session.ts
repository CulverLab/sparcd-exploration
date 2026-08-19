import type { S3Config } from '@sparcd/types';

/**
 * Shared S3 session across every SPARC'd tool on one origin.
 *
 * The secret key is NEVER written to disk — only `PersistedConnection`
 * (everything except `secretKey`) lives in localStorage, purely so a reload
 * can pre-fill the Connect form without asking the user to retype the
 * endpoint/access key/region. The full config (secret included) is only ever
 * held in memory and relayed live to OTHER TABS ALREADY OPEN in this browser
 * session via BroadcastChannel — never persisted, so a tab opened later (or
 * after a reload) can't retroactively pick it up and always has to ask the
 * user for the secret again.
 */
const STORAGE_KEY = 'sparcd-connection';
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

/** Persists the non-secret fields and live-relays the full config (secret
 *  included) to any other tab open right now — nothing secret ever hits disk. */
export function saveSharedConnection(cfg: S3Config): void {
  const { secretKey: _secretKey, ...persisted } = cfg;
  savePersistedConnection(persisted);
  liveConfig = cfg;
  getChannel()?.postMessage({ type: 'connect', config: cfg } satisfies LiveMessage);
}

export function clearSharedConnection(): void {
  clearPersistedConnection();
  liveConfig = null;
  getChannel()?.postMessage({ type: 'disconnect' } satisfies LiveMessage);
}

/**
 * Fire `cb` whenever another tab connects/disconnects live. `getCurrentConfig`
 * lets this tab answer a `request` from a tab that just opened (it has no
 * persisted secret to fall back on, so it asks whoever's already connected).
 * Also fires its own `request` immediately on subscribe, so a freshly opened
 * tab picks up an already-connected session from a sibling tab without ever
 * touching disk. Returns an unsubscribe function.
 */
export function subscribeSharedConnection(
  cb: (cfg: S3Config | null) => void,
  getCurrentConfig: () => S3Config | null,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent<LiveMessage>) => {
    if (e.data.type === 'connect') {
      cb(e.data.config);
    } else if (e.data.type === 'disconnect') {
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
