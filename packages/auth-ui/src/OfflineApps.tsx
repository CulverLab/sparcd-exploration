import { useEffect, useState } from 'react';
const workerUrl = '/sparcd-exploration/offline-worker.js';
export async function offlineAppStatus(worker: ServiceWorker, repair = false): Promise<boolean> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); resolve(false); }, 30_000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data?.ready === true); };
    worker.postMessage({ type: repair ? 'REPAIR' : 'STATUS' }, [channel.port2]);
  });
}
let downloading: Promise<{ ready: boolean; waiting: boolean }> | null = null;
/** One verified download across login/layout remounts. Updates never force activation. */
export function storeOfflineApps(): Promise<{ ready: boolean; waiting: boolean }> {
  if (downloading) return downloading;
  downloading = (async () => {
    const registration = await navigator.serviceWorker.register(workerUrl, { scope: '/sparcd-exploration/', updateViaCache: 'none' });
    await registration.update();
    const installing = registration.installing;
    if (installing) await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); installing.removeEventListener('statechange', changed); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => finish(new Error('Download timed out')), 90_000);
      const changed = () => {
        if (installing.state === 'activated' || (installing.state === 'installed' && registration.active)) finish();
        if (installing.state === 'redundant') finish(new Error('Download failed'));
      };
      installing.addEventListener('statechange', changed); changed();
    });
    const ready = !!registration.active && await offlineAppStatus(registration.active, true);
    if (!ready) throw new Error('Offline download is incomplete');
    await navigator.storage?.persist?.().catch(() => false);
    return { ready, waiting: !!registration.waiting };
  })().finally(() => { downloading = null; });
  return downloading;
}

/** Uploader readiness is automatic, independent of credentials and species data. */
export function OfflineApps() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let current = true;
    const check = async () => {
      const registration = await navigator.serviceWorker.getRegistration('/sparcd-exploration/');
      const ready = !!registration?.active && await offlineAppStatus(registration.active);
      if (!current) return;
      if (!ready && navigator.onLine === false) setMessage('Uploader is not fully available offline. Keep this window open and reconnect to finish downloading. Your saved batch is unchanged.');
      if (navigator.onLine === false) return;
      try {
        const stored = await storeOfflineApps();
        if (current) setMessage(stored.waiting
          ? 'An Uploader update is ready. Finish your work, close all SPARC’d tabs and app windows, then reopen Uploader. Your saved batch is retained.'
          : '');
      } catch {
        if (current) setMessage(ready
          ? 'An Uploader update could not finish downloading. You can keep working. Reconnect to try again; your saved batch is unchanged.'
          : 'Uploader could not finish downloading for offline use. Keep this window open and reconnect to try again. Your files and tags are unchanged.');
      }
    };
    void check().catch(() => { if (current) setMessage('Offline availability could not be checked. Keep this window open and reconnect to try again.'); });
    const online = () => { void check().catch(() => {}); };
    window.addEventListener('online', online);
    return () => { current = false; window.removeEventListener('online', online); };
  }, []);
  return message ? <p role="status" className="p-3 text-sm">{message}</p> : null;
}
