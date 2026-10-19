// The thumbnail queue in the browser: ranged reads, presigned originals and
// video frames through the read-only client, at most six at once. One session
// per signed-in account and set of open collections; leaving the workspace,
// signing out or opening other collections lets the whole session go.

import { useEffect, useRef, useState } from 'react';
import type { S3Config } from '@sparcd/types';
import {
  FRAME_JOB,
  HEAD_BYTES,
  ORIGINAL_JOB,
  THUMBS_KEPT,
  ThumbCache,
  ThumbQueue,
  ThumbSessions,
  extractThumbnail,
  keepSigned,
  loadJob,
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

export const originalJob = (key: string) => `${ORIGINAL_JOB}${key}`;
export const frameJob = (key: string) => `${FRAME_JOB}${key}`;

const split = (key: string): [string, string] => {
  const i = key.indexOf('/');
  return [key.slice(0, i), key.slice(i + 1)];
};

const releaseVideo = (video: HTMLVideoElement) => {
  video.removeAttribute('src');
  video.load();
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
        if (signal.aborted) return reject(signal.reason);
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
    preloadVideo: (url, signal) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.disablePictureInPicture = true;
        video.setAttribute('aria-hidden', 'true');
        const stop = () => {
          releaseVideo(video);
          reject(signal.reason);
        };
        signal.addEventListener('abort', stop, { once: true });
        video.onloadeddata = () => {
          signal.removeEventListener('abort', stop);
          resolve(video);
        };
        video.onerror = () => {
          signal.removeEventListener('abort', stop);
          releaseVideo(video);
          reject(new Error('The video could not be shown'));
        };
        video.src = url;
      }),
    releaseVideo,
    objectUrl: (bytes) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })),
    now: Date.now,
  };
}

type Session = { queue: ThumbQueue; io: ThumbIo };
type StoreState = ReturnType<typeof useStore.getState>;

const sessions = new ThumbSessions<Session>();

/** Which session the workspace needs now, or null outside it. */
export const sessionId = (s: StoreState): string | null =>
  s.config && s.screen === 'workspace' ? `${s.account}\n${s.refs.map((r) => r.key).join('\n')}` : null;

// Leaving the workspace, signing out, another account or other collections:
// let every thumbnail, object URL and load of the last session go.
useStore.subscribe((s, prev) => {
  if (sessionId(s) !== sessionId(prev)) sessions.dispose();
});

/** The session for what is open now, made when first needed. */
export function thumbSession(): Session {
  const state = useStore.getState();
  const id = sessionId(state);
  if (!id) throw new Error('Thumbnails load only in the workspace');
  return sessions.get(id, () => {
    const io = browserIo(state.config!);
    const cache = new ThumbCache(THUMBS_KEPT, (url) => URL.revokeObjectURL(url));
    return { io, queue: new ThumbQueue((job, signal) => loadJob(io, job, signal), cache) };
  });
}

/** The open session, without making one. */
export const openThumbSession = (): Session | undefined => {
  const id = sessionId(useStore.getState());
  return id ? sessions.peek(id) : undefined;
};

export type ThumbState = { thumb: Thumb | null; failed: boolean };

/**
 * A queue job's picture, loaded while the caller is mounted: a thumbnail by
 * photo key, or an original or first frame by `originalJob` / `frameJob`.
 * `priority` is 0 in view and grows with distance; unmounting cancels the load.
 */
export function useThumb(job: string | null, priority: number): ThumbState {
  const id = useStore(sessionId);
  const [state, setState] = useState<ThumbState & { job: string | null }>({ job: null, thumb: null, failed: false });
  const request = useRef<ThumbRequest | null>(null);
  const priorityRef = useRef(priority);
  priorityRef.current = priority;

  useEffect(() => {
    if (!job || !id) return;
    const r = thumbSession().queue.want(job, priorityRef.current, (thumb) => setState({ job, thumb, failed: !thumb }));
    if (r.thumb) setState({ job, thumb: r.thumb, failed: false });
    request.current = r;
    return () => {
      request.current = null;
      r.release();
    };
  }, [id, job]);

  useEffect(() => request.current?.setPriority(priority), [priority]);

  if (state.job === job) return state;
  return { thumb: (job && openThumbSession()?.queue.cache.peek(job)) || null, failed: false };
}

/**
 * A presigned URL of a photo's original that stays usable while it is shown:
 * signed again before it expires, and when the page comes back after it has.
 */
export function useFreshUrl(key: string | null): string | null {
  const id = useStore(sessionId);
  const [state, setState] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!key || !id) return;
    return keepSigned(thumbSession().io, key, (url) => setState({ key, url }), (check) => {
      const onVisible = () => document.visibilityState === 'visible' && check();
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', check);
      return () => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', check);
      };
    });
  }, [id, key]);
  return state?.key === key ? state.url : null;
}
