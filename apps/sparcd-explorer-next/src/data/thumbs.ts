// Thumbnails for the photo grid. Cameras embed a small JPEG in the EXIF block
// at the start of every photo, so one ranged read of the first bytes is
// usually enough; without one (or when the server refuses ranges) the tile
// shows the original. A file the server doesn't have is reported as such,
// with no second request. Video tiles show their first frame, and the detail view
// its original, through the same line of requests. Everything here runs over
// injected I/O, so tests drive it without a browser or a server.

import { isMissingObjectError } from './s3';

/** Bytes read from a photo's start: the EXIF block (64 KB at most) and its thumbnail. */
export const HEAD_BYTES = 66_000;
/** Image requests in flight at once, ranged reads and originals together. */
export const IMAGES_IN_FLIGHT = 6;
/** Thumbnails kept in memory. */
export const THUMBS_KEPT = 400;
/** How long a presigned original is used before it is signed again, under its one-hour lifetime. */
export const ORIGINAL_REUSE_MS = 50 * 60_000;

export type Thumb = {
  url: string;
  /**
   * `embedded`: an object URL of the EXIF thumbnail. `original`: a presigned
   * URL of the photo itself. `frame`: a video element showing a video's first frame.
   */
  kind: 'embedded' | 'original' | 'frame';
  /** When a presigned URL stops being reused. */
  expires?: number;
  /** The loaded video element of a `frame`, moved into the tile as is so it never loads twice. */
  video?: HTMLVideoElement;
  /** Frees what the thumbnail holds, once it leaves the cache. */
  release?: () => void;
};

export type ThumbIo = {
  /** The first `HEAD_BYTES` of an object. */
  readHead(key: string, signal: AbortSignal): Promise<Uint8Array>;
  /** The embedded EXIF (IFD1) thumbnail, if there is one. */
  extract(head: Uint8Array): Promise<Uint8Array | undefined>;
  /** A presigned URL for the whole object. */
  presign(key: string): Promise<string>;
  /** Fetch an image URL, resolving once it has arrived, so its slot frees only then. */
  preload(url: string, signal: AbortSignal): Promise<void>;
  /** A muted video element of `url`, resolving once its first frame shows. */
  preloadVideo(url: string, signal: AbortSignal): Promise<HTMLVideoElement>;
  /** Stop a video element from holding its media. */
  releaseVideo(video: HTMLVideoElement): void;
  objectUrl(bytes: Uint8Array): string;
  now(): number;
};

/** The photo's file isn't on the server, so there is nothing else to try. */
export class FileNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`${key} isn't on the server`);
    this.name = 'FileNotFoundError';
  }
}

/** The EXIF thumbnail inside the first bytes of a JPEG, or undefined. */
export async function extractThumbnail(head: Uint8Array): Promise<Uint8Array | undefined> {
  const { thumbnail } = await import('exifr/dist/mini.esm.mjs');
  const bytes = await thumbnail(head);
  return bytes?.length ? new Uint8Array(bytes) : undefined;
}

/** A tile's picture: the embedded thumbnail, else the original. */
export async function loadThumb(io: ThumbIo, key: string, signal: AbortSignal): Promise<Thumb> {
  let head: Uint8Array | null = null;
  try {
    head = await io.readHead(key, signal);
  } catch (err) {
    signal.throwIfAborted();
    if (isMissingObjectError(err)) throw new FileNotFoundError(key);
    // A server, or a CORS policy, that refuses ranged reads: show the original.
  }
  const embedded = head ? await io.extract(head).catch(() => undefined) : undefined;
  signal.throwIfAborted();
  if (embedded) return { url: io.objectUrl(embedded), kind: 'embedded' };
  return loadOriginal(io, key, signal);
}

