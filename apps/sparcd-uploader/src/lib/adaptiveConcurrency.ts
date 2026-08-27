// Adaptive upload concurrency: a fast multiplicative search for the knee,
// then a hill climber that holds it.
//
// The right lane count for a long-haul, lossy path isn't knowable up front —
// too few lanes leave the pipe idle, too many draw server pushback and
// congestion loss. So the engine measures instead: every window it reports the
// bytes that landed, and this controller decides where the lane target goes.
//
// The hill climber alone converged far too slowly to matter. Its 12 s windows
// and ±2 steps need roughly half a minute to walk from the starting guess to a
// knee at 12 lanes, and a typical batch is over before that. So startup
// borrows from BBR: short 3 s windows and ×1.5 lane growth for as long as each
// window moves clearly more than the last, then a step back to the last lane
// count that clearly paid, then the hill climber takes over for the long tail.
// `bench/adaptive-sim.mjs` is the race that picked this shape.
//
// Deliberately pure: no clock, no timers, no I/O. The engine supplies both the
// bytes and the elapsed time of each window, which makes the whole policy
// testable by feeding it a sequence.

export type WindowSample = { bytes: number; ms: number };

export type AdaptiveController = {
  /** Lane target the pool should currently hold. */
  target: () => number;
  /** How long the engine should measure before reporting the next window. */
  windowMs: () => number;
  /** Feed one measurement window; may move the target. */
  onWindow: (sample: WindowSample) => void;
};

export type AdaptiveOptions = {
  start?: number;
  step?: number;
  min?: number;
  max?: number;
  /** Relative rate change that counts as signal rather than noise. */
  threshold?: number;
  /** Startup window. Short enough to converge inside a small batch. */
  startupMs?: number;
  /** Steady-state window. Long enough that one slow file isn't a collapse. */
  windowMs?: number;
  /** Lane multiplier per startup round. */
  growth?: number;
  /** Relative gain that keeps startup growing. */
  startupGain?: number;
};

const DEFAULTS = {
  start: 8,
  step: 2,
  min: 2,
  max: 32,
  threshold: 0.05,
  startupMs: 3_000,
  windowMs: 12_000,
  growth: 1.5,
  startupGain: 0.2,
};

type HillClimber = {
  target: () => number;
  /**
   * Take over from startup at a lane count already known to pay, with the rate
   * measured at that lane count as the bar. A null rate means startup never got
   * a measurement, so the climber baselines on its own first window instead.
   */
  adopt: (lanes: number, rate: number | null) => void;
  onWindow: (sample: WindowSample) => void;
};

function createHillClimber(o: Required<AdaptiveOptions>): HillClimber {
  const clamp = (n: number) => Math.min(o.max, Math.max(o.min, n));

  let target = clamp(o.start);
  let direction = 1; // climb first: the starting point is a guess, not a peak
  let best: number | null = null; // rate to beat; null until the first measured window
  let holding = false; // one settling window is skipped after a reversal
  let prevBytes = -1; // previous window's bytes; -1 = no window yet
  let probing = false; // the last window carried a fresh move awaiting its verdict
  let flats = 0; // consecutive settled flat windows since the last probe

  /** Step in the current direction; false when pinned at a bound. */
  const move = (): boolean => {
    const next = clamp(target + direction * o.step);
    if (next === target) return false;
    target = next;
    return true;
  };

  return {
    target: () => target,
    adopt: (lanes, rate) => {
      target = clamp(lanes);
      best = rate;
      direction = 1;
      holding = false;
      probing = false;
      flats = 0;
      prevBytes = rate === null ? -1 : 1;
    },
    onWindow: ({ bytes, ms }) => {
      // Files under the streaming threshold report their bytes only once they
      // complete, so an all-zero window usually means "nothing has landed yet",
      // not "throughput collapsed". It's a real signal only when the window
      // before it was moving bytes.
      const wasMoving = prevBytes > 0;
      prevBytes = bytes;
      if (bytes === 0 && !wasMoving) return;

      const rate = ms > 0 ? bytes / ms : 0;
      if (best === null) {
        // First measured window is the baseline — and the first probe: a hill
        // climber has no gradient to read until the target actually moves.
        best = rate;
        probing = move();
        return;
      }
      if (holding) {
        // Post-reversal window: lanes were still draining, so it measures the
        // transition rather than the new size. Re-baseline on it and move on.
        holding = false;
        best = rate;
        return;
      }

      if (rate > best * (1 + o.threshold)) {
        best = rate;
        flats = 0;
        probing = move(); // still paying off — keep going; pinned at a bound = settled
      } else if (rate < best * (1 - o.threshold)) {
        best = rate; // re-baseline: the old peak may no longer be reachable
        flats = 0;
        direction = -direction;
        probing = move();
        holding = true;
      } else if (probing) {
        // The probe bought nothing — undo it. This is what stops flat
        // throughput from silently ratcheting lanes toward the cap.
        best = Math.max(best, rate);
        target = clamp(target - direction * o.step);
        probing = false;
        flats = 0;
      } else {
        // Settled and flat. Conditions drift, so sitting still forever means
        // never noticing new headroom — re-probe every third window; an
        // unpaying probe reverts above, a hurtful one reverses via regression.
        best = Math.max(best, rate);
        flats++;
        if (flats >= 3) {
          flats = 0;
          if (!move()) {
            direction = -direction;
            move();
          }
          probing = true;
        }
      }
    },
  };
}

