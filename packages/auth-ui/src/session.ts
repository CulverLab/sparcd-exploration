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
const HEAD_KEY = 'sparcd-connection-revision';
const TAB_REVISION_FIELD = '__sparcdRevision';
const PROTOCOL = 1;

type Revision = { counter: number; id: string };
type Head = { protocol: 1; revision: Revision; connected: boolean };
const subscribers = new Set<(cfg: S3Config | null) => void>();
let head: Head | null = null;
let liveRevision: Revision | null = null;

const compare = (a: Revision, b: Revision): number =>
  a.counter - b.counter || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function validRevision(value: unknown): value is Revision {
  const r = value as Revision | null;
  return !!r && Number.isSafeInteger(r.counter) && r.counter >= 0
    && typeof r.id === 'string' && r.id.length > 0;
}

function readJSON(storage: Storage, key: string): unknown {
  try { return JSON.parse(storage.getItem(key) ?? 'null'); } catch { return null; }
}

function storedHead(): Head | null {
  try {
    const value = readJSON(localStorage, HEAD_KEY) as Head | null;
    return value?.protocol === PROTOCOL && validRevision(value.revision)
      && typeof value.connected === 'boolean' ? value : null;
  } catch { return null; }
}

/** Non-secret high-water mark survives app navigation and logout. Concurrent
 * decisions use counter + unique id ordering; receiving/relaying is never a
 * new decision. Repair a lower stored mark after concurrent writers converge. */
function currentHead(): Head | null {
  const stored = storedHead();
  if (stored && (!head || compare(stored.revision, head.revision) > 0)) head = stored;
  if (head && (!stored || compare(head.revision, stored.revision) > 0)) {
    try { localStorage.setItem(HEAD_KEY, JSON.stringify(head)); } catch { /* live ordering still works */ }
  }
  return head;
}

function nextHead(connected: boolean): Head {
  const latest = currentHead();
  return { protocol: PROTOCOL, revision: {
    counter: (latest?.revision.counter ?? 0) + 1,
    id: crypto.randomUUID(),
  }, connected };
}

function validConfig(value: unknown): value is S3Config {
  const cfg = value as S3Config | null;
  return !!cfg && ['endpoint', 'accessKey', 'secretKey', 'region'].every(
    (key) => typeof cfg[key as keyof S3Config] === 'string' && !!cfg[key as keyof S3Config],
  ) && typeof cfg.forcePathStyle === 'boolean'
    && (cfg.secure === undefined || typeof cfg.secure === 'boolean');
}

function sameConfig(a: S3Config | null, b: S3Config | null): boolean {
  return a === b || (!!a && !!b && a.endpoint === b.endpoint && a.region === b.region
    && a.accessKey === b.accessKey && a.secretKey === b.secretKey
    && a.forcePathStyle === b.forcePathStyle && a.secure === b.secure);
}

/** Keep memory, session storage and revision state in one accepted transition.
 * Callers of local connect/disconnect update their own stores synchronously;
 * incoming changes notify every subscriber once. */
function accept(state: Head, cfg: S3Config | null, notify: boolean): boolean {
  const latest = currentHead();
  if (latest && compare(state.revision, latest.revision) < 0) return false;
  const changed = !sameConfig(liveConfig, cfg);
  head = state;
  liveRevision = state.revision;
  try { localStorage.setItem(HEAD_KEY, JSON.stringify(state)); } catch { /* memory only */ }
  liveConfig = cfg;
  if (cfg) saveSessionConnection(cfg, state.revision);
  else clearSessionConnection();
  if (notify && changed) for (const cb of subscribers) cb(cfg);
  return true;
}

/** Explicit local decisions retry revision allocation if another tab advanced
 * the mark; never let a caller proceed after silently dropping its login. */
function publish(cfg: S3Config | null, notify = false): void {
  let state: Head;
  do { state = nextHead(!!cfg); } while (!accept(state, cfg, notify));
  getChannel()?.postMessage(cfg
    ? { ...state, type: 'connect', config: cfg } satisfies LiveMessage
    : { ...state, type: 'disconnect' } satisfies LiveMessage);
}

export type PersistedConnection = Omit<S3Config, 'secretKey'>;

