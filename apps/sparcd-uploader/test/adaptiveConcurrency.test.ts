import { describe, expect, it } from 'vitest';
import { createAdaptiveController, type AdaptiveController } from '../src/lib/adaptiveConcurrency';

const STARTUP_MS = 3_000;
const MS = 12_000;

/** Feed one window per rate (bytes/window) and return the target after each. */
function trajectory(
  rates: number[],
  controller: AdaptiveController,
  ms = controller.windowMs(),
): number[] {
  return rates.map((bytes) => {
    controller.onWindow({ bytes, ms });
    return controller.target();
  });
}

/**
 * Drive a fresh controller out of startup and into the hill climber holding 12
 * lanes: a warmup window, one that clearly pays at 12, then one that drops at
 * 18. Returns the rate (bytes/ms) the climber inherits as its bar.
 */
function settled(controller: AdaptiveController): number {
  trajectory([30_000_000, 60_000_000, 30_000_000], controller, STARTUP_MS);
  return 60_000_000 / STARTUP_MS;
}

describe('adaptive startup', () => {
  it('starts at 8 lanes on short windows', () => {
    const c = createAdaptiveController();
    expect(c.target()).toBe(8);
    expect(c.windowMs()).toBe(STARTUP_MS);
  });

  it('grows lanes multiplicatively while each window clearly gains', () => {
    const c = createAdaptiveController();
    const rates = Array.from({ length: 5 }, (_, i) => 10_000_000 * 2 ** i);
    expect(trajectory(rates, c, STARTUP_MS)).toEqual([12, 18, 27, 32, 32]);
  });

  it('ends startup on a clear drop and steps back to the last paying size', () => {
    const c = createAdaptiveController();
    // 8 warms up, 12 doubles the rate, 18 halves it — one drop is enough.
    expect(trajectory([30_000_000, 60_000_000, 30_000_000], c, STARTUP_MS)).toEqual([12, 18, 12]);
    expect(c.windowMs()).toBe(MS);
  });

  it('ends startup after two rounds that merely plateau', () => {
    const c = createAdaptiveController();
    const path = trajectory([30_000_000, 60_000_000, 63_000_000, 66_000_000], c, STARTUP_MS);
    expect(path).toEqual([12, 18, 27, 12]);
    expect(c.windowMs()).toBe(MS);
  });

  it('reads the warmup-noisy first window as a baseline, not as a paying size', () => {
    const c = createAdaptiveController();
    // The first window only measures lanes spinning up, so the jump it appears
    // to produce must not make 8 the size startup falls back to.
    trajectory([1_000_000, 60_000_000, 20_000_000], c, STARTUP_MS);
    expect(c.target()).toBe(12);
  });

  it('does not read a window after a zero-byte one as growth', () => {
    const c = createAdaptiveController();
    // A window where nothing completed is followed by one carrying two windows'
    // worth of files. Taking that as growth would keep startup climbing on
    // evidence the lane count never earned, so it re-baselines instead — and
    // the size it lands on is the one the fresh baseline measured, not the one
    // before the gap.
    const path = trajectory([30_000_000, 0, 60_000_000, 30_000_000], c, STARTUP_MS);
    expect(path).toEqual([12, 12, 18, 12]);
  });

  it('gives up on a path that never reports bytes and hands off', () => {
    const c = createAdaptiveController();
    trajectory(Array(8).fill(0), c, STARTUP_MS);
    expect(c.target()).toBe(8);
    expect(c.windowMs()).toBe(MS);
  });

  it('hands off once lanes reach the ceiling', () => {
    const c = createAdaptiveController({ max: 12 });
    trajectory([10_000_000, 20_000_000], c, STARTUP_MS);
    expect(c.target()).toBe(12);
    expect(c.windowMs()).toBe(MS);
  });

  it('respects custom bounds', () => {
    const c = createAdaptiveController({ start: 4, min: 3, max: 6 });
    const path = trajectory([1e6, 2e6, 4e6, 8e6], c, STARTUP_MS);
    expect(path).toEqual([6, 6, 6, 6]);
  });

  // The failure the startup phase exists to fix: on a 30 s live run the old
  // ±2-lane / 12 s-window climb only produced two windows and was still short
  // of the knee when the payload ran out.
  it('reaches a 12-lane knee well inside 15 seconds', () => {
    const knee = 12;
    // Near-linear in lanes until the bottleneck saturates, then congestion.
    const rate = (lanes: number) =>
      50 * (Math.min(lanes, knee) / knee) * (1 - 0.06 * Math.max(0, lanes - knee));

    const c = createAdaptiveController();
    let elapsed = 0;
    let reached = Infinity;
    while (c.windowMs() === STARTUP_MS && elapsed < 60_000) {
      const ms = c.windowMs();
      c.onWindow({ bytes: rate(c.target()) * ms, ms });
      elapsed += ms;
      if (c.target() >= knee - 1) reached = Math.min(reached, elapsed);
    }
    expect(reached).toBeLessThanOrEqual(6_000);
    expect(elapsed).toBeLessThanOrEqual(12_000);
    expect(c.target()).toBe(knee);
  });
});

