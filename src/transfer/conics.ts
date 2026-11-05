import { cross, dot, length, scale, type Vec3 } from '../core/index.ts';

/**
 * Two-body propagation for any conic (ellipse, parabola, hyperbola) with the universal variable
 * formulation (Curtis, "Orbital Mechanics for Engineering Students", algorithms 3.3 and 3.4).
 * Used to draw transfer arcs, which are not always ellipses.
 */
export function propagate(mu: number, r0: Vec3, v0: Vec3, dt: number): { position: Vec3; velocity: Vec3 } {
  const r0n = length(r0);
  const v0n = length(v0);
  const vr0 = dot(r0, v0) / r0n;
  const alpha = 2 / r0n - (v0n * v0n) / mu; // 1/a
  const sqrtMu = Math.sqrt(mu);

  // Solve the universal Kepler equation for chi with Newton's method.
  // Starting guess (Vallado, "Fundamentals of Astrodynamics", algorithm 8).
  let chi: number;
  if (alpha > 1e-12) {
    chi = sqrtMu * alpha * dt;
  } else if (alpha < -1e-12) {
    const a = 1 / alpha;
    const s = Math.sign(dt) || 1;
    chi = s * Math.sqrt(-a) * Math.log((-2 * mu * alpha * dt) / (dot(r0, v0) + s * Math.sqrt(-mu * a) * (1 - r0n * alpha)));
  } else {
    chi = (sqrtMu * dt) / r0n;
  }
  if (!Number.isFinite(chi)) chi = (sqrtMu * dt) / r0n;
  for (let i = 0; i < 60; i++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F =
      ((r0n * vr0) / sqrtMu) * chi * chi * C + (1 - alpha * r0n) * chi * chi * chi * S + r0n * chi - sqrtMu * dt;
    const dF = ((r0n * vr0) / sqrtMu) * chi * (1 - alpha * chi * chi * S) + (1 - alpha * r0n) * chi * chi * C + r0n;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-9 * Math.max(1, Math.abs(chi))) break;
  }

  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - ((chi * chi) / r0n) * C;
  const g = dt - (1 / sqrtMu) * chi * chi * chi * S;
  const r: Vec3 = [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1], f * r0[2] + g * v0[2]];
  const rn = length(r);
  const fdot = (sqrtMu / (rn * r0n)) * (alpha * chi * chi * chi * S - chi);
  const gdot = 1 - ((chi * chi) / rn) * C;
  const v: Vec3 = [fdot * r0[0] + gdot * v0[0], fdot * r0[1] + gdot * v0[1], fdot * r0[2] + gdot * v0[2]];
  return { position: r, velocity: v };
}

function stumpffS(z: number): number {
  if (z > 1e-8) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-8) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120;
}

function stumpffC(z: number): number {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24;
}

/** Shape of a conic from a state vector: specific angular momentum, eccentricity vector, semi-latus rectum. */
export function conicShape(mu: number, r: Vec3, v: Vec3) {
  const h = cross(r, v);
  const hn = length(h);
  const rn = length(r);
  const vv = dot(v, v);
  const rv = dot(r, v);
  const e: Vec3 = [
    ((vv - mu / rn) * r[0] - rv * v[0]) / mu,
    ((vv - mu / rn) * r[1] - rv * v[1]) / mu,
    ((vv - mu / rn) * r[2] - rv * v[2]) / mu,
  ];
  return { h, hn, e, en: length(e), p: (hn * hn) / mu, normal: scale(h, 1 / hn) };
}

/** Rotates `v` by `angle` radians around the unit axis `k` (Rodrigues). */
export function rotate(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

export const normalize = (v: Vec3): Vec3 => scale(v, 1 / length(v));

/** Projects `v` onto the plane with unit normal `n`. */
export const projectToPlane = (v: Vec3, n: Vec3): Vec3 => {
  const d = dot(v, n);
  return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]];
};

/** Signed angle from `a` to `b` around the unit normal `n`, in (-π, π]. */
export function signedAngle(a: Vec3, b: Vec3, n: Vec3): number {
  return Math.atan2(dot(cross(a, b), n), dot(a, b));
}
