import { describe, expect, it } from 'vitest';
import { MAX_FRUITLESS_RETRIES, planAutoRetry, type AutoRetryState } from '../src/lib/autoRetry';
import type { FileProgress } from '../src/lib/upload';

const file = (state: FileProgress['state']): FileProgress => ({ id: state, key: '', size: 1, loaded: 0, state, attempt: 1 });
const nothingSent = { sessionId: 's1', files: [file('skipped'), file('failed')] };
const oneSent = { sessionId: 's1', files: [file('done'), file('failed')] };

describe('planAutoRetry', () => {
  it('backs off, then stops after five retries in a row that send nothing', () => {
    let state: AutoRetryState = { sessionId: null, fruitless: 0 };
    const delays: (number | null)[] = [];
    for (let i = 0; i <= MAX_FRUITLESS_RETRIES; i++) {
      const plan = planAutoRetry(state, nothingSent);
      state = plan.state;
      delays.push(plan.delay);
    }
    expect(delays).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, null]);
    expect(planAutoRetry(state, nothingSent).delay).toBeNull();
  });

  it('starts over once a retry gets a file through', () => {
    const stuck: AutoRetryState = { sessionId: 's1', fruitless: MAX_FRUITLESS_RETRIES };
    const plan = planAutoRetry(stuck, oneSent);
    expect(plan.state.fruitless).toBe(0);
    expect(plan.delay).toBe(15_000);
  });

  it('starts over for a different upload', () => {
    const stuck: AutoRetryState = { sessionId: 's0', fruitless: MAX_FRUITLESS_RETRIES + 1 };
    expect(planAutoRetry(stuck, nothingSent)).toEqual({ state: { sessionId: 's1', fruitless: 1 }, delay: 15_000 });
  });
});
