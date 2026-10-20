import { useEffect, useState } from 'react';
const workerUrl = '/sparcd-exploration/offline-worker.js';
export async function offlineAppStatus(worker: ServiceWorker, repair = false): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); resolve(false); }, 30_000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data?.ready === true); };
    worker.postMessage({ type: repair ? 'REPAIR' : 'STATUS' }, [channel.port2]);
  });
}
export function OfflineApps({ speciesReady, beforePrepare }: { speciesReady: boolean; beforePrepare?: () => Promise<void> }) {
  const [message, setMessage] = useState('Prepare both apps online before reopening this batch offline.');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    const check = async () => {
      const registration = await navigator.serviceWorker.getRegistration('/sparcd-exploration/');
      const active = registration?.active;
      if (!active) return;
      const complete = await offlineAppStatus(active);
      if (!cancelled) { setReady(complete); setWaiting(!!registration.waiting); setMessage(complete ? 'Both apps are stored for offline use.' : 'Offline app files are incomplete. Prepare again while online.'); }
    };
    void check().catch(() => { if (!cancelled) setMessage('Offline storage could not be checked. Prepare again online.'); });
    window.addEventListener('online', check);
    return () => { cancelled = true; window.removeEventListener('online', check); };
  }, []);
  async function prepare() {
    setBusy(true); setReady(false);
    try {
      if (!('serviceWorker' in navigator)) throw new Error('This browser cannot prepare offline apps. Use a supported secure browser.');
      if (navigator.onLine === false) throw new Error('Reconnect before preparing app files.');
      await beforePrepare?.();
      const registration = await navigator.serviceWorker.register(workerUrl, { scope: '/sparcd-exploration/', updateViaCache: 'none' });
      await registration.update();
      const worker = registration.installing;
      if (worker) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('App preparation timed out. Reconnect and try again.')), 90_000);
        const changed = () => {
          if (worker.state === 'activated' || (worker.state === 'installed' && !!registration.active)) { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(); }
          if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(new Error('App preparation failed. Storage may be full or an app file unavailable. Your batch is unchanged.')); }
        };
        worker.addEventListener('statechange', changed); changed();
      });
      const active = registration.active;
      const complete = !!active && await offlineAppStatus(active, true);
      setReady(complete); setWaiting(!!registration.waiting);
      if (!complete) throw new Error('Offline preparation is incomplete. Keep this tab open, reconnect, and try again.');
      await navigator.storage?.persist?.().catch(() => false);
      setMessage('Both apps are stored for offline use.');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section aria-label="Offline preparation" className="my-3 space-y-2 border border-rule p-3 text-sm">
    <p role="status">{ready && speciesReady ? 'Ready for offline Inspect and local tagging.' : message}</p>
    {ready && !speciesReady && <p>Prepare a collection’s species before local tagging is available offline.</p>}
    <p>Original files stay in your folder. Keep them unchanged; after restarting, reselect the same folder to verify them. Browser storage can be cleared or evicted. Assign and upload require a connection.</p>
    <button type="button" disabled={busy} onClick={() => void prepare()} className="min-h-11 border border-ink px-3 disabled:opacity-50">{busy ? 'Preparing app files…' : 'Prepare apps for offline use'}</button>
    {waiting && <p role="status">An app update is ready. Finish your current work, then close all SPARC’d tabs, windows, and installed app windows (including Home, Explorer, Admin, Uploader, and Tagger), then reopen Uploader to apply it. Your saved local batch is retained.</p>}
  </section>;
}
