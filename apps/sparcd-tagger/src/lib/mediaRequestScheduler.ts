export type MediaPriority = 'high' | 'low';

export type MediaRequestLease = {
  admitted: Promise<void>;
  cancel: () => void;
  release: () => void;
};

type Request = {
  admitted: () => void;
  priority: MediaPriority;
  active: boolean;
  cancelled: boolean;
  released: boolean;
};

/**
 * Limits browser media work to a small number of admitted sources. One slot is
 * reserved for Focus work, so a focused image can begin even while thumbnail
 * requests are loading. Focus work also jumps ahead of queued thumbnails.
 */
export class MediaRequestScheduler {
  private active = 0;
  private activeLow = 0;
  private readonly high: Request[] = [];
  private readonly low: Request[] = [];

  constructor(private readonly concurrency = 4) {}

  private get lowConcurrency(): number {
    // A single-slot scheduler cannot reserve capacity without starving every
    // thumbnail. The production scheduler has four slots, leaving three for
    // thumbnail work and one immediately available for Focus.
    return Math.max(1, this.concurrency - 1);
  }

  acquire(priority: MediaPriority): MediaRequestLease {
    let request!: Request;
    const admitted = new Promise<void>((resolve) => {
      request = { admitted: resolve, priority, active: false, cancelled: false, released: false };
    });
    const release = () => {
      if (!request.active || request.released) return;
      request.released = true;
      this.active--;
      if (request.priority === 'low') this.activeLow--;
      this.drain();
    };
    const cancel = () => {
      if (request.active) release();
      else request.cancelled = true;
    };
    (priority === 'high' ? this.high : this.low).push(request);
    this.drain();
    return { admitted, cancel, release };
  }

  private drain(): void {
    while (true) {
      const request = this.next();
      if (!request) return;
      if (request.cancelled) continue;
      request.active = true;
      this.active++;
      if (request.priority === 'low') this.activeLow++;
      request.admitted();
    }
  }

  private next(): Request | undefined {
    while (this.active < this.concurrency && this.high.length) {
      const request = this.high.shift()!;
      if (!request.cancelled) return request;
    }
    while (this.active < this.concurrency && this.activeLow < this.lowConcurrency && this.low.length) {
      const request = this.low.shift()!;
      if (!request.cancelled) return request;
    }
    return undefined;
  }
}

export const mediaRequestScheduler = new MediaRequestScheduler();
