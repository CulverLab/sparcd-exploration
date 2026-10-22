import { describe, expect, it } from 'vitest';
import { createLimiter } from '../src/data';

describe('createLimiter', () => {
  it('never runs more than n tasks at once and runs them all', async () => {
    const run = createLimiter(3);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        run(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('frees the slot when a task fails', async () => {
    const run = createLimiter(1);
    await expect(run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(run(async () => 'next')).resolves.toBe('next');
  });
});