/** The whole photo, fetched so it shows at once. Nothing is fetched once cancelled, even mid-signing. */
export async function loadOriginal(io: ThumbIo, key: string, signal: AbortSignal): Promise<Thumb> {
  const url = await io.presign(key);
  signal.throwIfAborted();
  await io.preload(url, signal);
  return { url, kind: 'original', expires: io.now() + ORIGINAL_REUSE_MS };
}

/** A video's first frame. `#t=0.1` makes every browser, Safari too, paint a frame. */
export async function loadFrame(io: ThumbIo, key: string, signal: AbortSignal): Promise<Thumb> {
  const url = await io.presign(key);
  signal.throwIfAborted();
  const video = await io.preloadVideo(`${url}#t=0.1`, signal);
  return { url, kind: 'frame', video, release: () => io.releaseVideo(video) };
}

/** Queue keys for what else a photo key can load: its original, or a video's first frame. */
export const ORIGINAL_JOB = 'original:';
export const FRAME_JOB = 'frame:';

/**
 * One queue job: a thumbnail by default, or the original or a first frame by
 * its prefix. `onGone` hears of a file the server answered 404 or NoSuchKey
 * for, never of a refusal or a network error.
 */
export function loadJob(io: ThumbIo, job: string, signal: AbortSignal, onGone?: (key: string) => void): Promise<Thumb> {
  const load = job.startsWith(ORIGINAL_JOB)
    ? loadOriginal(io, job.slice(ORIGINAL_JOB.length), signal)
    : job.startsWith(FRAME_JOB)
      ? loadFrame(io, job.slice(FRAME_JOB.length), signal)
      : loadThumb(io, job, signal);
  return load.catch((err) => {
    if (err instanceof FileNotFoundError) onGone?.(err.key);
    throw err;
  });
}

/** Thumbnails by key, least recently used first out. Object URLs are revoked as they leave. */
export class ThumbCache {
  private readonly entries = new Map<string, Thumb>();

  constructor(
    private readonly capacity: number,
    private readonly revoke: (url: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** The thumbnail, marked as just used. */
  get(key: string): Thumb | undefined {
    const thumb = this.peek(key);
    if (thumb) {
      this.entries.delete(key);
      this.entries.set(key, thumb);
    }
    return thumb;
  }

  /** The thumbnail, without touching its place in line. */
  peek(key: string): Thumb | undefined {
    const thumb = this.entries.get(key);
    if (thumb?.expires !== undefined && thumb.expires <= this.now()) {
      this.delete(key);
      return undefined;
    }
    return thumb;
  }

  set(key: string, thumb: Thumb): void {
    if (this.entries.get(key) !== thumb) this.delete(key);
    this.entries.set(key, thumb);
    while (this.entries.size > this.capacity) this.delete(this.entries.keys().next().value!);
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.delete(key);
  }

  /** Let go of a thumbnail that never made it into the cache. */
  discard(thumb: Thumb): void {
    if (thumb.kind === 'embedded') this.revoke(thumb.url);
    thumb.release?.();
  }

  private delete(key: string): void {
    const thumb = this.entries.get(key);
    if (!thumb) return;
    this.entries.delete(key);
    this.discard(thumb);
  }
}

/** Hears once when a wanted thumbnail is ready, or null when it can't be shown. */
export type ThumbListener = (thumb: Thumb | null) => void;

export type ThumbRequest = {
  /** Already cached: no request was made. */
  thumb?: Thumb;
  /** Lower goes first: 0 for a tile in view, more the further away it is. */
  setPriority(priority: number): void;
  /** No longer wanted: dropped from the line, or aborted when it is the last one waiting on it. */
  release(): void;
};

type Job = {
  key: string;
  priority: number;
  listeners: Set<ThumbListener>;
  controller: AbortController;
  running: boolean;
};

/**
 * At most `limit` loads in flight, the lowest priority first. Several tiles
 * wanting one key share one load; the load aborts when the last lets go.
 */
export class ThumbQueue {
  private readonly jobs = new Map<string, Job>();
  private inFlight = 0;
  private disposed = false;

  constructor(
    private readonly load: (key: string, signal: AbortSignal) => Promise<Thumb>,
    readonly cache: ThumbCache,
    private readonly limit = IMAGES_IN_FLIGHT,
  ) {}

  /** Loads running now, including aborted ones still settling. */
  get running(): number {
    return this.inFlight;
  }

  want(key: string, priority: number, listener: ThumbListener): ThumbRequest {
    const cached = this.cache.get(key);
    if (cached) return { thumb: cached, setPriority() {}, release() {} };
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, priority, listeners: new Set(), controller: new AbortController(), running: false };
      this.jobs.set(key, job);
    }
    const mine = job;
    mine.listeners.add(listener);
    mine.priority = Math.min(mine.priority, priority);
    this.pump();
    return {
      setPriority: (p) => {
        mine.priority = p;
        this.pump();
      },
      release: () => {
        if (!mine.listeners.delete(listener) || mine.listeners.size) return;
        if (this.jobs.get(key) === mine) this.jobs.delete(key);
        if (mine.running) mine.controller.abort();
      },
    };
  }

