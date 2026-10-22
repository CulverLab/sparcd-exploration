export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Run at most `n` tasks at once. Later calls wait their turn, in call order. */
export function createLimiter(n: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active < n) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter, so a new caller can't
      // slip in between and push the count past `n`.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
