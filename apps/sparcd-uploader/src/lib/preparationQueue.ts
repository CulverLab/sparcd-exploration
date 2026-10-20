type Write = () => Promise<void>;

/** One active write plus the latest pending write per batch. Replacing a pending
 * write also replaces its captured state; obsolete thumbnails are not retained. */
export class PreparationQueue {
  private waiting = new Map<string, Write>();
  private failed = new Map<string, Write>();
  private running: Promise<void> | null = null;
  private active: string | null = null;
  constructor(private settled: (failed: boolean) => void = () => {}) {}

  enqueue(id: string, write: Write): void {
    this.waiting.set(id, write);
    this.failed.delete(id);
    this.start();
  }

  ids(): string[] { return [...new Set([...this.waiting.keys(), ...this.failed.keys(), ...(this.active ? [this.active] : [])])]; }

  retry(): void {
    for (const [id, write] of this.failed) {
      if (id !== this.active && !this.waiting.has(id)) this.waiting.set(id, write);
    }
    this.start();
  }

  private start(): void {
    if (this.running || !this.waiting.size) return;
    this.running = Promise.resolve().then(async () => {
      while (this.waiting.size) {
        const [id, write] = this.waiting.entries().next().value!;
        this.waiting.delete(id);
        this.active = id;
        try { await write(); this.failed.delete(id); }
        catch { if (!this.waiting.has(id)) this.failed.set(id, write); }
        finally { this.active = null; }
      }
    }).finally(() => {
      this.running = null;
      if (this.waiting.size) this.start();
      else this.settled(this.failed.size > 0);
    });
  }

  async flush(): Promise<void> {
    while (this.running) await this.running;
    if (this.failed.size) throw new Error('Local preparation could not be saved. Keep this tab open and retry after checking browser storage.');
  }
}
