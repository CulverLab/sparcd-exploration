import { useEffect } from 'react';
import { Connection, loadPersistedConnection } from '@sparcd/auth-ui';
import { useStore } from './store';
import { Chrome } from './components/Chrome';
import { NewUpload } from './sections/NewUpload';
import { History } from './sections/History';
import { Settings } from './sections/Settings';

// Dev-only, non-secret prefill (endpoint only). Secrets are never prefilled.
const devEndpoint = import.meta.env.VITE_SPARCD_S3_ENDPOINT as string | undefined;

// The remembered non-secret fields (endpoint/access key/region/etc.) from a
// prior connection, if any — the secret itself is never persisted, so the
// user always retypes it. Read once; a dev endpoint override wins if set.
const persistedConnection = loadPersistedConnection();
const connectPrefill = { ...persistedConnection, ...(devEndpoint ? { endpoint: devEndpoint } : {}) };

export function App() {
  const s3Config = useStore((s) => s.s3Config);
  const section = useStore((s) => s.section);
  const connect = useStore((s) => s.connect);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  if (!s3Config) {
    return (
      <Connection toolName="Uploader" initialConfig={connectPrefill} onConnect={connect} />
    );
  }

  return (
    <Chrome uploadState="ready">
      {section === 'new' && <NewUpload />}
      {section === 'history' && <History />}
      {section === 'settings' && <Settings />}
    </Chrome>
  );
}
