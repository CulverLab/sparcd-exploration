import type { UploadSnapshot } from './upload';

const BASE_MS = 15_000;
const MAX_MS = 5 * 60_000;
// Retries in a row that got no file through before the app stops on its own.
// A dead endpoint or a CORS refusal looks exactly like a dropped connection
// from here, so without a cap it would retry forever.
export const MAX_FRUITLESS_RETRIES = 5;

export type AutoRetryState = { sessionId: string | null; fruitless: number };

/**
 * For a partial run that stopped only for want of a connection: how long to
 * wait before retrying it, or `null` to stop retrying. Any file sent resets
 * the count; so does a different upload.
 */
export function planAutoRetry(
  state: AutoRetryState,
  snap: Pick<UploadSnapshot, 'sessionId' | 'files'>,
): { state: AutoRetryState; delay: number | null } {
  const sentAny = snap.files.some((f) => f.state === 'done');
  const fruitless = sentAny ? 0 : state.sessionId === snap.sessionId ? state.fruitless + 1 : 1;
  const next = { sessionId: snap.sessionId, fruitless };
  if (fruitless > MAX_FRUITLESS_RETRIES) return { state: next, delay: null };
  return { state: next, delay: Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, fruitless - 1)) };
}
