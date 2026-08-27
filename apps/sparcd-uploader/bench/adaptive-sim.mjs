#!/usr/bin/env node
// Race for the adaptive-concurrency startup policy.
//
//   node --experimental-strip-types bench/adaptive-sim.mjs [--seeds 100]
//
// The live runs said the hill climber never converges on a real batch: a 30 s /
// 1.2 GB upload only produced two 12 s windows (8 -> 10 -> 12 lanes) and was
// still climbing when the payload ran out. This models the path so candidate
// startup policies can be compared over hundreds of runs instead of one.
//
// Candidates:
//   A0     the shipping hill climber, frozen here as the baseline
//   A1     BBR-style startup (3 s windows, x1.5 growth) then hand off to A0
//   A1b    same, but steps back to the last window that clearly paid rather
//          than to the fastest window seen
//   A2     one regime: 4.5 s windows, +2 / x0.75 AIMD
//
// The shipping controller runs as a fifth column, so this file also guards
// against the implementation drifting away from the candidate that won.

import { createAdaptiveController } from '../src/lib/adaptiveConcurrency.ts';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const SEEDS = opt('seeds', 100);

// --- randomness --------------------------------------------------------------

const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const gaussian = (rand) => {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

// --- path model --------------------------------------------------------------

// Throughput vs lane count. On a long-haul path each lane is window-limited,
// so throughput is close to linear in lanes until the bottleneck saturates —
// a soft min of `lanes/knee` and 1, with a congestion penalty past the knee.
// Calibrated to the live numbers: the 4-origin shard path peaks near 12 lanes
// / 50 MB/s, the 1-origin control near 10 lanes / 25 MB/s.
const SHARPNESS = 6;
const softMinOne = (x) => -Math.log(Math.exp(-SHARPNESS * x) + Math.exp(-SHARPNESS)) / SHARPNESS;
const AT_KNEE = softMinOne(1);
const rateFor = (lanes, { peak, knee }) => {
  const over = Math.max(0, lanes - knee);
  return (peak * softMinOne(lanes / knee)) / AT_KNEE / (1 + 0.06 * over);
};

const bestLanes = (path) => {
  let best = 1;
  for (let n = 1; n <= 32; n++) if (rateFor(n, path) > rateFor(best, path)) best = n;
  return best;
};

const DT = 0.25; // simulation tick, seconds
const RAMP_TAU = 1.2; // seconds for a lane change to reach full effect

// --- candidate controllers ---------------------------------------------------

const clampTo = (n, min, max) => Math.min(max, Math.max(min, n));

// A0: verbatim copy of the shipping hill climber as of 07bf648.
function a0({ start = 8, step = 2, min = 2, max = 32, threshold = 0.05 } = {}) {
  const clamp = (n) => clampTo(n, min, max);
  let target = clamp(start);
  let direction = 1;
  let best = null;
  let holding = false;
  let prevBytes = -1;
  let probing = false;
  let flats = 0;
  const move = () => {
    const next = clamp(target + direction * step);
    if (next === target) return false;
    target = next;
    return true;
  };
  return {
    windowMs: () => 12_000,
    target: () => target,
    // Entry point for a startup phase handing over a converged lane count.
    adopt: (lanes, rate) => {
      target = clamp(lanes);
      best = rate;
      direction = 1;
      probing = false;
      flats = 0;
      prevBytes = 1;
    },
    onWindow: ({ bytes, ms }) => {
      const wasMoving = prevBytes > 0;
      prevBytes = bytes;
      if (bytes === 0 && !wasMoving) return;
      const rate = ms > 0 ? bytes / ms : 0;
      if (best === null) {
        best = rate;
        probing = move();
        return;
      }
      if (holding) {
        holding = false;
        best = rate;
        return;
      }
      if (rate > best * (1 + threshold)) {
        best = rate;
        flats = 0;
        probing = move();
      } else if (rate < best * (1 - threshold)) {
        best = rate;
        flats = 0;
        direction = -direction;
        probing = move();
        holding = true;
      } else if (probing) {
        best = Math.max(best, rate);
        target = clamp(target - direction * step);
        probing = false;
        flats = 0;
      } else {
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

// A1 / A1b: BBR-style startup ahead of the A0 hill climber. `stepBack` picks
// which lane count startup falls back to when growth plateaus.
function a1({ stepBack = 'fastest', bailOnDrop = false, windowMs = 3_000, ...opts } = {}) {
  const { start = 8, min = 2, max = 32 } = opts;
  const climber = a0(opts);
  const clamp = (n) => clampTo(n, min, max);
  let phase = 'startup';
  let target = clamp(start);
  let prevRate = null;
  let flatRounds = 0;
  let bestRate = 0;
  let bestTarget = target;
  let payingTarget = target;
  let payingRate = 0;
  const grow = () => {
    target = clamp(Math.ceil(target * 1.5));
  };
  return {
    windowMs: () => (phase === 'startup' ? windowMs : 12_000),
    target: () => (phase === 'startup' ? target : climber.target()),
    onWindow: (sample) => {
      if (phase !== 'startup') return climber.onWindow(sample);
      const { bytes, ms } = sample;
      const rate = ms > 0 ? bytes / ms : 0;
      const measured = target;
      if (rate > bestRate) {
        bestRate = rate;
        bestTarget = measured;
      }
      // The first window covers lanes spinning up from nothing, so it has no
      // gradient to read — take it as the baseline and grow unconditionally.
      if (prevRate === null) {
        prevRate = rate;
        payingTarget = measured;
        payingRate = rate;
        if (target < max) grow();
        return;
      }
      const growth = prevRate > 0 ? rate / prevRate - 1 : 1;
      prevRate = rate;
      if (growth >= 0.2) {
        flatRounds = 0;
        payingTarget = measured;
        payingRate = rate;
      } else {
        flatRounds += bailOnDrop && growth <= -0.1 ? 2 : 1;
      }
      if (flatRounds >= 2 || target >= max) {
        phase = 'climb';
        // The bar has to be the rate measured at the size being adopted, or the
        // climber's first window reads as a regression and undoes the handoff.
        if (stepBack === 'fastest') climber.adopt(bestTarget, bestRate);
        else climber.adopt(payingTarget, payingRate);
        return;
      }
      grow();
    },
  };
}

// A2: no separate startup — short windows, additive increase, multiplicative
// decrease, with a confirmation window before any cut.
function a2({ start = 8, step = 2, min = 2, max = 32, threshold = 0.05 } = {}) {
  const clamp = (n) => clampTo(n, min, max);
  let target = clamp(start);
  let best = null;
  let probing = false;
  let holding = false;
  let regressions = 0;
  let flats = 0;
  return {
    windowMs: () => 4_500,
    target: () => target,
    onWindow: ({ bytes, ms }) => {
      const rate = ms > 0 ? bytes / ms : 0;
      if (best === null) {
        best = rate;
        target = clamp(target + step);
        probing = true;
        return;
      }
      if (holding) {
        holding = false;
        best = rate;
        return;
      }
      if (rate > best * (1 + threshold)) {
        best = rate;
        regressions = 0;
        flats = 0;
        target = clamp(target + step);
        probing = true;
      } else if (rate < best * (1 - 0.1)) {
        regressions++;
        if (regressions >= 2 || rate < best * 0.75) {
          regressions = 0;
          best = rate;
          target = clamp(Math.round(target * 0.75));
          probing = false;
          holding = true;
        }
      } else {
        best = Math.max(best, rate);
        regressions = 0;
        if (probing) {
          target = clamp(target - step);
          probing = false;
          flats = 0;
        } else {
          flats++;
          if (flats >= 3) {
            flats = 0;
            target = clamp(target + step);
            probing = true;
          }
        }
      }
    },
  };
}

// --- simulation --------------------------------------------------------------

function simulate({ scenario, controller, seed, fixedLanes = null }) {
  const rand = mulberry32(seed);
  const { durationS, path: path0, mutate, offline, sigmaSlow, sigmaFast } = scenario;
  const rho = Math.exp(-DT / 8);
  let path = path0;
  let logSlow = 0;
  let eff = 0;
  let bytes = 0;
  let windowBytes = 0;
  let windowMs = 0;
  let nextWindow = controller ? controller.windowMs?.() ?? 12_000 : Infinity;
  const alpha = 1 - Math.exp(-DT / RAMP_TAU);
  const trail = [];
  const marks = {};
  let t90 = null;

  for (let step = 0; step * DT < durationS; step++) {
    const t = step * DT;
    if (mutate) path = mutate(t) ?? path;
    const isOffline = offline ? t >= offline[0] && t < offline[1] : false;

    const target = fixedLanes ?? controller.target();
    eff += (target - eff) * alpha;

    logSlow = rho * logSlow + Math.sqrt(1 - rho * rho) * sigmaSlow * gaussian(rand);
    const noise = Math.exp(
      logSlow + sigmaFast * gaussian(rand) - 0.5 * (sigmaSlow ** 2 + sigmaFast ** 2),
    );
    const moved = isOffline ? 0 : rateFor(eff, path) * noise * DT;
    bytes += moved;
    windowBytes += moved;
    windowMs += DT * 1000;

    if (t90 === null && rateFor(target, path) >= 0.9 * rateFor(bestLanes(path), path)) {
      t90 = t;
    }
    if (t >= durationS * 0.6) trail.push(target);

    if (controller && windowMs >= nextWindow) {
      // Mirrors the sampler in upload.ts: a window that ends while the browser
      // is offline is rolled forward, never fed to the controller.
      if (!isOffline) controller.onWindow({ bytes: windowBytes, ms: windowMs });
      windowBytes = 0;
      windowMs = 0;
      nextWindow = controller.windowMs?.() ?? 12_000;
    }
    for (const mark of [30, 60]) {
      if (marks[mark] === undefined && t + DT >= mark) marks[mark] = bytes;
    }
  }
  const mean = trail.reduce((a, b) => a + b, 0) / (trail.length || 1);
  const osc = Math.sqrt(trail.reduce((a, b) => a + (b - mean) ** 2, 0) / (trail.length || 1));
  return {
    bytes,
    at30: marks[30] ?? bytes,
    at60: marks[60] ?? bytes,
    t90: t90 ?? durationS,
    osc,
  };
}

// --- scenarios ---------------------------------------------------------------

const SHARDED = { peak: 50, knee: 12 };
const SINGLE = { peak: 25, knee: 10 };
const NOISE = { sigmaSlow: 0.12, sigmaFast: 0.3 };

const SCENARIOS = [
  { name: '1. 30 s run (4-origin)', durationS: 30, path: SHARDED, ...NOISE },
  { name: '2. 3 min run (4-origin)', durationS: 180, path: SHARDED, ...NOISE },
  {
    name: '3. capacity halves at 90 s',
    durationS: 180,
    path: SHARDED,
    mutate: (t) => (t >= 90 ? { peak: 25, knee: 8 } : SHARDED),
    ...NOISE,
  },
  { name: '4. high-noise path', durationS: 90, path: SHARDED, sigmaSlow: 0.25, sigmaFast: 0.55 },
  { name: '5. 10 s offline blip', durationS: 60, path: SHARDED, offline: [20, 30], ...NOISE },
  { name: '6. 60 s run (1-origin)', durationS: 60, path: SINGLE, ...NOISE },
];

const CANDIDATES = {
  A0: () => a0(),
  A1: () => a1(),
  A1b: () => a1({ stepBack: 'paying' }),
  A1c: () => a1({ stepBack: 'paying', bailOnDrop: true }),
  A1d: () => a1({ stepBack: 'paying', bailOnDrop: true, windowMs: 4_000 }),
  A2: () => a2(),
  ship: () => createAdaptiveController(),
};

// --- run ---------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n, d = 1) => String(v.toFixed(d)).padStart(n);

console.log(`adaptive concurrency simulation — ${SEEDS} seeds per cell\n`);
const totals = Object.fromEntries(Object.keys(CANDIDATES).map((k) => [k, { b30: 0, b60: 0 }]));

for (const scenario of SCENARIOS) {
  // The oracle holds the optimal lane count for the whole run under the same
  // noise realization, so the ratio isolates the controller's decisions.
  const oracleLanes = bestLanes(scenario.path);
  const acc = {};
  let oracle = { bytes: 0, at30: 0, at60: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const o = simulate({ scenario, controller: null, seed, fixedLanes: oracleLanes });
    oracle = { bytes: oracle.bytes + o.bytes, at30: oracle.at30 + o.at30, at60: oracle.at60 + o.at60 };
    for (const [name, make] of Object.entries(CANDIDATES)) {
      const r = simulate({ scenario, controller: make(), seed });
      const a = (acc[name] ??= { bytes: 0, at30: 0, at60: 0, t90: 0, osc: 0 });
      a.bytes += r.bytes;
      a.at30 += r.at30;
      a.at60 += r.at60;
      a.t90 += r.t90;
      a.osc += r.osc;
    }
  }
  console.log(`${scenario.name}  (oracle ${oracleLanes} lanes)`);
  console.log(`  ${pad('cand', 5)}${pad('bytes/oracle', 14)}${pad('MB@30s', 9)}${pad('MB@60s', 9)}${pad('t90 (s)', 9)}osc`);
  for (const [name, a] of Object.entries(acc)) {
    totals[name].b30 += a.at30 / oracle.at30;
    totals[name].b60 += a.at60 / oracle.at60;
    console.log(
      `  ${pad(name, 5)}${num((100 * a.bytes) / oracle.bytes, 11, 1)}%  ${num(a.at30 / SEEDS, 8, 0)} ${num(a.at60 / SEEDS, 8, 0)} ${num(a.t90 / SEEDS, 8, 1)} ${num(a.osc / SEEDS, 5, 2)}`,
    );
  }
  console.log('');
}

console.log('mean fraction of oracle across all scenarios');
console.log(`  ${pad('cand', 5)}${pad('@30s', 9)}@60s`);
for (const [name, t] of Object.entries(totals)) {
  console.log(
    `  ${pad(name, 5)}${num((100 * t.b30) / SCENARIOS.length, 7, 1)}%  ${num((100 * t.b60) / SCENARIOS.length, 6, 1)}%`,
  );
}
