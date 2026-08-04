import { useEffect } from 'react';
import { Connection, loadPersistedConnection } from '@sparcd/auth-ui';
import { useStore } from './store';
import { Chrome } from './components/Chrome';
import { Browse } from './sections/Browse';
import { Tag } from './sections/Tag';
import { Settings } from './sections/Settings';
import { Recovery } from './sections/Recovery';
import { Placeholder } from './sections/Placeholder';

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
  const selectedUploadPrefix = useStore((s) => s.selectedUploadPrefix);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  if (!s3Config) {
    return (
      <Connection toolName="Tagger" initialConfig={connectPrefill} onConnect={connect} />
    );
  }

  return (
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
  );
}
