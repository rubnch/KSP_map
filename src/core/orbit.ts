import { eccentricFromTrue, meanFromEccentric, solveKepler, trueFromEccentric, wrapTwoPi } from './kepler.ts';
import type { OrbitalElements } from './types.ts';
import type { Vec3 } from './vec3.ts';

const DEG = Math.PI / 180;

export interface StateVector {
  position: Vec3;
  velocity: Vec3;
}

/**
 * A Keplerian elliptic orbit around a parent with gravitational parameter `mu`.
 * Elements are in the pack format (degrees); internally everything is radians.
 * Positions are relative to the parent, in the physics frame (z = north).
 */
export class Orbit {
  readonly a: number;
  readonly e: number;
  readonly i: number;
  readonly lan: number;
  readonly argPe: number;
  readonly meanAnomalyAtEpoch: number;
  readonly epoch: number;
  readonly mu: number;
  /** Mean motion, rad/s. */
  readonly n: number;
  readonly period: number;
  // Perifocal → reference frame rotation, columns P (to periapsis) and Q (90° ahead in the orbit plane).
  private readonly P: Vec3;
  private readonly Q: Vec3;
  /** Orbit normal (angular momentum direction). */
  readonly normal: Vec3;

  constructor(el: OrbitalElements, mu: number) {
    this.a = el.semiMajorAxis;
    this.e = el.eccentricity;
    this.i = el.inclination * DEG;
    this.lan = el.longitudeOfAscendingNode * DEG;
    this.argPe = el.argumentOfPeriapsis * DEG;
    this.meanAnomalyAtEpoch = el.meanAnomalyAtEpoch * DEG;
    this.epoch = el.epoch;
    this.mu = mu;
    this.n = Math.sqrt(mu / (this.a * this.a * this.a));
    this.period = (2 * Math.PI) / this.n;

    const cO = Math.cos(this.lan),
      sO = Math.sin(this.lan);
    const ci = Math.cos(this.i),
      si = Math.sin(this.i);
    const cw = Math.cos(this.argPe),
      sw = Math.sin(this.argPe);
    this.P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
    this.Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
    this.normal = [sO * si, -cO * si, ci];
  }

  get periapsis(): number {
    return this.a * (1 - this.e);
  }

  get apoapsis(): number {
    return this.a * (1 + this.e);
  }

  meanAnomalyAt(t: number): number {
    return wrapTwoPi(this.meanAnomalyAtEpoch + this.n * (t - this.epoch));
  }

  eccentricAnomalyAt(t: number): number {
    return solveKepler(this.meanAnomalyAt(t), this.e);
  }

  trueAnomalyAt(t: number): number {
    return trueFromEccentric(this.eccentricAnomalyAt(t), this.e);
  }

  /** Position on the orbit at eccentric anomaly E. */
  positionAtEccentric(E: number): Vec3 {
    const x = this.a * (Math.cos(E) - this.e);
    const y = this.a * Math.sqrt(1 - this.e * this.e) * Math.sin(E);
    return this.toReference(x, y);
  }

  positionAtTrueAnomaly(nu: number): Vec3 {
    return this.positionAtEccentric(eccentricFromTrue(nu, this.e));
  }

  /** Position and velocity relative to the parent at UT `t`. */
  stateAt(t: number): StateVector {
    const E = this.eccentricAnomalyAt(t);
    const cE = Math.cos(E),
      sE = Math.sin(E);
    const b = Math.sqrt(1 - this.e * this.e);
    const r = this.a * (1 - this.e * cE);
    const x = this.a * (cE - this.e);
    const y = this.a * b * sE;
    const k = (this.n * this.a * this.a) / r; // dE/dt * a
    const vx = -k * sE;
    const vy = k * b * cE;
    return { position: this.toReference(x, y), velocity: this.toReference(vx, vy) };
  }

  positionAt(t: number): Vec3 {
    return this.positionAtEccentric(this.eccentricAnomalyAt(t));
  }

  /** UT of the next passage through true anomaly `nu` at or after `t`. */
  timeOfTrueAnomaly(nu: number, after: number): number {
    const M = meanFromEccentric(eccentricFromTrue(nu, this.e), this.e);
    const dM = wrapTwoPi(M - this.meanAnomalyAt(after));
    return after + dM / this.n;
  }

  /**
   * Points around the full ellipse, evenly spaced in eccentric anomaly, starting at `startE`
   * (pass the body's current E so the first vertex sits exactly on the body).
   * Returns segments + 1 points; the last equals the first.
   */
  points(segments: number, startE = 0): Vec3[] {
    const pts: Vec3[] = [];
    for (let k = 0; k <= segments; k++) pts.push(this.positionAtEccentric(startE + (2 * Math.PI * k) / segments));
    return pts;
  }

  private toReference(x: number, y: number): Vec3 {
    const { P, Q } = this;
    return [P[0] * x + Q[0] * y, P[1] * x + Q[1] * y, P[2] * x + Q[2] * y];
  }
}

/** Laplace sphere-of-influence radius. */
export function soiRadius(semiMajorAxis: number, mu: number, parentMu: number): number {
  return semiMajorAxis * Math.pow(mu / parentMu, 0.4);
}

/** Synodic period of two orbits around the same parent. */
export function synodicPeriod(p1: number, p2: number): number {
  return 1 / Math.abs(1 / p1 - 1 / p2);
}
