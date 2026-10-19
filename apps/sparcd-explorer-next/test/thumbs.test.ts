import { describe, expect, it, vi } from 'vitest';
import {
  HEAD_BYTES,
  IMAGES_IN_FLIGHT,
  ORIGINAL_REUSE_MS,
  ThumbCache,
  ThumbQueue,
  extractThumbnail,
  loadThumb,
  type Thumb,
  type ThumbIo,
} from '../src/data';
import { encodeJpeg, withExifThumbnail } from './support/jpeg';

const thumb = encodeJpeg(160, 120, (x, y) => [40 + x * 8, 90 + y * 6, 120]);
const main = encodeJpeg(640, 480, (x, y) => [x * 3, y * 4, 128]);
const withThumb = withExifThumbnail(main, thumb);

describe('the embedded EXIF thumbnail', () => {
  it('comes out of the first bytes of a camera JPEG exactly as stored', async () => {
    expect(await extractThumbnail(withThumb)).toEqual(thumb);
    expect(withThumb.length).toBeGreaterThan(thumb.length);
    expect(await extractThumbnail(withThumb.slice(0, HEAD_BYTES))).toEqual(thumb);
  });

  it('is missing from a JPEG without EXIF', async () => {
    expect(await extractThumbnail(main)).toBeUndefined();
  });
});

function fakeIo(head: () => Promise<Uint8Array>): ThumbIo & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    readHead: async (key) => {
      calls.push(`head ${key}`);
      return head();
    },
    extract: extractThumbnail,
    presign: async (key) => {
      calls.push(`presign ${key}`);
      return `https://server.example.org/${key}?signed`;
    },
    preload: async (url) => {
      calls.push(`preload ${url}`);
    },
    objectUrl: (bytes) => {
      calls.push(`object ${bytes.length}`);
      return 'blob:thumb';
    },
    now: () => 1000,
  };
}

