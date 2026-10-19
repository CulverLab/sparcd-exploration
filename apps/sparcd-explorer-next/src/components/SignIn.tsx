import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Connection, loadPersistedConnection } from '@sparcd/auth-ui';
import { readErrorDetails, translateReadError } from '@sparcd/s3-safe';
import type { S3Config } from '@sparcd/types';
import { discoverCollections } from '@/data';
import { connectionPrefill } from '@/lib/connection';
import { parseEndpoint } from '@/lib/endpoint';
import { sourceFor } from '@/lib/opening';
import { useStore } from '@/store';
import { Stepper } from './Stepper';

// Dev-only, non-secret prefill (endpoint only). Secrets are never prefilled.
const devEndpoint = import.meta.env.VITE_SPARCD_S3_ENDPOINT as string | undefined;

const REJECTED = new Set(['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AccessDenied', 'InvalidToken']);

function signInError(err: unknown): string {
  const { code, status } = readErrorDetails(err);
  if ((code && REJECTED.has(code)) || status === 401 || status === 403) return "That username or password didn't work.";
  if (status === undefined) return "We couldn't reach that server. Check the address.";
  return translateReadError(err, 'the list of collections').message;
}

export function SignIn() {
  const signIn = useStore((s) => s.signIn);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read on each visit: signing out keeps a remembered server and username.
  const [prefill] = useState(() => connectionPrefill(devEndpoint, loadPersistedConnection()));

  async function connect(config: S3Config, remember: boolean) {
    const endpoint = parseEndpoint(config.endpoint, config.secure ?? true);
    if (endpoint.problem) {
      setError(`Check the server address. ${endpoint.problem}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const source = sourceFor(config);
      queryClient.setQueryData(['collections', source.account], await discoverCollections(source));
      signIn(config, remember);
    } catch (err) {
      setError(signInError(err));
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="mx-auto grid max-w-[440px] gap-[18px]">
        <Stepper step={1} />
        <Connection
          toolName="Explorer"
          embedded
          initialConfig={prefill}
          onConnect={connect}
          labels={{ accessKey: 'Username', secretKey: 'Password' }}
        />
        {busy && (
          <p role="status" className="fine">
            Signing in…
          </p>
        )}
        {error && (
          <p role="alert" className="field-err">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
