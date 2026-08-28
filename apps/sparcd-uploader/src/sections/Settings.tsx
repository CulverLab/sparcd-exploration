import { useEffect, useRef, useState } from 'react';
import { OfflineBanner } from '@sparcd/auth-ui';
import { useStore } from '../store';
import { sanitizeUploaderUser } from '../lib/normalize';
import { listResumable } from '../lib/db';
import { parseShardEndpoints } from '../lib/s3';
import { resetLocalState } from '../lib/reset';

export function Settings() {
  const s3Config = useStore((s) => s.s3Config);
  const disconnect = useStore((s) => s.disconnect);
  const setSection = useStore((s) => s.setSection);
  const uploaderUser = useStore((s) => s.uploaderUser);
  const setUploaderUser = useStore((s) => s.setUploaderUser);
  const concurrencyMode = useStore((s) => s.concurrencyMode);
  const setConcurrencyMode = useStore((s) => s.setConcurrencyMode);
  const concurrency = useStore((s) => s.uploadConcurrency);
  const setConcurrency = useStore((s) => s.setUploadConcurrency);
  const shardEndpoints = useStore((s) => s.shardEndpoints);
  const setShardEndpoints = useStore((s) => s.setShardEndpoints);
  const slug = sanitizeUploaderUser(uploaderUser);

  // The textarea holds raw text while it is being typed; committing normalizes
  // it to bare origins, which is all a client is ever built from. Anything that
  // can't be reduced to one is named back to the user rather than dropped
  // quietly — this is the list signed uploads get striped across.
  const [shardDraft, setShardDraft] = useState(shardEndpoints);
  const [rejectedShards, setRejectedShards] = useState<string[]>([]);

  // Adopting another tab's connection replaces the endpoints under a mounted
  // Settings. Without this the draft still holds the previous provider's
  // origins and the next blur writes them back. Tracked against what we last
  // wrote so a save's own store update doesn't wipe the rejected list it just
  // produced.
  const saved = useRef(shardEndpoints);
  useEffect(() => {
    if (shardEndpoints === saved.current) return;
    saved.current = shardEndpoints;
    setShardDraft(shardEndpoints);
    setRejectedShards([]);
  }, [shardEndpoints]);

  function saveShards() {
    const { origins, rejected } = parseShardEndpoints(shardDraft);
    const normalized = origins.join(', ');
    saved.current = normalized;
    setShardDraft(normalized);
    setShardEndpoints(normalized);
    setRejectedShards(rejected);
  }

  // Logout clears all local data so the next user gets a clean app. Guard it:
  // if there are resumable (incomplete) uploads, confirm before wiping them.
  const [pendingResumable, setPendingResumable] = useState<number | null>(null);

  async function logout() {
    const open = await listResumable();
    if (open.length > 0) {
      setPendingResumable(open.length);
      return;
    }
    await wipeAndLogout();
  }

  async function wipeAndLogout() {
    disconnect(); // nulls the (sessionStorage-persisted) connection first
    await resetLocalState(); // clears IndexedDB, then reloads to the gate
  }

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto space-y-8">
      <OfflineBanner />
      <section>
        <h2 className="font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft mb-3">
          Connection
        </h2>
        <div className="border border-rule bg-panel p-5 space-y-3">
          <p className="font-body text-[14px] text-inkSoft">
            Connected to{' '}
            <span className="font-mono text-ink">{s3Config?.endpoint}</span>{' '}
            (region <span className="font-mono text-ink">{s3Config?.region}</span>).
          </p>
          <button
            onClick={() => void logout()}
            className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Disconnect / edit
          </button>
          <p className="font-body text-[12px] text-inkMute">
            Clears this browser's local upload sessions so the next person connects to a clean app.
          </p>
        </div>
      </section>

      <section>
        <h2 className="font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft mb-3">
          Defaults
        </h2>
        <div className="border border-ruleSoft bg-panel p-5 space-y-4">
          <label className="block">
            <span className="block font-body text-[13px] text-inkSoft mb-1.5">Uploader identity</span>
            <input
              value={uploaderUser}
              onChange={(e) => setUploaderUser(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full border border-rule bg-paper px-3 py-2 font-body text-[14px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
            />
            <span className="block font-body text-[12px] text-inkMute mt-1.5">
              Used in upload prefixes and object keys as{' '}
              {slug ? (
                <span className="font-mono text-inkSoft">{slug}</span>
              ) : (
                <span className="italic">a key-safe slug</span>
              )}
              .
            </span>
          </label>
          <div className="block">
            <span className="block font-body text-[13px] text-inkSoft mb-1.5">
              Upload concurrency
            </span>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {(['adaptive', 'manual'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2.5 font-body text-[14px] text-ink">
                  <input
                    type="radio"
                    name="concurrency-mode"
                    checked={concurrencyMode === mode}
                    onChange={() => setConcurrencyMode(mode)}
                    className="accent-accent"
                  />
                  {mode === 'adaptive' ? 'Adaptive (default)' : 'Manual'}
                </label>
              ))}
            </div>
            {concurrencyMode === 'manual' && (
              <div className="flex items-center gap-3 mt-3">
                <label className="font-body text-[13px] text-inkSoft w-28">Parallel lanes</label>
                <input
                  type="range"
                  min={4}
                  max={32}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  className="flex-1 accent-accent"
                />
                <span className="font-mono text-[13px] text-ink w-8 text-right">{concurrency}</span>
              </div>
            )}
            <span className="block font-body text-[12px] text-inkMute mt-1.5">
              Adaptive measures throughput during a run and raises or lowers the number of parallel
              uploads to find the fastest setting for this connection. Manual pins it; the slider
              stays live during a run.
            </span>
          </div>
          <label className="block">
            <span className="block font-body text-[13px] text-inkSoft mb-1.5">Endpoint shards</span>
            <textarea
              value={shardDraft}
              onChange={(e) => setShardDraft(e.target.value)}
              onBlur={saveShards}
              rows={2}
              placeholder="https://proxy:8443, https://proxy:8444"
              className="w-full border border-rule bg-paper px-3 py-2 font-mono text-[13px] text-ink resize-y focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
            />
            {rejectedShards.length > 0 && (
              <span className="block font-body text-[12px] text-warn mt-1.5">
                Not a plain endpoint, so {rejectedShards.length === 1 ? 'it was' : 'they were'}{' '}
                dropped: <span className="font-mono">{rejectedShards.join(', ')}</span>. Use just the
                scheme, host and port — no credentials, path, query or fragment.
              </span>
            )}
            <span className="block font-body text-[12px] text-inkMute mt-1.5">
              Lanes stripe uploads across these additional endpoints — same storage, one browser
              connection each. Leave empty to use only the main endpoint.
            </span>
          </label>
        </div>
      </section>

      {pendingResumable !== null && (
        <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4">
          <div className="w-full max-w-[440px] max-h-[90dvh] overflow-y-auto bg-paper border border-ink shadow-xl">
            <header className="border-b border-rule px-5 h-12 flex items-center">
              <h2 className="font-display text-[18px] text-ink">Unfinished uploads</h2>
            </header>
            <div className="px-5 py-4 space-y-3 text-[14px] text-ink font-body">
              <p>
                You have <span className="font-mono">{pendingResumable}</span> resumable upload
                {pendingResumable === 1 ? '' : 's'} in this browser. Disconnecting clears all local
                data on this machine — you would not be able to resume{' '}
                {pendingResumable === 1 ? 'it' : 'them'}.
              </p>
              <p className="text-inkSoft text-[13px]">
                Finish or resume from History first, or discard and disconnect.
              </p>
            </div>
            <footer className="flex flex-col sm:flex-row sm:justify-end gap-2 border-t border-rule px-5 py-3">
              <button
                onClick={() => setPendingResumable(null)}
                className="text-[13px] border border-rule px-3 py-1.5 text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setPendingResumable(null);
                  setSection('history');
                }}
                className="text-[13px] border border-ink bg-ink text-paper px-3 py-1.5 hover:bg-inkSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Review uploads
              </button>
              <button
                onClick={() => void wipeAndLogout()}
                className="text-[13px] border border-warn text-warn px-3 py-1.5 hover:bg-warn hover:text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Discard &amp; disconnect
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
