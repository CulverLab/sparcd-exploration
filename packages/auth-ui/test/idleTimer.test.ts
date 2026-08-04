import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startIdleWatcher } from '../src/idleTimer';

// window.setTimeout/clearTimeout are the only globals startIdleWatcher
// touches — real browser-shaped timers under vitest's fake-timer install.
beforeEach(() => {
  (globalThis as any).window = globalThis;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startIdleWatcher', () => {
  it('fires onIdle after timeoutMs of no activity when not busy', () => {
    const onIdle = vi.fn();
    startIdleWatcher({ timeoutMs: 1000, isBusy: () => false, onIdle });

    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('arm() resets the countdown — activity postpones the fire', () => {
    const onIdle = vi.fn();
    const watcher = startIdleWatcher({ timeoutMs: 1000, isBusy: () => false, onIdle });

    vi.advanceTimersByTime(700);
    watcher.arm(); // activity at t=700 — countdown restarts from here
    vi.advanceTimersByTime(700);
    expect(onIdle).not.toHaveBeenCalled(); // only 700ms since the reset
    vi.advanceTimersByTime(300);
    expect(onIdle).toHaveBeenCalledTimes(1); // now 1000ms since the reset
  });

  it('postpones instead of firing while busy, then fires once idle', () => {
    const onIdle = vi.fn();
    let busy = true;
    startIdleWatcher({ timeoutMs: 1000, isBusy: () => busy, onIdle });

    vi.advanceTimersByTime(1000); // fires the check while busy — should re-arm, not call onIdle
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); // still busy
    expect(onIdle).not.toHaveBeenCalled();

    busy = false;
    vi.advanceTimersByTime(1000); // now idle at the next check
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stop() prevents any further onIdle calls', () => {
    const onIdle = vi.fn();
    const watcher = startIdleWatcher({ timeoutMs: 1000, isBusy: () => false, onIdle });

    watcher.stop();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('never fires early, even across many small activity resets', () => {
    const onIdle = vi.fn();
    const watcher = startIdleWatcher({ timeoutMs: 1000, isBusy: () => false, onIdle });

    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(200);
      watcher.arm();
    }
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
