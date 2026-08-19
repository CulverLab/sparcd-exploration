import { useEffect, useState } from 'react';

/**
 * Live `navigator.onLine` state, updated on the browser's own `online`/
 * `offline` events. Best-effort: it reflects whether the network adapter
 * thinks it has a link, not whether any specific endpoint is reachable — but
 * it's a reliable enough signal to warn before an action that needs the
 * network, without waiting for that action to fail first.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}
