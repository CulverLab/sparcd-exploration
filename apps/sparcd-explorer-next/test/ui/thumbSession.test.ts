import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Config } from '@sparcd/types';
import { openThumbSession, thumbSession } from '../../src/lib/thumbs';
import { useStore } from '../../src/store';
import { collectionRef } from '../support/fixtures';

vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    },
  });
});

const config = (accessKey: string): S3Config => ({
  endpoint: 'https://server.example.org',
  region: 'us-east-1',
  accessKey,
  secretKey: 'secret',
  forcePathStyle: true,
});

const alpha = collectionRef('Alpha', 'aaa');
const bravo = collectionRef('Bravo', 'bbb');

function inWorkspace(accessKey = 'alice', refs = [alpha]) {
  useStore.getState().adoptSession(config(accessKey));
  useStore.setState({ screen: 'workspace', refs });
}

/** A session holding one thumbnail object URL. */
function sessionWithThumb() {
  const session = thumbSession();
  session.queue.cache.set('k', { url: 'blob:k', kind: 'embedded' });
  return session;
}

let revoke: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  useStore.getState().adoptSession(null);
});
afterEach(() => revoke.mockRestore());

describe('the thumbnails of a workspace', () => {
  it('stay while the same collections stay open', () => {
    inWorkspace();
    const session = sessionWithThumb();
    useStore.getState().setView('photos');
    expect(thumbSession()).toBe(session);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('go, object URLs revoked, when the workspace closes for the chooser', () => {
    inWorkspace();
    sessionWithThumb();
    useStore.getState().showChooser();
    expect(revoke).toHaveBeenCalledWith('blob:k');
    expect(openThumbSession()).toBeUndefined();
  });

  it('go on sign-out', () => {
    inWorkspace();
    sessionWithThumb();
    useStore.getState().signOut();
    expect(revoke).toHaveBeenCalledWith('blob:k');
    expect(openThumbSession()).toBeUndefined();
  });

  it('go when other collections open, even from a view without photos', () => {
    inWorkspace('alice', [alpha]);
    const before = sessionWithThumb();
    useStore.setState({ refs: [alpha, bravo] });
    expect(revoke).toHaveBeenCalledWith('blob:k');
    expect(thumbSession()).not.toBe(before);
  });

  it('go when another account signs in', () => {
    inWorkspace('alice');
    sessionWithThumb();
    inWorkspace('bob');
    expect(revoke).toHaveBeenCalledWith('blob:k');
    expect(openThumbSession()).toBeUndefined();
  });

  it('never load outside the workspace', () => {
    useStore.getState().adoptSession(config('alice'));
    expect(() => thumbSession()).toThrow();
  });
});
