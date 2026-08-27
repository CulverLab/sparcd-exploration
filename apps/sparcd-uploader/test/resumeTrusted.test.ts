// The trusted restore path: reattach files from the stored directory handle by
// relPath + size, without re-running the hash pipeline.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BatchRecord, FileRecord } from '../src/lib/db';

// scanFiles.ts probes `window.showDirectoryPicker` at module load; resume.ts
// pulls it in. The node test environment has no `window`.
(globalThis as Record<string, unknown>).window ??= {};

const processBatch = vi.fn();
vi.mock('../src/lib/processPool', () => ({ processBatch }));
vi.mock('../src/lib/db', () => ({ attachBundle: vi.fn(), updateFileRecords: vi.fn() }));

let restoreFromHandleTrusted: typeof import('../src/lib/resume')['restoreFromHandleTrusted'];

beforeAll(async () => {
  ({ restoreFromHandleTrusted } = await import('../src/lib/resume'));
});

// Minimal stand-ins for the File System Access API: jsdom has no real handles.
// A directory yields its entries from an async generator, exactly as
// `scanDirectoryHandle` consumes them.
type FakeEntry = { name: string; bytes: number };

function fileHandle(entry: FakeEntry) {
  return {
    kind: 'file' as const,
    name: entry.name,
    getFile: async () => new File([new Uint8Array(entry.bytes)], entry.name, { type: 'image/jpeg' }),
  };
}

function dirHandle(
  name: string,
  entries: FakeEntry[],
  permission: { query: PermissionState; request?: PermissionState } = { query: 'granted' },
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    values: async function* () {
      for (const e of entries) yield fileHandle(e);
    },
    queryPermission: async () => permission.query,
    requestPermission: async () => permission.request ?? 'denied',
  } as unknown as FileSystemDirectoryHandle;
}

function batchWith(handle?: FileSystemDirectoryHandle): BatchRecord {
  return { id: 'session-1', dirHandle: handle } as unknown as BatchRecord;
}

function record(localPath: string, size: number): FileRecord {
  return {
    id: `session-1::${localPath}`,
    sessionId: 'session-1',
    localPath,
    fileName: localPath.split('/').pop()!,
    relPathInBundle: localPath,
    size,
    state: 'pending',
    attempt: 0,
    sha256: `sha-${localPath}`,
    captureTimestamp: '2026-07-01 12:00:00',
  };
}

describe('restoreFromHandleTrusted', () => {
  it('attaches every matching file without hashing', async () => {
    const handle = dirHandle('trip', [
      { name: 'IMG001.JPG', bytes: 64 },
      { name: 'IMG002.JPG', bytes: 32 },
    ]);
    const records = [record('trip/IMG001.JPG', 64), record('trip/IMG002.JPG', 32)];

    const res = await restoreFromHandleTrusted(batchWith(handle), Promise.resolve(records));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...res.attached.keys()]).toEqual(['trip/IMG001.JPG', 'trip/IMG002.JPG']);
    expect(res.attached.get('trip/IMG001.JPG')!.size).toBe(64);
    expect(res.problems).toEqual([]);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it('ignores files on disk that no record mentions', async () => {
    const handle = dirHandle('trip', [
      { name: 'IMG001.JPG', bytes: 64 },
      { name: 'EXTRA.JPG', bytes: 64 },
    ]);

    const res = await restoreFromHandleTrusted(
      batchWith(handle),
      Promise.resolve([record('trip/IMG001.JPG', 64)]),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...res.attached.keys()]).toEqual(['trip/IMG001.JPG']);
    expect(res.problems).toEqual([]);
  });

  it('reports a size mismatch as a problem instead of attaching it', async () => {
    const handle = dirHandle('trip', [
      { name: 'IMG001.JPG', bytes: 64 },
      { name: 'IMG002.JPG', bytes: 99 },
    ]);
    const records = [record('trip/IMG001.JPG', 64), record('trip/IMG002.JPG', 32)];

    const res = await restoreFromHandleTrusted(batchWith(handle), Promise.resolve(records));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...res.attached.keys()]).toEqual(['trip/IMG001.JPG']);
    expect(res.problems).toEqual([
      { localPath: 'trip/IMG002.JPG', fileName: 'IMG002.JPG', reason: 'size differs (99 ≠ 32)' },
    ]);
  });

  it('reports a record with no file on disk as a problem', async () => {
    const handle = dirHandle('trip', [{ name: 'IMG001.JPG', bytes: 64 }]);
    const records = [record('trip/IMG001.JPG', 64), record('trip/GONE.JPG', 64)];

    const res = await restoreFromHandleTrusted(batchWith(handle), Promise.resolve(records));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...res.attached.keys()]).toEqual(['trip/IMG001.JPG']);
    expect(res.problems).toEqual([
      { localPath: 'trip/GONE.JPG', fileName: 'GONE.JPG', reason: 'not in the selected folder' },
    ]);
  });

  it('prompts when permission is not already granted, and walks once it is', async () => {
    const handle = dirHandle('trip', [{ name: 'IMG001.JPG', bytes: 64 }], {
      query: 'prompt',
      request: 'granted',
    });

    const res = await restoreFromHandleTrusted(
      batchWith(handle),
      Promise.resolve([record('trip/IMG001.JPG', 64)]),
    );

    expect(res.ok).toBe(true);
  });

  it('fails with the reselect reason when read permission is denied', async () => {
    const handle = dirHandle('trip', [{ name: 'IMG001.JPG', bytes: 64 }], {
      query: 'prompt',
      request: 'denied',
    });

    const res = await restoreFromHandleTrusted(
      batchWith(handle),
      Promise.resolve([record('trip/IMG001.JPG', 64)]),
    );

    expect(res).toEqual({
      ok: false,
      reason: 'Read permission to the folder was not granted — reselect it instead.',
    });
  });

  it('fails when the session has no stored handle', async () => {
    const res = await restoreFromHandleTrusted(batchWith(undefined), Promise.resolve([]));
    expect(res).toEqual({
      ok: false,
      reason: 'No durable folder handle is stored for this session.',
    });
  });

  // The gesture-gated call has to happen before anything else is awaited, or
  // Firefox and Safari drop it silently. A records promise that never settles
  // pins that down: the prompt still has to fire.
  it('reaches the permission prompt without waiting on the records', async () => {
    const requested = vi.fn(async () => 'granted' as PermissionState);
    const handle = {
      kind: 'directory',
      name: 'trip',
      values: async function* () {
        yield fileHandle({ name: 'IMG001.JPG', bytes: 64 });
      },
      queryPermission: async () => 'prompt' as PermissionState,
      requestPermission: requested,
    } as unknown as FileSystemDirectoryHandle;

    let releaseRecords: (r: FileRecord[]) => void;
    const recordsPromise = new Promise<FileRecord[]>((resolve) => {
      releaseRecords = resolve;
    });

    const pending = restoreFromHandleTrusted(batchWith(handle), recordsPromise);
    await Promise.resolve();
    expect(requested).toHaveBeenCalledWith({ mode: 'read' });

    releaseRecords!([record('trip/IMG001.JPG', 64)]);
    const res = await pending;
    expect(res.ok).toBe(true);
  });
});