  /** Stop everything and let every thumbnail go, as when other collections open. */
  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs.values()) {
      job.listeners.clear();
      job.controller.abort();
    }
    this.jobs.clear();
    this.cache.clear();
  }

  private pump(): void {
    while (!this.disposed && this.inFlight < this.limit) {
      let next: Job | undefined;
      for (const job of this.jobs.values()) if (!job.running && (!next || job.priority < next.priority)) next = job;
      if (!next) return;
      this.start(next);
    }
  }

  private start(job: Job): void {
    job.running = true;
    this.inFlight++;
    this.load(job.key, job.controller.signal)
      .then(
        (thumb) => {
          // A load that finished after its tiles let go is still worth keeping.
          if (this.disposed) return this.cache.discard(thumb);
          this.cache.set(job.key, thumb);
          for (const listener of job.listeners) listener(thumb);
        },
        () => {
          for (const listener of job.listeners) listener(null);
        },
      )
      .finally(() => {
        this.inFlight--;
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.pump();
      });
  }
}

/**
 * The thumbnails of one signed-in account and set of open collections. Another
 * account or set, or leaving the workspace, lets the whole session go: loads
 * abort and every object URL is revoked.
 */
export class ThumbSessions<S extends { queue: ThumbQueue }> {
  private current: { id: string; session: S } | null = null;

  /** The session for `id`, made fresh when another one was open. */
  get(id: string, create: () => S): S {
    if (this.current?.id !== id) {
      this.dispose();
      this.current = { id, session: create() };
    }
    return this.current.session;
  }

  /** The open session when it is `id`'s, without making one. */
  peek(id: string): S | undefined {
    return this.current?.id === id ? this.current.session : undefined;
  }

  dispose(): void {
    this.current?.session.queue.dispose();
    this.current = null;
  }
}

/**
 * Keeps a presigned URL of `key` usable for as long as it is wanted: signed
 * now, again shortly before it expires, and at once when `wake` fires (the
 * page shown or focused again, as timers sleep in a hidden tab) after it has
 * expired. Returns the stop function.
 */
export function keepSigned(
  io: Pick<ThumbIo, 'presign' | 'now'>,
  key: string,
  onUrl: (url: string) => void,
  wake: (check: () => void) => () => void,
): () => void {
  let stopped = false;
  let due = Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sign = () => {
    clearTimeout(timer);
    due = Infinity;
    io.presign(key).then(
      (url) => {
        if (stopped) return;
        due = io.now() + ORIGINAL_REUSE_MS;
        onUrl(url);
        timer = setTimeout(sign, ORIGINAL_REUSE_MS);
      },
      () => {},
    );
  };
  sign();
  const unwake = wake(() => {
    if (!stopped && io.now() >= due) sign();
  });
  return () => {
    stopped = true;
    clearTimeout(timer);
    unwake();
  };
}
