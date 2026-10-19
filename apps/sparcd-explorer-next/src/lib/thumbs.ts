// The thumbnail queue in the browser: ranged reads and presigned URLs through
// the read-only client, one queue per signed-in account and set of open
// collections. Opening other collections lets every thumbnail go.

import { useEffect, useRef, useState } from 'react';
import type { S3Config } from '@sparcd/types';
import {
  HEAD_BYTES,
  THUMBS_KEPT,
  ThumbCache,
  ThumbQueue,
  accountKey,
  extractThumbnail,
  loadThumb,
  readClient,
  type Model,
  type Thumb,
  type ThumbIo,
  type ThumbRequest,
} from '@/data';
import { useStore } from '@/store';

const PRESIGN_SECONDS = 3600;

/** A photo's place in storage, as one queue key: `bucket/object key`. */
export const photoKey = (model: Model, photo: number): string =>
  `${model.collections[model.photos[photo].collection].bucket}/${model.photos[photo].key}`;

const split = (key: string): [string, string] => {
  const i = key.indexOf('/');
  return [key.slice(0, i), key.slice(i + 1)];
};

function browserIo(config: S3Config): ThumbIo {
  const client = readClient(config);
  return {
    readHead: (key, signal) => {
      const [bucket, object] = split(key);
      return client.getObject(bucket, object, { signal, range: `bytes=0-${HEAD_BYTES - 1}` });
    },
    extract: extractThumbnail,
    presign: (key) => client.presignedGet(...split(key), PRESIGN_SECONDS),
    preload: (url, signal) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        const stop = () => {
          img.src = '';
          reject(signal.reason);
        };
        signal.addEventListener('abort', stop, { once: true });
        img.onload = () => {
          signal.removeEventListener('abort', stop);
          resolve();
        };
        img.onerror = () => {
          signal.removeEventListener('abort', stop);
          reject(new Error('The photo could not be shown'));
        };
        img.src = url;
      }),
    objectUrl: (bytes) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })),
    now: Date.now,
  };
}

let current: { id: string; queue: ThumbQueue; io: ThumbIo } | null = null;

function queueFor(config: S3Config, collections: string[]): { queue: ThumbQueue; io: ThumbIo } {
  const id = `${accountKey(config)}\n${collections.join('\n')}`;
  if (current?.id !== id) {
    current?.queue.dispose();
    const io = browserIo(config);
    const cache = new ThumbCache(THUMBS_KEPT, (url) => URL.revokeObjectURL(url));
    current = { id, io, queue: new ThumbQueue((key, signal) => loadThumb(io, key, signal), cache) };
  }
  return current;
}

/** The queue for what is open now. */
export function useThumbs(): { queue: ThumbQueue; io: ThumbIo } {
  const config = useStore((s) => s.config)!;
  const refs = useStore((s) => s.refs);
  return queueFor(config, refs.map((r) => r.key));
}

export type ThumbState = { thumb: Thumb | null; failed: boolean };

/**
 * A tile's picture, loaded while the tile is mounted. `priority` is 0 in view
 * and grows with distance; unmounting a tile cancels its load.
 */
export function useThumb(key: string | null, priority: number): ThumbState {
  const { queue } = useThumbs();
  const [state, setState] = useState<ThumbState & { key: string | null }>({ key: null, thumb: null, failed: false });
  const request = useRef<ThumbRequest | null>(null);
  const priorityRef = useRef(priority);
  priorityRef.current = priority;

  useEffect(() => {
    if (!key) return;
    const r = queue.want(key, priorityRef.current, (thumb) => setState({ key, thumb, failed: !thumb }));
    if (r.thumb) setState({ key, thumb: r.thumb, failed: false });
    request.current = r;
    return () => {
      request.current = null;
      r.release();
    };
  }, [queue, key]);

  useEffect(() => request.current?.setPriority(priority), [priority]);

  if (state.key === key) return state;
  return { thumb: (key && queue.cache.peek(key)) || null, failed: false };
}

/** A presigned URL for a photo's original, for the detail view. */
export function usePresigned(key: string | null): string | null {
  const { io } = useThumbs();
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    io.presign(key).then((u) => live && setUrl({ key, url: u }), () => {});
    return () => {
      live = false;
    };
  }, [io, key]);
  return url?.key === key ? url.url : null;
}
