import { useAutomaticSave } from '../components/AutomaticSave';
import { useState } from 'react';
import { useStore } from '../store';
import { listDirtyDrafts } from '../lib/db';
import { resetLocalState } from '../lib/reset';

const kicker = 'font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft mb-1.5';
const input =
  'w-full bg-paper border border-rule px-3 py-2 text-[14px] font-mono text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

export function Settings() {
  const identityPersistenceError = useStore((s) => s.identityPersistenceError);
  const identityResolutionStatus = useStore((s) => s.identityResolutionStatus);
  const identityResolutionError = useStore((s) => s.identityResolutionError);
  const beginTaggerIdentityEdit = useStore((s) => s.beginTaggerIdentityEdit);
  const ensureTaggerIdentity = useStore((s) => s.ensureTaggerIdentity);
  const refreshTaggerIdentity = useStore((s) => s.refreshTaggerIdentity);
  const taggerUser = useStore((s) => s.taggerUser);
  const setTaggerUser = useStore((s) => s.setTaggerUser);
  const burstOn = useStore((s) => s.burstGroupingEnabled);
  const setBurstOn = useStore((s) => s.setBurstGrouping);
  const burst = useStore((s) => s.burstThresholdSec);
  const setBurst = useStore((s) => s.setBurstThreshold);
  const dateFormat = useStore((s) => s.dateFormat);
  const setDateFormat = useStore((s) => s.setDateFormat);
  const timeFormat = useStore((s) => s.timeFormat);
  const setTimeFormat = useStore((s) => s.setTimeFormat);
  const distanceUnit = useStore((s) => s.distanceUnit);
  const setDistanceUnit = useStore((s) => s.setDistanceUnit);
  const autoAdvance = useStore((s) => s.autoAdvanceOnTag);
  const setAutoAdvance = useStore((s) => s.setAutoAdvanceOnTag);
  const cfg = useStore((s) => s.s3Config);
  const disconnect = useStore((s) => s.disconnect);
  const setSection = useStore((s) => s.setSection);

  // Logout clears all local data so the next user gets a clean app. Guard it:
  // if there are unsynced drafts, hold the count here and confirm before wiping.
  const [pendingDirty, setPendingDirty] = useState<number | null>(null);

  const pendingSave = useAutomaticSave(s => s.view.pending);

  async function logout() {
    if (pendingSave) return;
    if (cfg) { disconnect(); return; }
    const dirty = await listDirtyDrafts();
    if (dirty.length > 0) {
      setPendingDirty(dirty.length);
      return;
    }
    await wipeAndLogout();
  }

  async function wipeAndLogout() {
    if (pendingSave) return;
    disconnect(); // nulls the (sessionStorage-persisted) connection first
    await resetLocalState(); // clears IndexedDB + keybindings, then reloads to the gate
  }

  return (
    <div className="max-w-[560px] mx-auto p-8 space-y-8">
      <section>
        <label htmlFor="user" className={kicker}>
          {cfg ? 'Tagger Identity' : 'Local batch identity'}
        </label>
        <input
          id="user"
          className={input}
          placeholder="e.g. jgonzalez"
          value={taggerUser}
          onChange={(e) => setTaggerUser(e.target.value)}
          onFocus={beginTaggerIdentityEdit}
          onBlur={() => { if (cfg) ensureTaggerIdentity(); }}
          aria-describedby="tagger-identity-help tagger-identity-status"
          aria-invalid={!!cfg && identityResolutionStatus === 'error' && !taggerUser.trim()}
          autoComplete="off"
          spellCheck={false}
        />
        <p id="tagger-identity-help" className="mt-1.5 text-[13px] text-inkMute font-body">
          {cfg
            ? 'Shared with Uploader for this login. Used for new identifications and review events. Clearing the custom name restores the resolved account name when you leave this field.'
            : 'Optional attribution for this local batch. You can return to Uploader with Done even when identity is blank.'}
        </p>
        <div id="tagger-identity-status">
          {cfg && identityPersistenceError && <p role="alert" className="text-[13px] text-warn">This identity could not be saved in this browser. It remains usable in this session but may reset on reload.</p>}
          {cfg && identityResolutionStatus === 'loading' && <p role="status" className="text-[13px] text-inkSoft">Checking the connected account’s attribution name…</p>}
          {cfg && identityResolutionError && <div role="alert" className="text-[13px] text-warn">
            <p>{identityResolutionError}</p>
            <p>{taggerUser.trim() ? 'Your current identity remains available.' : 'Enter a custom identity or retry before making attributed changes.'}</p>
            <button type="button" onClick={() => void refreshTaggerIdentity()} className="min-h-11 underline">Retry account-name lookup</button>
          </div>}
        </div>
      </section>

      <section>
        <span className={kicker}>Auto-advance</span>
        <label className="flex items-center gap-2.5 min-h-11 md:min-h-0 font-body text-[14px] text-ink">
          <input
            type="checkbox"
            className="w-5 h-5 md:w-4 md:h-4 accent-accent"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
          />
          Move to the next image after assigning a species
        </label>
        <p className="mt-1.5 text-[13px] text-inkMute font-body">
          On by default. When on, an assignment advances the focused image in the current list
          order. An assignment across a selection still advances Focus only once.
        </p>
      </section>

      <div role="group" aria-label="Display preferences" className="border-t border-ruleSoft pt-6 space-y-8">
        <section>
          <span className={kicker}>Date format</span>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {(
              [
                { value: 'long', label: 'Month Day Year' },
                { value: 'short', label: 'Month Day Short Year' },
                { value: 'numeric', label: 'Numeric date' },
                { value: 'iso-local', label: 'ISO local date' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 min-h-11 md:min-h-0 font-body text-[14px] text-ink"
              >
                <input
                  type="radio"
                  name="dateFormat"
                  className="w-5 h-5 md:w-4 md:h-4 accent-accent"
                  checked={dateFormat === opt.value}
                  onChange={() => setDateFormat(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </section>

        <section>
          <span className={kicker}>Time format</span>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {(
              [
                { value: '24h', label: '24-hour' },
                { value: '24h-seconds', label: '24-hour with seconds' },
                { value: '12h', label: '12-hour (AM/PM)' },
                { value: '12h-seconds', label: '12-hour with seconds (AM/PM)' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 min-h-11 md:min-h-0 font-body text-[14px] text-ink"
              >
                <input
                  type="radio"
                  name="timeFormat"
                  className="w-5 h-5 md:w-4 md:h-4 accent-accent"
                  checked={timeFormat === opt.value}
                  onChange={() => setTimeFormat(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </section>

        <section>
          <span className={kicker}>Distance units</span>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {(
              [
                { value: 'meters', label: 'Meters' },
                { value: 'feet', label: 'Feet' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 min-h-11 md:min-h-0 font-body text-[14px] text-ink"
              >
                <input
                  type="radio"
                  name="distanceUnit"
                  className="w-5 h-5 md:w-4 md:h-4 accent-accent"
                  checked={distanceUnit === opt.value}
                  onChange={() => setDistanceUnit(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[13px] text-inkMute font-body">
            Sets the unit emphasized when a location's elevation is shown.
          </p>
        </section>

      </div>

      <div role="group" aria-label="Burst preferences" className="border-t border-ruleSoft pt-6 space-y-8">
        <section>
          <span className={kicker}>Burst grouping</span>
          <label className="flex items-center gap-2.5 min-h-11 md:min-h-0 font-body text-[14px] text-ink">
            <input
              type="checkbox"
              className="w-5 h-5 md:w-4 md:h-4 accent-accent"
              checked={burstOn}
              onChange={(e) => setBurstOn(e.target.checked)}
            />
            Group rapid sequences into bursts
          </label>
          <p className="mt-1.5 text-[13px] text-inkMute font-body">
            Off by default — our cameras shoot no bursts, so the Overview stays a flat strip. Turn it
            on for cameras that fire sequences and the strip gains burst bands plus whole-burst
            selection.
          </p>
          {burstOn && (
            <div className="mt-4 pl-6 border-l border-ruleSoft">
              <label htmlFor="burst" className={kicker}>
                Threshold — {burst}s
              </label>
              <input
                id="burst"
                type="range"
                min={5}
                max={600}
                step={5}
                value={burst}
                onChange={(e) => setBurst(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <p className="mt-1.5 text-[13px] text-inkMute font-body">
                Images within this window on one camera group into a burst.
              </p>
            </div>
          )}
        </section>

      </div>

      <section className="border-t border-ruleSoft pt-6">
        <span className={kicker}>Connection</span>
        {cfg ? (
          <>
            <p className="text-[13px] font-mono text-inkSoft break-all">{cfg.endpoint}</p>
            <p className="text-[13px] text-inkSoft">Access key: <span aria-label="Connected Access key" className="font-mono">{cfg.accessKey.length <= 6 ? '••••••' : `${cfg.accessKey.slice(0, 3)}…${cfg.accessKey.slice(-3)}`}</span></p>
            <button
              aria-describedby="disconnect-help"
              disabled={pendingSave}
              onClick={() => void logout()}
              className="mt-3 inline-flex items-center min-h-11 md:min-h-0 text-[14px] border border-ink px-3 py-2.5 md:py-1.5 text-ink hover:bg-panelHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Disconnect
            </button>
            <p id="disconnect-help" className="mt-2 text-[13px] text-inkMute font-body">
              Logs you out after pending saves finish. Your saved Undo remains scoped to this account in this browser. Disconnect before leaving a shared or public computer.
            </p>
          </>
        ) : (
          <p className="text-[13px] text-inkMute font-body">
            Local batch — no storage connection. Return to the Uploader with Done when tagging is
            complete.
          </p>
        )}
      </section>

      {pendingDirty !== null && (
        <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-4">
          <div className="w-full max-w-[440px] max-h-[90dvh] overflow-y-auto bg-paper border border-ink shadow-xl">
            <header className="border-b border-rule px-5 h-12 flex items-center">
              <h2 className="font-display text-[18px] text-ink">Unsynced local edits</h2>
            </header>
            <div className="px-5 py-4 space-y-3 text-[14px] text-ink font-body">
              <p>
                You have <span className="font-mono">{pendingDirty}</span> unsynced tag
                {pendingDirty === 1 ? '' : 's'} in this browser. Disconnecting clears all local data
                on this machine — those edits would be lost.
              </p>
              <p className="text-inkSoft text-[13px]">
                Open the upload from Recovery and finish its pending save before disconnecting.
              </p>
            </div>
            <footer className="flex flex-col sm:flex-row sm:justify-end gap-2 border-t border-rule px-5 py-3">
              <button
                onClick={() => setPendingDirty(null)}
                className="w-full sm:w-auto min-h-11 md:min-h-0 text-[13px] border border-rule px-3 py-2.5 md:py-1.5 text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setPendingDirty(null);
                  setSection('history');
                }}
                className="w-full sm:w-auto min-h-11 md:min-h-0 text-[13px] border border-ink bg-ink text-paper px-3 py-2.5 md:py-1.5 hover:bg-inkSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Review unsynced
              </button>
              <button
                onClick={() => void wipeAndLogout()}
                className="w-full sm:w-auto min-h-11 md:min-h-0 text-[13px] border border-warn text-warn px-3 py-2.5 md:py-1.5 hover:bg-warn hover:text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
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
