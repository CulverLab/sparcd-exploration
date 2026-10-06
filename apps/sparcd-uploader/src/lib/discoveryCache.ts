// What connecting learned about a store's shape, remembered across sessions.
//
// Discovery is the slowest part of connecting: finding the settings bucket and
// listing collections both mean probing a marker key in every visible bucket,
// which is linear in bucket count and is dead time before the collection picker
// can show anything. The shape it finds barely ever changes, so the answer is
// cached and the picker renders from it immediately while a fresh probe runs in
// the background and reconciles.
//
// Only the *shape* is cached — which bucket holds the settings, and which
// collections exist. The contents (locations.json, and anything under a
// collection) are always read live. Failures are never cached: a probe that
// found nothing leaves the last good answer in place rather than pinning an
// outage.

import type { S3Config } from '@sparcd/types';
import type { CollectionRef } from '@sparcd/s3-safe';

const KEY = 'sparcd-uploader-discovery';
// v2: a CollectionRef carries `buckets` and `dataBucket`. A v1 ref has neither
// and would send an upload to the legacy layout, so v1 entries are dropped.
const VERSION = 2;
// Enough to keep a couple of accounts and endpoints warm without letting the
// entry grow without bound.
const MAX_ACCOUNTS = 4;

export type Discovery = {
  settingsBucket?: string;
  collections?: CollectionRef[];
};

type Entry = Discovery & { at: number };
type Stored = { v: number; accounts: Record<string, Entry> };

// The access key identifies the account and is already persisted by the connect
// form; the secret never appears here.
const accountId = (cfg: S3Config) => `${cfg.endpoint}\0${cfg.accessKey}`;

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Stored) : null;
    if (parsed?.v === VERSION && parsed.accounts) return parsed;
  } catch {
    // Unreadable or from an older shape — start over.
  }
  return { v: VERSION, accounts: {} };
}

function save(stored: Stored): void {
  // Oldest first, keep the tail. Several accounts written inside one
  // millisecond all carry the same `at`, so the stable sort has to fall back to
  // insertion order — which `writeDiscovery` keeps meaningful by re-inserting
  // the account it touched.
  const entries = Object.entries(stored.accounts)
    .sort((a, b) => a[1].at - b[1].at)
    .slice(-MAX_ACCOUNTS);
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, accounts: Object.fromEntries(entries) }));
  } catch {
    // Storage full or blocked. The cache is an optimization; losing it is fine.
  }
}

/** What we last learned about this account's store, if anything. */
export function readDiscovery(cfg: S3Config): Entry | null {
  return load().accounts[accountId(cfg)] ?? null;
}

/** Merge in what a successful probe just found. */
export function writeDiscovery(cfg: S3Config, found: Discovery): void {
  const stored = load();
  const id = accountId(cfg);
  const merged = { ...stored.accounts[id], ...found, at: Date.now() };
  delete stored.accounts[id]; // re-insert so this account is the newest by order too
  stored.accounts[id] = merged;
  save(stored);
}

/**
 * Forget this account's shape so the next probe starts from nothing. Naming a
 * field clears only that one: a refresh control re-runs its own queries, and
 * dropping the half it isn't going to refetch leaves the next warm connect
 * probing for something nobody asked about.
 */
export function clearDiscovery(cfg: S3Config, field?: keyof Discovery): void {
  const stored = load();
  const id = accountId(cfg);
  const entry = stored.accounts[id];
  if (!entry) return;
  if (field) delete entry[field];
  else delete stored.accounts[id];
  save(stored);
}
