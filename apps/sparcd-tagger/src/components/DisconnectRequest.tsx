import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  deriveFlipOwnerScope,
  discardOwnedFlipSnapshot,
  snapshotOwnedFlipRecords,
  type FlipRecordSnapshot,
} from '@sparcd/flip';
import { connectionChangeAllowed, hasPendingSave } from '../lib/saveNavigation';
import { useStore } from '../store';

const RequestDisconnectContext = createContext<() => void>(() => {});
export const useRequestTaggerDisconnect = () => useContext(RequestDisconnectContext);

type Prompt = {
  ownerScope: string;
  connectionId: number;
  snapshot: FlipRecordSnapshot[];
  message: string;
  busy: boolean;
};

/** One owner-scoped Disconnect flow shared by the header and Settings. */
export function DisconnectRequestProvider({ children, pendingSave }: { children: (requestDisconnect: () => void) => ReactNode; pendingSave: boolean }) {
  const config = useStore((state) => state.s3Config);
  const connectionId = useStore((state) => state.connectionId);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestGeneration = useRef(0);

  const closePrompt = useCallback(() => {
    setPrompt(null);
    requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
      openerRef.current = null;
    });
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (prompt && dialog && !dialog.open) {
      dialog.showModal();
      keepRef.current?.focus();
    } else if (!prompt && dialog?.open) {
      dialog.close();
    }
  }, [prompt]);

  const requestDisconnect = useCallback(() => {
    if (!config || pendingSave || hasPendingSave() || !connectionChangeAllowed(null)) return;
    const generation = ++requestGeneration.current;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const requestedConfig = config;
    const requestedConnectionId = connectionId;
    void deriveFlipOwnerScope(requestedConfig).then(async (ownerScope) => {
      const snapshot = await snapshotOwnedFlipRecords(ownerScope);
      const current = useStore.getState();
      if (generation !== requestGeneration.current || current.s3Config !== requestedConfig || current.connectionId !== requestedConnectionId) return;
      if (!snapshot.length) {
        openerRef.current = null;
        current.disconnect();
        return;
      }
      setPrompt({ ownerScope, connectionId: requestedConnectionId, snapshot, message: '', busy: false });
    }).catch(() => {
      if (generation === requestGeneration.current) {
        setPrompt({
          ownerScope: '', connectionId: requestedConnectionId, snapshot: [], busy: false,
          message: 'Local handoffs could not be checked. Stay connected and try Disconnect again after checking browser storage.',
        });
      }
    });
  }, [config, connectionId, pendingSave]);

  const complete = useCallback(async (choice: 'keep' | 'discard') => {
    if (!prompt || prompt.busy) return;
    const current = useStore.getState();
    if (hasPendingSave() || !connectionChangeAllowed(null)) {
      setPrompt((value) => value ? { ...value, message: 'Finish pending saves before disconnecting. Your local handoffs remain unchanged.' } : value);
      return;
    }
    if (!current.s3Config || current.connectionId !== prompt.connectionId) {
      closePrompt();
      return;
    }
    if (choice === 'keep') {
      setPrompt(null);
      openerRef.current = null;
      current.disconnect();
      return;
    }

    setPrompt((value) => value ? { ...value, busy: true, message: '' } : value);
    try {
      const { deleted, retainedChanged } = await discardOwnedFlipSnapshot(prompt.ownerScope, prompt.snapshot);
      const remaining = await snapshotOwnedFlipRecords(prompt.ownerScope);
      const state = useStore.getState();
      if (state.connectionId !== prompt.connectionId || !state.s3Config) { closePrompt(); return; }
      if (remaining.length) {
        const changed = Math.max(retainedChanged, remaining.length);
        setPrompt({
          ...prompt,
          snapshot: remaining,
          busy: false,
          message: `${changed} local handoff${changed === 1 ? '' : 's'} changed or were added after review and were kept. Review the updated count before deciding again.`,
        });
      } else {
        setPrompt(null);
        openerRef.current = null;
        state.disconnect();
      }
      void deleted;
    } catch {
      setPrompt((value) => value ? { ...value, busy: false, message: 'The local handoffs could not be discarded. They have been kept; check browser storage and try again.' } : value);
    }
  }, [closePrompt, prompt]);

  return <RequestDisconnectContext.Provider value={requestDisconnect}>
    {children(requestDisconnect)}
    <dialog
      ref={dialogRef}
      aria-labelledby="flip-disconnect-title"
      aria-describedby="flip-disconnect-copy"
      onCancel={(event) => { event.preventDefault(); if (!prompt?.busy) closePrompt(); }}
      onClose={() => { if (!prompt) { /* focus restoration is handled by closePrompt */ } }}
      className="fixed m-auto w-[min(34rem,calc(100%-2rem))] max-h-[90dvh] overflow-y-auto border border-ink bg-paper p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <div className="border-b border-rule px-5 py-3">
        <h2 id="flip-disconnect-title" className="font-display text-[18px]">Disconnect from Tagger?</h2>
      </div>
      <div id="flip-disconnect-copy" className="space-y-3 px-5 py-4 text-[14px] font-body">
        {prompt?.snapshot.length ? <>
          <p>You have <strong>{prompt.snapshot.length} local handoff{prompt.snapshot.length === 1 ? '' : 's'}</strong> for this login. Disconnecting and keeping them preserves the batches; only this login can reopen them.</p>
          <p>Discarding removes these local batches and their unsynced tagging work. It does not delete collection files in storage.</p>
        </> : <p>Local handoffs could not be checked. Stay connected so no saved work is put at risk.</p>}
        {prompt?.message && <p role="alert" className="text-warn">{prompt.message}</p>}
      </div>
      <footer className="flex flex-col-reverse gap-2 border-t border-rule px-5 py-3 sm:flex-row sm:justify-end">
        <button type="button" disabled={prompt?.busy} onClick={closePrompt} className="min-h-11 border border-rule px-3 disabled:opacity-50">Cancel</button>
        <button ref={keepRef} type="button" disabled={prompt?.busy || !prompt?.snapshot.length} onClick={() => void complete('keep')} className="min-h-11 border border-ink bg-ink px-3 text-paper disabled:opacity-50">Disconnect and keep local work</button>
        <button type="button" disabled={prompt?.busy || !prompt?.snapshot.length} onClick={() => void complete('discard')} className="min-h-11 border border-warn px-3 text-warn disabled:opacity-50">Discard local work and disconnect</button>
      </footer>
    </dialog>
  </RequestDisconnectContext.Provider>;
}
