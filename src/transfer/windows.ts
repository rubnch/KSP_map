import { TransferProblem, wrapDeg, type Transfer } from './transfer.ts';

/**
 * Transfer windows in two steps:
 * 1. Predict: with circular orbits, a window opens whenever the phase angle (how far the target
 *    is ahead of the origin) equals the Hohmann phase angle. That repeats every synodic period.
 * 2. Refine: around each prediction, search departure date and time of flight with the Lambert
 *    solver on the real (eccentric, inclined) orbits for the lowest total Δv.
 */

/** Times in [from, to] when the phase angle equals the ideal Hohmann phase angle. */
export function predictWindows(problem: TransferProblem, from: number, to: number): number[] {
  const o = problem.origin.orbit!;
  const t = problem.target.orbit!;
  const rate = ((t.n - o.n) * 180) / Math.PI; // deg/s, change of the phase angle
  const S = problem.synodicPeriod;
  const err = (time: number) => wrapDeg(problem.phaseAngleAt(time) - problem.idealPhaseAngle);

  // Next crossing after `from` with the mean rate, then a few secant steps on the real orbits.
  let guess = from - err(from) / rate;
  while (guess < from - S * 0.25) guess += S;
  const out: number[] = [];
  for (let k = 0; k < 10_000; k++) {
    let x = guess;
    for (let i = 0; i < 8; i++) {
      const step = err(x) / rate;
      x -= step;
      if (Math.abs(step) < 60) break;
    }
    if (x > to) break;
    if (x >= from - S * 0.25 && (out.length === 0 || x - out[out.length - 1]! > S * 0.5)) out.push(x);
    guess = x + S;
  }
  return out;
}

/** Time-of-flight range worth searching (the same range alexmoon's planner opens with). */
export function timeOfFlightRange(problem: TransferProblem): [number, number] {
  const tH = problem.hohmannTime;
  const Pt = problem.target.orbit!.period;
  const min = Math.max(tH - Pt, tH / 2);
  return [min, min + Math.min(2 * Pt, tH)];
}

export interface TransferWindow {
  /** Departure date predicted by the circular-orbit phase angle. */
  predicted: number;
  /** Best transfer found around it. */
  best: Transfer;
  /** Departure dates around `best` where Δv stays within 10% of it. */
  open: number;
  close: number;
}

const GRID_DEP = 64;
const GRID_TOF = 40;

/** Searches around a predicted window for the cheapest transfer. */
export function refineWindow(problem: TransferProblem, predicted: number, earliest = 0): TransferWindow | null {
  const S = problem.synodicPeriod;
  const half = Math.min(S * 0.3, Math.max(problem.origin.orbit!.period, problem.target.orbit!.period) * 0.5);
  const depFrom = Math.max(earliest, predicted - half);
  const depTo = predicted + half;
  const [tofFrom, tofTo] = timeOfFlightRange(problem);
  const dDep = (depTo - depFrom) / (GRID_DEP - 1);
  const dTof = (tofTo - tofFrom) / (GRID_TOF - 1);

  // Coarse grid, keeping the best time of flight for each departure column.
  const grid = new Float64Array(GRID_DEP * GRID_TOF).fill(Infinity);
  const columnBest = new Float64Array(GRID_DEP).fill(Infinity);
  for (let i = 0; i < GRID_DEP; i++) {
    const dep = depFrom + i * dDep;
    for (let j = 0; j < GRID_TOF; j++) {
      const dv = problem.dv(dep, tofFrom + j * dTof);
      if (!(dv < Infinity)) continue;
      grid[i * GRID_TOF + j] = dv;
      if (dv < columnBest[i]!) columnBest[i] = dv;
    }
  }

  // The Δv surface often has several basins (short and long transfers): refine the best few
  // local minima of the grid and keep the cheapest.
  const minima: { i: number; j: number; dv: number }[] = [];
  for (let i = 0; i < GRID_DEP; i++) {
    for (let j = 0; j < GRID_TOF; j++) {
      const v = grid[i * GRID_TOF + j]!;
      if (!Number.isFinite(v)) continue;
      let isMin = true;
      for (let di = -1; di <= 1 && isMin; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const ii = i + di;
          const jj = j + dj;
          if ((di || dj) && ii >= 0 && jj >= 0 && ii < GRID_DEP && jj < GRID_TOF && grid[ii * GRID_TOF + jj]! < v) {
            isMin = false;
            break;
          }
        }
      }
      if (isMin) minima.push({ i, j, dv: v });
    }
  }
  if (!minima.length) return null;
  minima.sort((a, b) => a.dv - b.dv);

  let best = { dv: Infinity, dep: predicted, tof: problem.hohmannTime };
  for (const m of minima.slice(0, 6)) {
    const r = compassSearch(problem, depFrom + m.i * dDep, tofFrom + m.j * dTof, m.dv, dDep, dTof, depFrom, depTo);
    if (r.dv < best.dv) best = r;
  }
  const { dep, tof } = best;
  // Cheapest at the edge of the range: the real minimum is outside it (or in the past).
  if (dep - depFrom < 3600 || depTo - dep < 3600) return null;
  const transfer = problem.transfer(dep, tof);
  if (!transfer) return null;

  // Window edges: walk out from the best column while within 10% of the optimum.
  const limit = transfer.dv * 1.1;
  const bestCol = Math.round((dep - depFrom) / dDep);
  let lo = Math.max(0, Math.min(GRID_DEP - 1, bestCol));
  let hi = lo;
  while (lo > 0 && columnBest[lo - 1]! <= limit) lo--;
  while (hi < GRID_DEP - 1 && columnBest[hi + 1]! <= limit) hi++;
  return {
    predicted,
    best: transfer,
    open: Math.min(dep, depFrom + (lo - 0.5) * dDep),
    close: Math.max(dep, depFrom + (hi + 0.5) * dDep),
  };
}