describe('adaptive steady state', () => {
  it('inherits the startup size and switches to long windows', () => {
    const c = createAdaptiveController();
    settled(c);
    expect(c.target()).toBe(12);
    expect(c.windowMs()).toBe(MS);
  });

  it('climbs while throughput keeps improving and settles at the cap', () => {
    const c = createAdaptiveController();
    const bar = settled(c);
    const rates = Array.from({ length: 20 }, (_, i) => bar * MS * 1.2 ** (i + 1));
    const path = trajectory(rates, c, MS);

    expect(path.slice(0, 4)).toEqual([14, 16, 18, 20]);
    expect(path.at(-1)).toBe(32);
  });

  it('reverts a probe that buys nothing and settles at the paying size', () => {
    const c = createAdaptiveController();
    const bar = settled(c);
    // The probe to 14 comes back flat against the bar startup handed over.
    expect(trajectory([bar * MS * 1.01], c, MS)).toEqual([12]);
  });

  it('re-probes after three settled flat windows instead of holding forever', () => {
    const c = createAdaptiveController();
    const bar = settled(c);
    const path = trajectory([bar * MS, bar * MS, bar * MS, bar * MS], c, MS);
    // The third settled flat window probes again; the fourth finds the probe
    // bought nothing and reverts it.
    expect(path).toEqual([12, 12, 14, 12]);
  });

  it('reverses after a regression and settles for one window', () => {
    const c = createAdaptiveController();
    const bar = settled(c);

    // A regression backs off one step in the other direction…
    c.onWindow({ bytes: bar * MS * 0.6, ms: MS });
    expect(c.target()).toBe(10);
    // …and the next window is a settling window, not a decision.
    c.onWindow({ bytes: bar * MS * 2, ms: MS });
    expect(c.target()).toBe(10);
    // Then improvement continues in the new (downward) direction.
    c.onWindow({ bytes: bar * MS * 3, ms: MS });
    expect(c.target()).toBe(8);
  });

  it('respects the lower bound while descending', () => {
    const c = createAdaptiveController();
    const bar = settled(c);
    const path = trajectory(
      [0.5, 0.5, 1, 2, 4, 8, 16].map((f) => bar * MS * f),
      c,
      MS,
    );
    expect(path).toEqual([10, 10, 8, 6, 4, 2, 2]);
    expect(Math.min(...path)).toBe(2);
  });

  it('treats a zero-byte window after a moving one as a regression', () => {
    const c = createAdaptiveController();
    settled(c);
    c.onWindow({ bytes: 0, ms: MS });
    expect(c.target()).toBe(10);
  });

  // A network outage parks every lane in `waitForOnline`, so its windows carry
  // no bytes through no fault of the lane count. The engine drops those windows
  // rather than reporting them (see the `navigator.onLine` guard in upload.ts);
  // this pins what that buys — the climb picks up where it left off instead of
  // reversing, which is what the previous test shows an unsuppressed one does.
  it('keeps its size across a suppressed offline window', () => {
    const c = createAdaptiveController();
    const bar = settled(c);
    // The outage windows never reach the controller at all.
    expect(c.target()).toBe(12);
    trajectory([bar * MS * 1.5], c, MS);
    expect(c.target()).toBe(14);
  });
});
