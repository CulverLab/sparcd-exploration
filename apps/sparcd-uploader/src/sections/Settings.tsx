import { useEffect, useRef, useState } from 'react';
import { OfflineBanner } from '@sparcd/auth-ui';
import { useStore } from '../store';
import { sanitizeUploaderUser } from '../lib/normalize';
import { listResumable } from '../lib/db';
import { resetLocalState } from '../lib/reset';
import { countPreparationsForDiscard, recoveryGuard } from '../lib/preparation';

export function Settings() {
  const s3Config = useStore((s) => s.s3Config);
  const disconnect = useStore((s) => s.disconnect);
  const setLoginDeferred = useStore((s) => s.setLoginDeferred);
  const setSection = useStore((s) => s.setSection);
  const uploaderUser = useStore((s) => s.uploaderUser);
  const setUploaderUser = useStore((s) => s.setUploaderUser);
  const beginUploaderIdentityEdit = useStore((s) => s.beginUploaderIdentityEdit);
  const ensureUploaderIdentity = useStore((s) => s.ensureUploaderIdentity);
  const identityPersistenceError = useStore((s) => s.identityPersistenceError);
  const identityResolutionStatus = useStore((s) => s.identityResolutionStatus);
  const identityResolutionError = useStore((s) => s.identityResolutionError);
  const refreshUploaderIdentity = useStore((s) => s.refreshUploaderIdentity);
  const concurrencyMode = useStore((s) => s.concurrencyMode);
  const setConcurrencyMode = useStore((s) => s.setConcurrencyMode);
  const concurrency = useStore((s) => s.uploadConcurrency);
  const setConcurrency = useStore((s) => s.setUploadConcurrency);
  const slug = sanitizeUploaderUser(uploaderUser);

  // Settings Disconnect is destructive; include pre-upload work and unreadable
  // journals, not only sessions that have already started uploading.
  const [pendingWork, setPendingWork] = useState<{ uploads: number; preparations: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  const warning = useRef<HTMLDialogElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pendingWork && !warning.current?.open) warning.current?.showModal(); }, [pendingWork]);

  async function logout() {
    const guard = recoveryGuard();
    setChecking(true); setDisconnectError('');
    try {
      const [open, preparations] = await Promise.all([listResumable(), countPreparationsForDiscard()]);
      guard();
      if (open.length || preparations) setPendingWork({ uploads: open.length, preparations });
      else await wipeAndLogout();
    } catch { setDisconnectError('Local work could not be checked. Nothing was cleared. Keep this window open and retry Disconnect.'); }
    finally { setChecking(false); }
  }

  async function wipeAndLogout() {
    disconnect(); // nulls the (sessionStorage-persisted) connection first
    await resetLocalState(); // clears IndexedDB, then reloads to the gate
  }

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto space-y-8">
      <OfflineBanner />
      {disconnectError && <p role="alert" className="text-warn">{disconnectError}</p>}
      <section>
        <h2 className="font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft mb-3">
          Connection
        </h2>
        <div className="border border-rule bg-panel p-5 space-y-3">
          {s3Config ? (
            <>
              <p className="font-body text-[14px] text-inkSoft">
                Connected to{' '}
                <span className="font-mono text-ink">{s3Config?.endpoint}</span>{' '}
                (region <span className="font-mono text-ink">{s3Config?.region}</span>).
              </p>
              <button
                ref={disconnectButton}
                onClick={() => void logout()}
                disabled={checking}
                aria-describedby="settings-disconnect-help"
                className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                Disconnect
              </button>
              <p id="settings-disconnect-help" className="font-body text-[12px] text-inkMute">
                Clears this browser’s local upload sessions, saved preparations and prepared species. Originals and files already in S3 are unchanged.
                Remembered connection details remain. Disconnect before leaving a shared or public computer.
              </p>
            </>
          ) : (
            <>
              <p className="font-body text-[14px] text-inkSoft">Not connected to storage.</p>
              <button
                onClick={() => setLoginDeferred(false)}
                className="border border-ink text-ink px-3.5 py-1.5 text-[14px] font-body hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                Connect
              </button>
            </>
          )}
        </div>
      </section>

      <details className="border border-ruleSoft bg-panel">
        <summary className="font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft px-5 py-4 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          Defaults
        </summary>
        <div className="border-t border-ruleSoft p-5 space-y-4">
          <label className="block">
            <span className="block font-body text-[13px] text-inkSoft mb-1.5">Uploader identity</span>
            <input
              id="uploader-identity"
              value={uploaderUser}
              onChange={(e) => setUploaderUser(e.target.value)}
              onFocus={beginUploaderIdentityEdit}
              onBlur={ensureUploaderIdentity}
              aria-describedby={[
                'uploader-identity-help',
                ...(identityPersistenceError ? ['uploader-identity-error'] : []),
                ...(identityResolutionStatus === 'error' ? ['uploader-identity-resolution-error'] : []),
              ].join(' ')}
              aria-invalid={identityResolutionStatus === 'error' && !uploaderUser.trim()}
              placeholder="e.g. John Doe"
              className="w-full border border-rule bg-paper px-3 py-2 font-body text-[14px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
            />
            <span id="uploader-identity-help" className="block font-body text-[12px] text-inkMute mt-1.5">
              Used in upload prefixes and object keys as{' '}
              {slug ? (
                <span className="font-mono text-inkSoft">{slug}</span>
              ) : (
                <span className="italic">a key-safe slug</span>
              )}
              . A blank identity uses this login's account name, or its Access key ID only when the endpoint has no account-name route, after you leave the field.
            </span>
          </label>
          {identityPersistenceError && (
            <p id="uploader-identity-error" role="alert" className="font-body text-[12px] text-warn">
              This identity could not be saved in this browser. It may reset when the page is reloaded.
            </p>
          )}
          {identityResolutionStatus === 'loading' && (
            <p role="status" aria-live="polite" className="font-body text-[12px] text-inkMute">
              Checking the connected account's attribution name…
            </p>
          )}
          {identityResolutionStatus === 'error' && (
            <div id="uploader-identity-resolution-error" role="alert" className="flex flex-wrap items-center gap-2 font-body text-[12px] text-warn">
              <span>{identityResolutionError ?? 'The connected account name is unavailable.'} {uploaderUser.trim()
                ? 'The saved identity remains available.'
                : 'Enter and save a custom identity before assigning an upload.'}</span>
              <button
                type="button"
                onClick={() => void refreshUploaderIdentity()}
                className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Retry account-name lookup
              </button>
            </div>
          )}
        </div>
      </details>

      <details className="border border-ruleSoft bg-panel">
        <summary className="font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft px-5 py-4 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          Advanced
        </summary>
        <div className="border-t border-ruleSoft p-5 space-y-4">
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
                <label htmlFor="upload-concurrency" className="font-body text-[13px] text-inkSoft w-28">Parallel lanes</label>
                <input
                  id="upload-concurrency"
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
        </div>
      </details>

      {pendingWork !== null && (
        <dialog ref={warning} aria-labelledby="disconnect-warning-title" aria-describedby="disconnect-warning-description" onClose={() => { setPendingWork(null); disconnectButton.current?.focus(); }} className="w-[440px] max-w-[calc(100%-2rem)] max-h-[90dvh] p-0 border-0 bg-transparent backdrop:bg-ink/40">
          <div className="w-full max-w-[440px] max-h-[90dvh] overflow-y-auto bg-paper border border-ink shadow-xl">
            <header className="border-b border-rule px-5 h-12 flex items-center">
              <h2 id="disconnect-warning-title" className="font-display text-[18px] text-ink">{pendingWork.uploads ? 'Unfinished uploads' : 'Saved preparations'}</h2>
            </header>
            <div id="disconnect-warning-description" className="px-5 py-4 space-y-3 text-[14px] text-ink font-body">
              {pendingWork.uploads > 0 && <p>
                You have <span className="font-mono">{pendingWork.uploads}</span> resumable upload{pendingWork.uploads === 1 ? '' : 's'} in this browser.
              </p>}
              {pendingWork.preparations > 0 && <p>
                You have <span className="font-mono">{pendingWork.preparations}</span> saved preparation{pendingWork.preparations === 1 ? '' : 's'} in this browser, including any preparations still waiting to save or using an unsupported format. Disconnecting removes their saved timestamps, notes and recovery information.
              </p>}
              <p className="text-inkSoft text-[13px]">
                Disconnecting deletes these local records. Original files and files already in S3 are unchanged. Cancel to keep your work, review it first, or discard and disconnect.
              </p>
            </div>
            <footer className="flex flex-col sm:flex-row sm:justify-end gap-2 border-t border-rule px-5 py-3">
              <button
                autoFocus
                onClick={() => warning.current?.close()}
                className="text-[13px] border border-rule px-3 py-1.5 text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  warning.current?.close();
                  setSection(pendingWork.uploads ? 'history' : 'new');
                }}
                className="text-[13px] border border-ink bg-ink text-paper px-3 py-1.5 hover:bg-inkSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {pendingWork.uploads ? 'Review uploads' : 'Review preparations'}
              </button>
              <button
                onClick={() => { warning.current?.close(); void wipeAndLogout(); }}
                className="text-[13px] border border-warn text-warn px-3 py-1.5 hover:bg-warn hover:text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Discard &amp; disconnect
              </button>
            </footer>
          </div>
        </dialog>
      )}
    </div>
  );
}
