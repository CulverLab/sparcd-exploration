// Thumbnails for the photo grid. Cameras embed a small JPEG in the EXIF block
// at the start of every photo, so one ranged read of the first bytes is
// usually enough; without one (or when the server refuses ranges) the tile
// shows the original. Everything here runs over injected I/O, so tests drive
// it without a browser or a server.

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
  /** `embedded`: an object URL of the EXIF thumbnail. `original`: a presigned URL of the photo itself. */
  kind: 'embedded' | 'original';
  /** When a presigned URL stops being reused. */
  expires?: number;
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
  objectUrl(bytes: Uint8Array): string;
  now(): number;
};

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
  } catch {
    // A server, or a CORS policy, that refuses ranged reads: show the original.
    signal.throwIfAborted();
  }
  const embedded = head ? await io.extract(head).catch(() => undefined) : undefined;
  signal.throwIfAborted();
  if (embedded) return { url: io.objectUrl(embedded), kind: 'embedded' };
  const url = await io.presign(key);
  await io.preload(url, signal);
  return { url, kind: 'original', expires: io.now() + ORIGINAL_REUSE_MS };
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
