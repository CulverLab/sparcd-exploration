import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { db } from '../lib/db';
import { accountScope, type AutomaticRecord } from '../lib/automaticModel';

/** Recovery is scoped to the connected account. Historical snapshot objects
 * remain in storage; the retired snapshot chooser is not a recovery entry. */
export function Recovery() {
  const cfg = useStore(s => s.s3Config);
  const [records, setRecords] = useState<AutomaticRecord[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    if (cfg) void db.automatic.where('scope').equals(accountScope(cfg)).toArray().then(rows => {
      if (live) setRecords(rows.filter(row => row.actions.length || row.flight || row.adoptionRequired || row.recoveryBranches?.length));
    }).catch(error => { if (live) setError(String(error)); });
    return () => { live = false; };
  }, [cfg]);
  return <section aria-label="Save recovery" className="p-8 space-y-4">
    <h1 className="font-display text-[22px]">Save recovery</h1>
    <p>Pending changes stay in this browser until every required storage write succeeds. Open an upload to resume recovery.</p>
    <p>Older pending Sync or restore work is recovered when you open its upload from Browse and confirm its account and destination.</p>
    {error && <p role="alert">{error}</p>}
    {!records.length && <p>No pending automatic saves for this account.</p>}
    {records.map(record => <div key={record.id} className="border p-3">
      <p>{record.uploadPrefix}</p>
      <button type="button" className="min-h-11 underline" onClick={() => {
        const store = useStore.getState(); store.selectCollection(record.collectionKey); store.selectUpload(record.uploadPrefix);
      }}>Open pending upload</button>
    </div>)}
  </section>;
}