// Startup ends after two rounds without clear growth. A round that lost ≥10%
// counts double: a drop says the knee is already behind us, which is stronger
// evidence than a plateau and not worth spending another window to confirm.
const PLATEAU_ROUNDS = 2;
const DROP = 0.1;
// Startup can only stall on a path that reports no bytes for round after round.
// Bound it so a pathological batch still ends up under the hill climber.
const MAX_STARTUP_ROUNDS = 8;

export function createAdaptiveController(opts: AdaptiveOptions = {}): AdaptiveController {
  const o = { ...DEFAULTS, ...opts };
  const clamp = (n: number) => Math.min(o.max, Math.max(o.min, n));
  const climber = createHillClimber(o);

  let startup = true;
  let target = clamp(o.start);
  let prevRate: number | null = null;
  let flatRounds = 0;
  let rounds = 0;
  // The most recent lane count that clearly paid, and the rate measured *at
  // that lane count*. The hill climber inherits both, so its first window isn't
  // spent rediscovering a baseline. The two have to travel together: startup
  // usually peaks at a lane count past the one it settles on, and handing the
  // climber a bar it can't reach at the size it was given makes the first
  // honest window read as a regression and give lanes straight back.
  let payingLanes = target;
  let payingRate: number | null = null;

  const handOff = () => {
    startup = false;
    climber.adopt(payingLanes, payingRate);
  };

  return {
    target: () => (startup ? target : climber.target()),
    windowMs: () => (startup ? o.startupMs : o.windowMs),
    onWindow: (sample) => {
      if (!startup) return climber.onWindow(sample);

      rounds++;
      const rate = sample.ms > 0 ? sample.bytes / sample.ms : 0;
      if (sample.bytes === 0) {
        // Nothing landed, so there is no gradient. Drop the round and start the
        // comparison over — the next window is a fresh baseline (measuring it
        // against a window that reported nothing would read as runaway growth),
        // and the plateau count restarts with it, since rounds either side of
        // the gap were never consecutive measurements of anything.
        prevRate = null;
        flatRounds = 0;
        if (rounds >= MAX_STARTUP_ROUNDS) handOff();
        return;
      }

      // The first window covers lanes spinning up from nothing, so it measures
      // the ramp rather than the path. Baseline on it and grow regardless — and
      // bank the size, since a window that moved bytes is evidence for the lane
      // count that moved them even when there's nothing to compare it against.
      if (prevRate === null) {
        prevRate = rate;
        payingLanes = target;
        payingRate = rate;
      } else {
        const growth = rate / prevRate - 1;
        prevRate = rate;
        if (growth >= o.startupGain) {
          flatRounds = 0;
          payingLanes = target;
          payingRate = rate;
        } else {
          flatRounds += growth <= -DROP ? PLATEAU_ROUNDS : 1;
        }
      }

      if (flatRounds >= PLATEAU_ROUNDS || target >= o.max || rounds >= MAX_STARTUP_ROUNDS) {
        handOff();
        return;
      }
      target = clamp(Math.ceil(target * o.growth));
    },
  };
}
