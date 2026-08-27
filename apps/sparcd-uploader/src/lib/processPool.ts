// Bounded pool over the file-processor worker. Spawns N workers, feeds one file
// each, and refills as results land — so a 5,000-file batch only ever holds a
// few files in flight. Returns a cancel handle and a promise that settles when
// the batch drains.

import type { ProcessRequest, ProcessResponse } from '../workers/fileProcessor.worker';

export type { ProcessResponse } from '../workers/fileProcessor.worker';

function defaultPoolSize(): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(2, Math.min(cores - 1, 6));
}

export type ProcessRun = { cancel: () => void; done: Promise<void> };

export function processBatch(
  items: ProcessRequest[],
  onStart: (id: string) => void,
  onResult: (r: ProcessResponse) => void,
  poolSize = defaultPoolSize(),
): ProcessRun {
  let cancelled = false;
  let next = 0;
  let inFlight = 0;
  let settle: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const size = Math.min(poolSize, Math.max(1, items.length));
  const workers: Worker[] = [];
  const active = new Map<Worker, ProcessRequest>();

  const finishIfDrained = () => {
    if (inFlight === 0 && next >= items.length) {
      for (const w of workers) w.terminate();
      settle();
    }
  };

  const feed = (worker: Worker) => {
    if (cancelled || next >= items.length) {
      finishIfDrained();
      return;
    }
    const item = items[next++];
    inFlight++;
    active.set(worker, item);
    onStart(item.id);
    worker.postMessage(item);
  };

  for (let i = 0; i < size; i++) {
    const worker = new Worker(new URL('../workers/fileProcessor.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<ProcessResponse>) => {
      const req = active.get(worker);
      active.delete(worker);
      // Allow test harnesses to hold a result until explicitly released.
      // Set window.__holdInspectResult = (id, filename) => Promise before
      // processing starts; call releaseHeldInspect() when ready to proceed.
      const holdFn = (
        window as unknown as { __holdInspectResult?: (id: string, name: string) => Promise<void> }
      ).__holdInspectResult;
      if (holdFn && req) {
        void holdFn(e.data.id, req.file.name).then(() => {
          inFlight--;
          if (!cancelled) onResult(e.data);
          feed(worker);
        });
      } else {
        inFlight--;
        if (!cancelled) onResult(e.data);
        feed(worker);
      }
    };
    worker.onerror = (err) => {
      // Surface a worker-level crash as a per-file processing error so the
      // inspect gate can show "needs attention" instead of hanging forever.
      const item = active.get(worker);
      active.delete(worker);
      inFlight--;
      if (!cancelled && item) {
        onResult({
          id: item.id,
          error: err.message || 'Worker crashed while processing this file',
        });
      }
      feed(worker);
    };
    workers.push(worker);
    feed(worker);
  }

  // Empty batch: settle immediately.
  finishIfDrained();

  return {
    cancel: () => {
      cancelled = true;
      for (const w of workers) w.terminate();
      settle();
    },
    done,
  };
}
