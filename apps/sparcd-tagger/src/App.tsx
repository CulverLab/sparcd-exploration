import { validPreparedSpecies } from '@sparcd/flip';
import { safeReturnUrl } from './lib/siblings';
import { useEffect } from 'react';
import { useOnline, Connection, loadPersistedConnection } from '@sparcd/auth-ui';
import { useStore } from './store';
import { Chrome } from './components/Chrome';
import { Browse } from './sections/Browse';
import { Tag } from './sections/Tag';
import { Settings } from './sections/Settings';
import { Recovery } from './sections/Recovery';
import { Placeholder } from './sections/Placeholder';
import { localBatchId, useLocalBatch } from './lib/localBatch';
import { SpeciesKeyBindingGate } from './components/SpeciesKeyBindingGate';

// Dev-only, non-secret prefill (endpoint only). Secrets are never prefilled.
const devEndpoint = import.meta.env.VITE_SPARCD_S3_ENDPOINT as string | undefined;

// The remembered non-secret fields (endpoint/access key/region/etc.) from a
// prior connection, if any — the secret itself is never persisted, so the
// user always retypes it. Read once; a dev endpoint override wins if set.
const persistedConnection = loadPersistedConnection();
const connectPrefill = { ...persistedConnection, ...(devEndpoint ? { endpoint: devEndpoint } : {}) };

export function App() {
  const online = useOnline();
  const s3Config = useStore((s) => s.s3Config);
  const section = useStore((s) => s.section);
  const connect = useStore((s) => s.connect);
  const theme = useStore((s) => s.theme);
  const selectedUploadPrefix = useStore((s) => s.selectedUploadPrefix);
  const localStatus = useLocalBatch((s) => s.status);
  const localLoadError = useLocalBatch(s => s.loadError);
  const localRecord = useLocalBatch((s) => s.record);
  const loadLocalBatch = useLocalBatch((s) => s.load);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (localBatchId) void loadLocalBatch();
  }, [loadLocalBatch]);

  // A local batch is images that are not in any collection yet, so there is
  // nothing to connect to and the login gate would be a lie. The workspace
  // opens straight onto the record instead.
  if (localBatchId) {
    if (localStatus === 'loading') return <LocalBatchBoot />;
    if (localStatus === 'error') return <main className="p-6"><p role="alert">{localLoadError}</p></main>;
    if (localStatus === 'missing') return <LocalBatchMissing />;
    if (!validPreparedSpecies(localRecord?.preparedSpecies)) return <main className="p-6 space-y-4"><h1 className="text-xl">Prepare species before local tagging</h1><p role="alert">Tagging requires species prepared online for this batch. Your inspected files and existing tags are unchanged. Return to Uploader and prepare a collection’s species list.</p><a className="underline" href={safeReturnUrl(localRecord?.returnUrl ?? '', window.location.origin)}>Back to Uploader</a></main>;
    return (
      <SpeciesKeyBindingGate>
        <Chrome>
          {section === 'settings' ? <Settings /> : <Tag />}
        </Chrome>
      </SpeciesKeyBindingGate>
    );
  }

  if (!online) return <main className="p-6"><h1>Connect to use standalone Tagger</h1><p role="alert">Offline tagging is available only for a batch prepared in Uploader. Reopen your saved batch from Uploader; collection browsing and Assign require a connection.</p><a className="underline" href="../uploader/">Open Uploader</a></main>;

  if (!s3Config) {
    return (
      <Connection toolName="Tagger" initialConfig={connectPrefill} onConnect={connect} />
    );
  }

  return (
    <SpeciesKeyBindingGate>
      <Chrome>
        {section === 'browse' && <Browse />}
        {section === 'tag' &&
          (selectedUploadPrefix ? (
            <Tag />
          ) : (
            <Placeholder title="Tag workspace" phase="P1 – P3">
              Choose an upload in Browse to start tagging.
            </Placeholder>
          ))}
        {section === 'history' && <Recovery />}
        {section === 'settings' && <Settings />}
      </Chrome>
    </SpeciesKeyBindingGate>
  );
}

function LocalBatchBoot() {
  return (
    <div className="h-[100dvh] bg-paper grid place-items-center">
      <p className="font-body text-[15px] text-inkMute">Opening the batch…</p>
    </div>
  );
}

// The two tools share a record only because they share an origin. In
// development they don't — the uploader is on one dev server and the tagger on
// another — so this is the expected view when a hand-off is tried there.
function LocalBatchMissing() {
  const reason = useLocalBatch(s => s.loadError);
  return (
    <div className="h-[100dvh] bg-paper grid place-items-center px-6">
      <div className="border border-rule bg-panel px-6 py-8 max-w-[560px] space-y-4">
        <h1 className="font-display text-[20px] font-[600] text-ink">No such batch</h1>
        <p className="font-body text-[14px] text-inkSoft">
          {reason}
          Uploader and Tagger can share a batch only when served from the same origin.
          Browser storage may have been
          cleared, or the link may belong to another device or origin. Return to Uploader and
          reselect your originals. Tags not saved elsewhere cannot be recovered from missing storage.
        </p>
        <a className="underline" href="../uploader/">Back to Uploader</a>
      </div>
    </div>
  );
}
