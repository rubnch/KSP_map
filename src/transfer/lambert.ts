import { cross, dot, length, scale, sub, type Vec3 } from '../core/index.ts';

/**
 * Lambert's problem: the conic through r1 and r2 that takes `tof` seconds, prograde around
 * `normal` (the direction the transfer's angular momentum should point to; usually the origin
 * body's orbit normal). Single revolution only.
 *
 * Izzo's algorithm: D. Izzo, "Revisiting Lambert's problem", Celestial Mechanics and Dynamical
 * Astronomy 121 (2015), with Householder iterations on x, as described in the paper.
 *
 * Returns null when there is no solution (zero time of flight, or r1 and r2 exactly opposite
 * with no plane defined).
 */
export function lambert(mu: number, r1: Vec3, r2: Vec3, tof: number, normal: Vec3 = [0, 0, 1]): LambertSolution | null {
  if (!(tof > 0)) return null;
  const c = sub(r2, r1);
  const cn = length(c);
  const r1n = length(r1);
  const r2n = length(r2);
  const s = (r1n + r2n + cn) / 2;
  const ir1 = scale(r1, 1 / r1n);
  const ir2 = scale(r2, 1 / r2n);
  let ih = cross(ir1, ir2);
  const ihn = length(ih);
  let lambda = Math.sqrt(Math.max(0, 1 - Math.min(1, cn / s)));
  if (ihn < 1e-12) {
    // r1 and r2 are colinear: the plane is undefined; take the reference normal.
    ih = normal;
  } else {
    ih = scale(ih, 1 / ihn);
  }
  // Transfer angle above 180° (going the long way round to stay prograde).
  if (dot(ih, normal) < 0) {
    lambda = -lambda;
    ih = scale(ih, -1);
  }
  const it1 = cross(ih, ir1);
  const it2 = cross(ih, ir2);
  const T = Math.sqrt((2 * mu) / (s * s * s)) * tof;

  const x = findX(lambda, T);
  if (x === null) return null;
  const y = computeY(x, lambda);

  const gamma = Math.sqrt((mu * s) / 2);
  const rho = (r1n - r2n) / cn;
  const sigma = Math.sqrt(Math.max(0, 1 - rho * rho));
  const vr1 = (gamma * (lambda * y - x - rho * (lambda * y + x))) / r1n;
  const vr2 = (-gamma * (lambda * y - x + rho * (lambda * y + x))) / r2n;
  const vt1 = (gamma * sigma * (y + lambda * x)) / r1n;
  const vt2 = (gamma * sigma * (y + lambda * x)) / r2n;

  const v1: Vec3 = [ir1[0] * vr1 + it1[0] * vt1, ir1[1] * vr1 + it1[1] * vt1, ir1[2] * vr1 + it1[2] * vt1];
  const v2: Vec3 = [ir2[0] * vr2 + it2[0] * vt2, ir2[1] * vr2 + it2[1] * vt2, ir2[2] * vr2 + it2[2] * vt2];
  // Transfer angle, 0..2π, measured prograde.
  const angle = lambda >= 0 ? Math.acos(clamp(dot(ir1, ir2))) : 2 * Math.PI - Math.acos(clamp(dot(ir1, ir2)));
  return { v1, v2, angle };
}

export interface LambertSolution {
  /** Velocity at r1. */
  v1: Vec3;
  /** Velocity at r2. */
  v2: Vec3;
  /** Transfer angle, radians, 0..2π. */
  angle: number;
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x));

function computeY(x: number, lambda: number): number {
  return Math.sqrt(1 - lambda * lambda * (1 - x * x));
}

function computePsi(x: number, y: number, lambda: number): number {
  if (x >= -1 && x < 1) return Math.acos(clamp(x * y + lambda * (1 - x * x)));
  if (x > 1) return Math.asinh((y - x * lambda) * Math.sqrt(x * x - 1));
  return 0;
}

/** Gauss hypergeometric 2F1(3, 1, 5/2, x), the series used near x = 1 (parabolic). */
function hyp2f1b(x: number): number {
  if (x >= 1) return Infinity;
  let res = 1;
  let term = 1;
  for (let i = 0; i < 200; i++) {
    term = (((term * (3 + i) * (1 + i)) / (2.5 + i)) * x) / (i + 1);
    const prev = res;
    res += term;
    if (res === prev) break;
  }
  return res;
}

/** Non-dimensional time of flight for x, minus T0. */
function tofEquation(x: number, y: number, T0: number, lambda: number): number {
  let T: number;
  if (x > Math.sqrt(0.6) && x < Math.sqrt(1.4)) {
    // Close to parabolic: the general formula loses precision, use the series.
    const eta = y - lambda * x;
    const S1 = (1 - lambda - x * eta) / 2;
    const Q = (4 / 3) * hyp2f1b(S1);
    T = (eta * eta * eta * Q + 4 * lambda * eta) / 2;
  } else {
    const psi = computePsi(x, y, lambda);
    T = (psi / Math.sqrt(Math.abs(1 - x * x)) - x + lambda * y) / (1 - x * x);
  }
  return T - T0;
}

function findX(lambda: number, T: number): number | null {
  // Initial guess for zero revolutions (Izzo eq. 30).
  const T0 = Math.acos(lambda) + lambda * Math.sqrt(1 - lambda * lambda);
  const T1 = (2 * (1 - lambda * lambda * lambda)) / 3;
  let x: number;
  if (T >= T0) x = Math.pow(T0 / T, 2 / 3) - 1;
  else if (T < T1) x = ((5 / 2) * T1 * (T1 - T)) / (T * (1 - Math.pow(lambda, 5))) + 1;
  else x = Math.exp((Math.log(2) * Math.log(T / T0)) / Math.log(T1 / T0)) - 1;

  // Householder iterations (third order).
  for (let i = 0; i < 35; i++) {
    const y = computeY(x, lambda);
    const f = tofEquation(x, y, T, lambda);
    const Tx = f + T;
    const l2 = lambda * lambda;
    const omx2 = 1 - x * x;
    const d1 = (3 * Tx * x - 2 + (2 * l2 * lambda * x) / y) / omx2;
    const d2 = (3 * Tx + 5 * x * d1 + (2 * (1 - l2) * l2 * lambda) / (y * y * y)) / omx2;
    const d3 = (7 * x * d2 + 8 * d1 - (6 * (1 - l2) * l2 * l2 * lambda * x) / Math.pow(y, 5)) / omx2;
    const next = x - f * ((d1 * d1 - (f * d2) / 2) / (d1 * (d1 * d1 - f * d2) + (d3 * f * f) / 6));
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - x) < 1e-11) return next;
    x = next;
  }
  return Number.isFinite(x) ? x : null;
}
