import { useEffect } from 'react';
import { useStore } from '../store';
import { acceptPreparationSpecies } from '../lib/preparation';
import { loadMasterSpecies, refreshMasterSpecies } from '../lib/masterSpecies';

export function AutomaticSpeciesCache() {
  const cfg = useStore(s => s.s3Config);
  const batchToken = useStore(s => s.batchToken);
  useEffect(() => {
    let live = true, generation = 0;
    const run = () => {
      const attempt = ++generation;
      const current = () => live && generation === attempt && useStore.getState().s3Config === cfg;
      void (async () => {
        // Last good data is usable immediately; failures never delete it.
        const saved = await loadMasterSpecies(cfg ?? undefined);
        if (current() && saved) await acceptPreparationSpecies(saved);
        if (!current() || !cfg || navigator.onLine === false) return;
        const fresh = await refreshMasterSpecies(cfg, current);
        if (current() && fresh) await acceptPreparationSpecies(fresh);
      })().catch(() => { /* Choosing tagging explains an unavailable catalog. */ });
    };
    run();
    // Listen directly: even brief reconnects must refresh, independent of React batching.
    window.addEventListener('online', run);
    return () => { live = false; window.removeEventListener('online', run); };
  }, [cfg, batchToken]);
  return null;
}