/** Every window departing between `from` and `to`. */
export function findWindows(problem: TransferProblem, from: number, to: number): TransferWindow[] {
  const out: TransferWindow[] = [];
  for (const p of predictWindows(problem, from, to)) {
    const w = refineWindow(problem, p, from);
    if (!w || w.best.departure > to) continue;
    // Two predictions can converge on the same optimum near the range ends.
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.best.departure - w.best.departure) < problem.synodicPeriod * 0.25) {
      if (w.best.dv < prev.best.dv) out[out.length - 1] = w;
      continue;
    }
    out.push(w);
  }
  return out;
}

export interface PorkchopGrid {
  depFrom: number;
  depTo: number;
  tofFrom: number;
  tofTo: number;
  width: number;
  height: number;
  /** Row-major, row 0 = shortest time of flight. NaN where there is no solution. */
  dv: Float32Array;
  min: { dv: number; departure: number; timeOfFlight: number };
}

/** Departure date × time of flight grid of total Δv. */
export function porkchop(
  problem: TransferProblem,
  depFrom: number,
  depTo: number,
  tofFrom: number,
  tofTo: number,
  width: number,
  height: number,
): PorkchopGrid {
  const dv = new Float32Array(width * height);
  let min = { dv: Infinity, departure: depFrom, timeOfFlight: tofFrom };
  for (let j = 0; j < height; j++) {
    const tof = tofFrom + ((tofTo - tofFrom) * j) / (height - 1);
    for (let i = 0; i < width; i++) {
      const dep = depFrom + ((depTo - depFrom) * i) / (width - 1);
      const v = problem.dv(dep, tof);
      dv[j * width + i] = v;
      if (v < min.dv) min = { dv: v, departure: dep, timeOfFlight: tof };
    }
  }
  return { depFrom, depTo, tofFrom, tofTo, width, height, dv, min };
}

/** Porkchop range around a window: a synodic period of departures, the planner's flight times. */
export function porkchopRange(problem: TransferProblem, center: number, earliest = 0) {
  const half = Math.min(problem.synodicPeriod, 2 * problem.origin.orbit!.period) / 2;
  const depFrom = Math.max(earliest, center - half);
  const [tofFrom, tofTo] = timeOfFlightRange(problem);
  return { depFrom, depTo: depFrom + 2 * half, tofFrom, tofTo };
}

/** Pattern search on (departure, time of flight) down to ~30 s steps, departure kept in range. */
function compassSearch(
  problem: TransferProblem,
  dep: number,
  tof: number,
  dv: number,
  sDep: number,
  sTof: number,
  depMin: number,
  depMax: number,
) {
  for (let iter = 0; iter < 400 && (sDep > 30 || sTof > 30); iter++) {
    let moved = false;
    for (const [a, b] of [
      [sDep, 0],
      [-sDep, 0],
      [0, sTof],
      [0, -sTof],
    ] as const) {
      const nd = dep + a;
      const nt = tof + b;
      if (nd < depMin || nd > depMax || nt <= 0) continue;
      const v = problem.dv(nd, nt);
      if (v < dv) {
        dep = nd;
        tof = nt;
        dv = v;
        moved = true;
        break;
      }
    }
    if (!moved) {
      sDep /= 2;
      sTof /= 2;
    }
  }
  return { dep, tof, dv };
}
