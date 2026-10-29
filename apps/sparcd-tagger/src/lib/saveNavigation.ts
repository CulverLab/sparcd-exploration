import type { S3Config } from '@sparcd/types';

type SaveNavigation = {
  flush: () => Promise<boolean>;
  pending: () => boolean;
  connectionAllowed: (cfg: S3Config | null) => boolean;
};
let policy: SaveNavigation | undefined;
export function installSaveNavigation(value: SaveNavigation): () => void {
  policy = value;
  return () => { if (policy === value) policy = undefined; };
}
export function navigateAfterSave(change: () => void): void {
  if (!policy?.pending()) { change(); return; }
  void policy.flush().then(saved => { if (saved) change(); });
}
export const connectionChangeAllowed = (cfg: S3Config | null) => policy?.connectionAllowed(cfg) ?? true;
export const hasPendingSave = () => policy?.pending() ?? false;