type LiveMessage =
  | (Head & { type: 'connect'; config: S3Config })
  | (Head & { type: 'disconnect' })
  | { type: 'request'; protocol: 1 };

/** Ignore unversioned old-client connections: their freshness cannot be
 * proved. Legacy logout is conservative: honor it and relay a versioned
 * logout so an older app cannot leave newer siblings authenticated. */
function receive(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const envelope = raw as { protocol?: unknown; type?: unknown };
  if (envelope.protocol !== PROTOCOL) {
    if (!('protocol' in envelope) && envelope.type === 'disconnect') publish(null, true);
    return;
  }
  const message = raw as LiveMessage;
  if (message.type === 'request') {
    const latest = currentHead();
    if (!latest) return;
    if (!latest.connected) {
      getChannel()?.postMessage({ ...latest, type: 'disconnect' } satisfies LiveMessage);
    } else if (liveConfig && liveRevision && compare(liveRevision, latest.revision) === 0) {
      getChannel()?.postMessage({ ...latest, type: 'connect', config: liveConfig } satisfies LiveMessage);
    }
    return;
  }
  if (!validRevision(message.revision)) return;
  if (message.type !== 'connect' && message.type !== 'disconnect') return;
  const connected = message.type === 'connect';
  if (message.connected !== connected || (connected && !validConfig(message.config))) return;
  const latest = currentHead();
  if (latest && (compare(message.revision, latest.revision) < 0
    || (compare(message.revision, latest.revision) === 0 && latest.connected !== connected))) return;
  // A revision identifies one decision, not a license to change its credentials.
  if (liveRevision && compare(message.revision, liveRevision) === 0) return;
  accept({ protocol: PROTOCOL, revision: message.revision, connected },
    message.type === 'connect' ? message.config : null, true);
}

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

function saveSessionConnection(cfg: S3Config, revision: Revision): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...cfg, [TAB_REVISION_FIELD]: revision }));
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
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event: MessageEvent<unknown>) => receive(event.data));
  }
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
  let cfg: unknown;
  let revision: unknown;
  try {
    const record = readJSON(sessionStorage, SESSION_KEY);
    if (record && typeof record === 'object') {
      const { [TAB_REVISION_FIELD]: storedRevision, ...config } = record as Record<string, unknown>;
      cfg = config;
      revision = storedRevision;
    }
  } catch { return null; }
  const latest = currentHead();
  if (!validConfig(cfg)) return null;
  if (validRevision(revision)) {
    if (latest && (compare(revision, latest.revision) < 0
      || (compare(revision, latest.revision) === 0 && !latest.connected))) {
      liveConfig = null;
      liveRevision = null;
      clearSessionConnection();
      return null;
    }
    if (!accept({ protocol: PROTOCOL, revision, connected: true }, cfg, false)) {
      liveConfig = null;
      liveRevision = null;
      clearSessionConnection();
      return null;
    }
  } else {
    // Backward-compatible same-tab migration. A raw legacy stash must not
    // supersede an already-versioned connection or logout in another tab.
    if (latest) {
      clearSessionConnection();
      return null;
    }
    // Migration is restoration, not an explicit new login.
    if (!accept(nextHead(true), cfg, false)) {
      clearSessionConnection();
      return null;
    }
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
  publish(cfg);
}

/**
 * Live-relays a disconnect to any other tab open right now. Deliberately
 * does NOT clear a remembered connection — like "remember me" on most sites,
 * the preference is standing and survives an explicit logout; the endpoint/
 * access key stay pre-filled next time. It's only ever cleared by connecting
 * again with "Remember me" unchecked (see `saveSharedConnection`).
 */
export function clearSharedConnection(): void {
  publish(null);
}

/** Subscribe to accepted changes from other tabs. Session replies preserve the
 * original revision and use synchronized live state, never a stale app getter.
 * The second argument is retained for source compatibility with existing apps. */
export function subscribeSharedConnection(
  cb: (cfg: S3Config | null) => void,
  _getCurrentConfig: () => S3Config | null,
): () => void {
  subscribers.add(cb);
  getChannel()?.postMessage({ type: 'request', protocol: PROTOCOL } satisfies LiveMessage);
  return () => { subscribers.delete(cb); };
}
