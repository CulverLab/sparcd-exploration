import { useEffect, useState } from 'react';
import { useOnline } from '@sparcd/auth-ui';
import type { CollectionRef } from '@sparcd/s3-safe';
import { useStore } from '../store';
import { checkOfficialSpecies } from '../lib/preparedSpecies';
import { WorkflowNotice } from './WorkflowNotice';

/** Compare fresh online data without replacing a batch's saved catalog or tags. */
export function PreparedAssignmentGate({ collection, onReady }: { collection: CollectionRef | null; onReady: (ready: boolean) => void }) {
  const cfg = useStore(s => s.s3Config);
  const files = useStore(s => s.files);
  const tags = JSON.stringify(files.flatMap(file => file.preTags ?? []));
  const online = useOnline();
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setWarning(''); setMessage(''); onReady(false);
    if (!online || !cfg || !collection) return;
    if (JSON.parse(tags).length === 0) { onReady(true); return; }
    setMessage('Checking species against the current official list…');
    void checkOfficialSpecies(cfg, collection, JSON.parse(tags)).then(missing => {
      if (!current) return;
      if (missing.length) {
        const text = `Resolve these species before uploading because they are not in the current official collection or master list: ${missing.join(', ')}. Return to Inspect to review the identifications. Your tags and counts have been kept.`;
        setMessage(text); setWarning(text);
      } else { setMessage('Species checked against the current official list.'); onReady(true); }
    }).catch(() => {
      if (current) setMessage('The current species list could not be checked. Reconnect and retry before uploading. Your tags are unchanged.');
    });
    return () => { current = false; };
  }, [cfg, collection, tags, online, retry, onReady]);
  if (JSON.parse(tags).length === 0) return null;
  return <section aria-label="Species review" className="space-y-2 text-sm">
    <p role="status">{message || 'Connect online and select a collection to check species.'}</p>
    <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 border border-ink px-3">Check species again</button>
    {warning && <WorkflowNotice title="Resolve species before uploading" onClose={() => setWarning('')}><p>{warning}</p></WorkflowNotice>}
  </section>;
}
