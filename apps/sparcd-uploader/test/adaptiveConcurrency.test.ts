import { describe, expect, it } from 'vitest';
import { createAdaptiveController } from '../src/lib/adaptiveConcurrency';

const MS = 12_000;

/** Feed one window per rate (bytes/window) and return the target after each. */
function trajectory(rates: number[], controller = createAdaptiveController()): number[] {
  return rates.map((bytes) => {
    controller.onWindow({ bytes, ms: MS });
    return controller.target();
  });
}

describe('adaptive concurrency controller', () => {
  it('starts at 8 and probes upward off the first measured window', () => {
    const c = createAdaptiveController();
    expect(c.target()).toBe(8);
    c.onWindow({ bytes: 10_000_000, ms: MS });
    expect(c.target()).toBe(10);
  });

  it('climbs while throughput keeps improving and settles at the cap', () => {
    // Each window is 20% faster than the last — always well past the 5% bar.
    const rates = Array.from({ length: 20 }, (_, i) => 10_000_000 * 1.2 ** i);
    const path = trajectory(rates);

    expect(path.slice(0, 4)).toEqual([10, 12, 14, 16]);
    expect(path.at(-1)).toBe(32);
    expect(Math.max(...path)).toBe(32);
  });

  it('reverts a probe that buys nothing and settles at the paying size', () => {
    const c = createAdaptiveController();
    // Baseline probe → 10; the climb to 12 pays; the probe to 14 comes back flat.
    const path = trajectory([10_000_000, 12_000_000, 12_100_000], c);
    expect(path).toEqual([10, 12, 10]);
  });

  it('re-probes after three settled flat windows instead of holding forever', () => {
    const c = createAdaptiveController();
    trajectory([10_000_000, 10_100_000], c); // baseline probe → 10, flat → revert to 8
    expect(c.target()).toBe(8);

    const path = trajectory([10_000_000, 10_050_000, 10_100_000], c);
    expect(path).toEqual([8, 8, 10]); // third settled flat window probes again
  });

  it('reverses after a regression and settles for one window', () => {
    const c = createAdaptiveController();
    // Baseline probe → 10, then an improving window → 12.
    trajectory([10_000_000, 14_000_000], c);
    expect(c.target()).toBe(12);

    // A regression backs off one step in the other direction…
    c.onWindow({ bytes: 8_000_000, ms: MS });
    expect(c.target()).toBe(10);
    // …and the next window is a settling window, not a decision.
    c.onWindow({ bytes: 30_000_000, ms: MS });
    expect(c.target()).toBe(10);
    // Then improvement continues in the new (downward) direction.
    c.onWindow({ bytes: 40_000_000, ms: MS });
    expect(c.target()).toBe(8);
  });

  it('respects the lower bound while descending', () => {
    const c = createAdaptiveController({ start: 6 });
    // Baseline probe up, regression reverses to descending, settle, then the
    // descent keeps paying all the way to the floor.
    const path = trajectory(
      [10_000_000, 2_000_000, 2_000_000, 4_000_000, 8_000_000, 16_000_000],
      c,
    );
    expect(path).toEqual([8, 6, 6, 4, 2, 2]);
    expect(Math.min(...path)).toBe(2);
  });

  it('respects custom bounds', () => {
    const c = createAdaptiveController({ start: 4, min: 3, max: 6, step: 2 });
    const path = trajectory([1e6, 2e6, 4e6, 8e6], c);
    expect(path).toEqual([6, 6, 6, 6]);
  });

  it('skips zero-byte windows until something has landed', () => {
    const c = createAdaptiveController();
    // Nothing has completed yet — not a stall, just step-wise byte accounting.
    trajectory([0, 0, 0], c);
    expect(c.target()).toBe(8);
    // The first window that moves bytes baselines and probes.
    trajectory([10_000_000], c);
    expect(c.target()).toBe(10);
  });

  it('treats a zero-byte window after a moving one as a regression', () => {
    const c = createAdaptiveController();
    trajectory([10_000_000, 20_000_000], c);
    expect(c.target()).toBe(12);

    c.onWindow({ bytes: 0, ms: MS });
    expect(c.target()).toBe(10);
  });

  // A network outage parks every lane in `waitForOnline`, so its windows carry
  // no bytes through no fault of the lane count. The engine drops those windows
  // rather than reporting them (see the `navigator.onLine` guard in upload.ts);
  // this pins what that buys — the climb picks up where it left off instead of
  // reversing, which is what the previous test shows an unsuppressed one does.
  it('keeps climbing across a suppressed offline window', () => {
    const c = createAdaptiveController();
    trajectory([10_000_000, 20_000_000], c);
    expect(c.target()).toBe(12);

    // The outage windows never reach the controller at all.
    expect(c.target()).toBe(12);

    trajectory([30_000_000], c);
    expect(c.target()).toBe(14);
  });
});
