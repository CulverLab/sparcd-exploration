import { useStore } from '../store';

export const IDENTITY_REQUIRED = 'Enter a Tagger identity in Settings or retry the account-name lookup before making attributed changes.';

// This guard is shared by UI and mutation boundaries; a disconnected local
// batch deliberately remains editable with an optional handoff identity.
export function attributionAvailable(): boolean {
  const { s3Config, taggerUser } = useStore.getState();
  return !s3Config || !!taggerUser.trim();
}

export function requireAttribution(): void {
  if (!attributionAvailable()) throw new Error(IDENTITY_REQUIRED);
}

export function connectedAttribution(): string | undefined {
  const { s3Config, taggerUser } = useStore.getState();
  return s3Config ? taggerUser.trim() || undefined : undefined;
}
