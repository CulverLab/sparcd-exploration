import { useState } from 'react';
import { useStore } from '../store';
import { listDirtyDrafts } from '../lib/db';
import { resetLocalState } from '../lib/reset';

const kicker = 'font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft mb-1.5';
const input =
  'w-full bg-paper border border-rule px-3 py-2 text-[14px] font-mono text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

// Per the simplified-login design: identity and the dry-run default live in
// Settings, not on the connection gate.
export function Settings() {
  const taggerUser = useStore((s) => s.taggerUser);
  const setTaggerUser = useStore((s) => s.setTaggerUser);
  const dryRun = useStore((s) => s.dryRun);
  const setDryRun = useStore((s) => s.setDryRun);
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

  async function logout() {
    const dirty = await listDirtyDrafts();
    if (dirty.length > 0) {
      setPendingDirty(dirty.length);
      return;
    }
    await wipeAndLogout();
  }

  async function wipeAndLogout() {
    disconnect(); // nulls the (sessionStorage-persisted) connection first
    await resetLocalState(); // clears IndexedDB + keybindings, then reloads to the gate
  }

  return (
    <div className="max-w-[560px] mx-auto p-8 space-y-8">
      <section>
        <label htmlFor="user" className={kicker}>
          Tagger identity
        </label>
        <input
          id="user"
          className={input}
          placeholder="e.g. jgonzalez"
          value={taggerUser}
          onChange={(e) => setTaggerUser(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1.5 text-[13px] text-inkMute font-body">
          Stamps the audit-snapshot path and the mandatory edit comment on every sync. Required
          before a live sync can run.
        </p>
      </section>

      <section>
        <span className={kicker}>Sync default</span>
        <label className="flex items-center gap-2.5 min-h-11 md:min-h-0 font-body text-[14px] text-ink">
          <input
            type="checkbox"
            className="w-5 h-5 md:w-4 md:h-4 accent-accent"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          Dry-run (log writes, change nothing)
        </label>
        <p className="mt-1.5 text-[13px] text-inkMute font-body">
          On by default. While on, Sync previews the canonical writes and a snapshot but changes
          nothing. Turn it off to perform the conditional in-place replacement.
        </p>
      </section>

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

      <section className="border-t border-ruleSoft pt-6">
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
          Not shown anywhere yet — this sets the unit ahead of an upcoming location display.
        </p>
      </section>

      <section className="border-t border-ruleSoft pt-6">
        <span className={kicker}>Connection</span>
        <p className="text-[13px] font-mono text-inkSoft break-all">{cfg?.endpoint}</p>
        <button
          onClick={() => void logout()}
          className="mt-3 inline-flex items-center min-h-11 md:min-h-0 text-[14px] border border-ink px-3 py-2.5 md:py-1.5 text-ink hover:bg-panelHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Disconnect
        </button>
        <p className="mt-2 text-[13px] text-inkMute font-body">
          Clears this browser's local drafts and settings so the next person connects to a clean
          app.
        </p>
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
                Sync them to S3 first (open the upload from History), or discard them and disconnect.
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