describe('which picture a tile shows', () => {
  const signal = () => new AbortController().signal;

  it('the embedded thumbnail when the first bytes hold one', async () => {
    const io = fakeIo(async () => withThumb.slice(0, HEAD_BYTES));
    expect(await loadThumb(io, 'a.jpg', signal())).toEqual({ url: 'blob:thumb', kind: 'embedded' });
    expect(io.calls).toEqual(['head a.jpg', `object ${thumb.length}`]);
  });

  it('the original when the photo has no thumbnail', async () => {
    const io = fakeIo(async () => main);
    expect(await loadThumb(io, 'b.jpg', signal())).toEqual({
      url: 'https://server.example.org/b.jpg?signed',
      kind: 'original',
      expires: 1000 + ORIGINAL_REUSE_MS,
    });
    expect(io.calls).toEqual(['head b.jpg', 'presign b.jpg', 'preload https://server.example.org/b.jpg?signed']);
  });

  it('the original when the ranged read fails, as when the server refuses ranges', async () => {
    const io = fakeIo(async () => Promise.reject(new TypeError('Failed to fetch')));
    expect((await loadThumb(io, 'c.jpg', signal())).kind).toBe('original');
  });

  it('the original when the bytes are not a JPEG at all', async () => {
    const io = fakeIo(async () => new Uint8Array([1, 2, 3, 4]));
    expect((await loadThumb(io, 'd.jpg', signal())).kind).toBe('original');
  });

  it('nothing at all once cancelled', async () => {
    const controller = new AbortController();
    const io = fakeIo(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(loadThumb(io, 'e.jpg', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(io.calls).toEqual(['head e.jpg']);
  });
});

const embedded = (url: string): Thumb => ({ url, kind: 'embedded' });

describe('the thumbnail cache', () => {
  it('evicts the least recently used and revokes its object URL', () => {
    const revoked: string[] = [];
    const cache = new ThumbCache(2, (url) => revoked.push(url));
    cache.set('a', embedded('blob:a'));
    cache.set('b', embedded('blob:b'));
    expect(cache.get('a')?.url).toBe('blob:a');
    cache.set('c', embedded('blob:c'));
    expect(revoked).toEqual(['blob:b']);
    expect([cache.peek('a'), cache.peek('b'), cache.peek('c')].map((t) => t?.url)).toEqual(['blob:a', undefined, 'blob:c']);
  });

  it('revokes everything on clear, but never a presigned URL', () => {
    const revoked: string[] = [];
    const cache = new ThumbCache(5, (url) => revoked.push(url));
    cache.set('a', embedded('blob:a'));
    cache.set('b', { url: 'https://server.example.org/b', kind: 'original' });
    cache.set('a', embedded('blob:a2'));
    expect(revoked).toEqual(['blob:a']);
    cache.clear();
    expect(revoked).toEqual(['blob:a', 'blob:a2']);
    expect(cache.size).toBe(0);
  });

  it('stops reusing a presigned original before it expires', () => {
    let now = 0;
    const cache = new ThumbCache(5, () => {}, () => now);
    cache.set('a', { url: 'https://server.example.org/a', kind: 'original', expires: 100 });
    expect(cache.get('a')).toBeDefined();
    now = 100;
    expect(cache.get('a')).toBeUndefined();
  });
});

type Pending = { key: string; signal: AbortSignal; resolve: (t: Thumb) => void; reject: (e: unknown) => void };

function queue(limit = IMAGES_IN_FLIGHT) {
  const pending: Pending[] = [];
  const revoked: string[] = [];
  const q = new ThumbQueue(
    (key, signal) =>
      new Promise<Thumb>((resolve, reject) => {
        pending.push({ key, signal, resolve, reject });
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
    new ThumbCache(100, (url) => revoked.push(url)),
    limit,
  );
  return { q, pending, revoked };
}
const settle = () => new Promise((r) => setTimeout(r));

describe('loading thumbnails', () => {
  it(`keeps at most ${IMAGES_IN_FLIGHT} in flight, the tiles in view first`, async () => {
    const { q, pending } = queue();
    for (let i = 0; i < 10; i++) q.want(`far${i}`, 5 + i, () => {});
    q.want('inView', 0, () => {});
    expect(pending.map((p) => p.key)).toEqual(['far0', 'far1', 'far2', 'far3', 'far4', 'far5']);
    expect(q.running).toBe(IMAGES_IN_FLIGHT);
    pending[0].resolve(embedded('blob:far0'));
    await settle();
    expect(pending.map((p) => p.key).slice(6)).toEqual(['inView']);
    expect(q.running).toBe(IMAGES_IN_FLIGHT);
  });

  it('moves a tile up the line when it scrolls into view', async () => {
    const { q, pending } = queue(1);
    q.want('first', 0, () => {});
    q.want('near', 2, () => {});
    const later = q.want('later', 3, () => {});
    later.setPriority(0);
    pending[0].resolve(embedded('blob:first'));
    await settle();
    expect(pending.map((p) => p.key)).toEqual(['first', 'later']);
  });

  it('tells every tile wanting a photo, from one load, and keeps it for next time', async () => {
    const { q, pending } = queue();
    const heard: (Thumb | null)[] = [];
    q.want('a', 1, (t) => heard.push(t));
    q.want('a', 0, (t) => heard.push(t));
    expect(pending).toHaveLength(1);
    pending[0].resolve(embedded('blob:a'));
    await settle();
    expect(heard.map((t) => t?.url)).toEqual(['blob:a', 'blob:a']);
    expect(q.want('a', 0, () => {}).thumb?.url).toBe('blob:a');
    expect(pending).toHaveLength(1);
  });

  it('never starts a tile scrolled away while it waited, and aborts one scrolled away while loading', async () => {
    const { q, pending } = queue(1);
    const loading = q.want('loading', 0, () => {});
    const waiting = q.want('waiting', 1, () => {});
    waiting.release();
    loading.release();
    expect(pending[0].signal.aborted).toBe(true);
    await settle();
    expect(pending.map((p) => p.key)).toEqual(['loading']);
    expect(q.running).toBe(0);
  });

  it('keeps loading while another tile still wants the photo', () => {
    const { q, pending } = queue();
    const one = q.want('a', 0, () => {});
    q.want('a', 0, () => {});
    one.release();
    expect(pending[0].signal.aborted).toBe(false);
  });

  it('says when a photo cannot be shown', async () => {
    const { q, pending } = queue();
    const heard: (Thumb | null)[] = [];
    q.want('gone', 0, (t) => heard.push(t));
    pending[0].reject(new Error('NoSuchKey'));
    await settle();
    expect(heard).toEqual([null]);
  });

  it('lets everything go when other collections open, and starts nothing after', async () => {
    const { q, pending, revoked } = queue();
    const listener = vi.fn();
    q.want('a', 0, () => {});
    q.want('late', 0, listener);
    pending[0].resolve(embedded('blob:a'));
    await settle();
    q.dispose();
    expect(revoked).toEqual(['blob:a']);
    expect(pending[1].signal.aborted).toBe(true);
    q.want('after', 0, () => {});
    expect(pending).toHaveLength(2);
    expect(listener).not.toHaveBeenCalled();
  });
});
