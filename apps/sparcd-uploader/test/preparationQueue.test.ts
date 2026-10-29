import { expect, it } from 'vitest';
import { PreparationQueue } from '../src/lib/preparationQueue';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

it('bounds hot-batch writes and flush waits for the latest accepted state', async () => {
  const entered = deferred(), release = deferred();
  const committed: number[] = [];
  const queue = new PreparationQueue();
  queue.enqueue('a', async () => { entered.resolve(); await release.promise; committed.push(0); });
  await entered.promise;
  for (let i = 1; i <= 1000; i++) queue.enqueue('a', async () => { committed.push(i); });
  let flushed = false;
  const flushing = queue.flush().then(() => { flushed = true; });
  await Promise.resolve(); expect(flushed).toBe(false);
  release.resolve(); await flushing;
  expect(committed).toEqual([0, 1000]);
});
it('preserves separate batches and keeps a queued delete after an active write', async () => {
  const entered = deferred(), release = deferred();
  const data = new Map<string, string>();
  const queue = new PreparationQueue();
  queue.enqueue('a', async () => { entered.resolve(); await release.promise; data.set('a', 'old'); });
  await entered.promise;
  queue.enqueue('a', async () => { data.set('a', 'latest'); });
  queue.enqueue('b', async () => { data.set('b', 'latest'); });
  queue.enqueue('a', async () => { data.delete('a'); });
  release.resolve(); await queue.flush();
  expect([...data.entries()]).toEqual([['b', 'latest']]);
});
it('does not hide one batch failure behind another success, and retries failed writes', async () => {
  let deny = true;
  const data = new Map<string, string>();
  const queue = new PreparationQueue();
  queue.enqueue('a', async () => { if (deny) throw new Error('Quota'); data.set('a', 'accepted'); });
  queue.enqueue('b', async () => { data.set('b', 'accepted'); });
  await expect(queue.flush()).rejects.toThrow('could not be saved');
  expect(data.has('a')).toBe(false); expect(data.get('b')).toBe('accepted');
  deny = false; queue.retry(); await queue.flush();
  expect(data.get('a')).toBe('accepted');
});
it('a new delete supersedes a failed snapshot and retry cannot resurrect it', async () => {
  let denied = true, value = 'previously saved';
  const queue = new PreparationQueue();
  queue.enqueue('a', async () => { if (denied) throw new Error('Quota'); value = 'obsolete'; });
  await expect(queue.flush()).rejects.toThrow();
  queue.enqueue('a', async () => { value = ''; });
  await queue.flush(); denied = false; queue.retry(); await queue.flush();
  expect(value).toBe('');
});
