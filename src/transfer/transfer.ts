import { cross, dot, length, sub, type Body, type Vec3 } from '../core/index.ts';
import { conicShape, normalize, projectToPlane, propagate, rotate, signedAngle } from './conics.ts';
import { lambert } from './lambert.ts';

const HALF_PI = Math.PI / 2;
const TWO_PI = 2 * Math.PI;

/**
 * How a transfer is flown.
 * - `ballistic`: one burn at departure, one at arrival; the transfer plane is whatever joins the
 *   two positions, which gets very expensive when they are close to 180° apart and inclined.
 * - `optimal`: the cheaper of ballistic and a transfer in the origin's orbital plane with a
 *   plane change burn on the way (the "mid-course plane change" of alexmoon's planner).
 */
export type TransferMode = 'ballistic' | 'optimal';

export interface TransferSettings {
  /** Circular parking orbit altitude at the origin, metres. 0 = no parking orbit (Δv is v∞). */
  initialAltitude: number;
  /** Circular capture orbit altitude at the target, metres. null = no capture burn (flyby / aerobrake). */
  finalAltitude: number | null;
  mode: TransferMode;
}

/**
 * Default parking orbit altitude: the same low orbit the delta-v map uses. The pack's
 * `deltaV.lowOrbitAltitude` hint if it has one, else 10 km above the atmosphere, else 5% of the
 * radius (at least 10 km).
 */
export function defaultParkingAltitude(body: Body): number {
  const hint = (body.data as { deltaV?: { lowOrbitAltitude?: number } }).deltaV?.lowOrbitAltitude;
  if (hint) return hint;
  const atmo = body.data.physical.atmosphere?.height;
  if (atmo) return atmo + 10_000;
  return Math.max(10_000, 0.05 * body.radius);
}

export function defaultSettings(origin: Body, target: Body): TransferSettings {
  return { initialAltitude: defaultParkingAltitude(origin), finalAltitude: defaultParkingAltitude(target), mode: 'optimal' };
}

/** Everything about one transfer: dates, Δv split, and the angles needed to fly it by hand. */
export interface Transfer {
  departure: number;
  timeOfFlight: number;
  arrival: number;
  /** Total Δv, m/s (ejection + plane change + capture). */
  dv: number;
  /** Burn from the parking orbit (or v∞ without one), m/s. */
  ejectionDv: number;
  /** Mid-course plane change burn, m/s. 0 for a ballistic transfer. */
  planeChangeDv: number;
  /** Capture burn into the final orbit, m/s. 0 without one. */
  captureDv: number;
  /** Hyperbolic excess speed leaving the origin's SOI, m/s. */
  ejectionVinf: number;
  /** Hyperbolic excess speed entering the target's SOI, m/s. */
  arrivalVinf: number;
  /** Ejection angle measured from the origin's prograde direction, degrees 0..360 (see `ejection()`). */
  ejectionAngle: number;
  /** Inclination of the ejection orbit relative to the equator, degrees, signed (+ north). */
  ejectionInclination: number;
  /** Transfer angle (origin at departure → target at arrival), degrees. */
  transferAngle: number;
  /** Phase angle at departure: target ahead of origin, degrees, -180..180. */
  phaseAngle: number;
  /** Whether the transfer flies a mid-course plane change. */
  planeChange: { time: number; angle: number } | null;
  /** State on the transfer orbit just after the ejection, relative to the common parent. */
  start: { position: Vec3; velocity: Vec3 };
  /** State just after the plane change burn, if any. */
  afterPlaneChange: { position: Vec3; velocity: Vec3 } | null;
}

/**
 * Patched-conic transfers between two bodies orbiting the same parent. Ejection and capture use
 * the speed at the edge of the SOI (not at infinity), with a circular equatorial parking orbit,
 * which is how alexmoon's Launch Window Planner computes them, so its numbers can be compared.
 */
export class TransferProblem {
  readonly origin: Body;
  readonly target: Body;
  readonly settings: TransferSettings;
  readonly mu: number;
  /** Origin orbit normal: the plane in-plane transfers are flown in. */
  readonly n0: Vec3;
  /** Hohmann transfer time between the two semi-major axes. */
  readonly hohmannTime: number;
  readonly synodicPeriod: number;
  /** Ideal phase angle for a Hohmann transfer between circular orbits, degrees. */
  readonly idealPhaseAngle: number;

  constructor(origin: Body, target: Body, settings: TransferSettings) {
    if (!origin.orbit || !target.orbit || origin.parent !== target.parent || origin === target) {
      throw new Error(`No transfer between ${origin.id} and ${target.id}: they must orbit the same body`);
    }
    this.origin = origin;
    this.target = target;
    this.settings = settings;
    this.mu = origin.parent!.mu;
    this.n0 = origin.orbit.normal;
    const a1 = origin.orbit.a;
    const a2 = target.orbit.a;
    this.hohmannTime = Math.PI * Math.sqrt(Math.pow(a1 + a2, 3) / (8 * this.mu));
    this.synodicPeriod = 1 / Math.abs(1 / origin.orbit.period - 1 / target.orbit.period);
    this.idealPhaseAngle = wrapDeg((Math.PI - target.orbit.n * this.hohmannTime) * (180 / Math.PI));
  }

  /** Phase angle at `t`: how far the target is ahead of the origin, in the origin's plane, degrees -180..180. */
  phaseAngleAt(t: number): number {
    const p1 = projectToPlane(this.origin.orbit!.positionAt(t), this.n0);
    const p2 = projectToPlane(this.target.orbit!.positionAt(t), this.n0);
    return signedAngle(p1, p2, this.n0) * (180 / Math.PI);
  }

  /** Total Δv for a departure date and time of flight. NaN when there is no solution. Hot path for grids. */
  dv(departure: number, timeOfFlight: number): number {
    const t = this.solve(departure, timeOfFlight, false);
    return t ? t.dv : NaN;
  }

  /** Full details for a departure date and time of flight. */
  transfer(departure: number, timeOfFlight: number): Transfer | null {
    return this.solve(departure, timeOfFlight, true) as Transfer | null;
  }

  private solve(departure: number, timeOfFlight: number, details: boolean): Transfer | { dv: number } | null {
    const s0 = this.origin.orbit!.stateAt(departure);
    const arrival = departure + timeOfFlight;
    const s1 = this.target.orbit!.stateAt(arrival);
    const ballistic = this.ballistic(s0.position, s0.velocity, s1.position, s1.velocity, timeOfFlight);
    let best = ballistic;
    if (this.settings.mode === 'optimal' && (!ballistic || ballistic.angle > HALF_PI)) {
      const pc = this.withPlaneChange(s0.position, s0.velocity, s1.position, s1.velocity, timeOfFlight);
      if (pc && (!best || !(best.dv <= pc.dv))) best = pc;
    }
    if (!best) return null;
    if (!details) return { dv: best.dv };

    const ej = this.ejection(sub(best.v1, s0.velocity), s0.velocity);
    let planeChange: Transfer['planeChange'] = null;
    let afterPlaneChange: Transfer['afterPlaneChange'] = null;
    if (best.planeChange) {
      const pc = best.planeChange;
      const located = this.locatePlaneChange(s0.position, best.v1, pc.axis, pc.angle, timeOfFlight);
      planeChange = { time: departure + located.dt, angle: pc.angle * (180 / Math.PI) };
      afterPlaneChange = located.after;
    }
    return {
      departure,
      timeOfFlight,
      arrival,
      dv: best.dv,
      ejectionDv: best.ejectionDv,
      planeChangeDv: best.planeChangeDv,
      captureDv: best.captureDv,
      ejectionVinf: length(sub(best.v1, s0.velocity)),
      arrivalVinf: length(sub(best.v2, s1.velocity)),
      ejectionAngle: ej.angle,
      ejectionInclination: ej.inclination,
      transferAngle: best.angle * (180 / Math.PI),
      phaseAngle: this.phaseAngleAt(departure),
      planeChange,
      start: { position: s0.position, velocity: best.v1 },
      afterPlaneChange,
    };
  }

  private ballistic(r1: Vec3, vo: Vec3, r2: Vec3, vt: Vec3, tof: number): Candidate | null {
    const sol = lambert(this.mu, r1, r2, tof, this.n0);
    if (!sol) return null;
    return this.candidate(sol.v1, sol.v2, vo, vt, sol.angle, 0, null);
  }

  /**
   * Transfer flown in the origin's plane, with a burn on the way that turns the orbit plane so it
   * meets the target. The burn is placed where it is cheapest (golden-section search over its
   * angle before intercept), like alexmoon's planner; the cost of turning the plane uses the
   * horizontal speed at the burn, the only part a rotation about the radius vector changes.
   */
  private withPlaneChange(r1: Vec3, vo: Vec3, r2: Vec3, vt: Vec3, tof: number): Candidate | null {
    const n0 = this.n0;
    const r2n = length(r2);
    const delta = Math.asin(Math.max(-1, Math.min(1, dot(r2, n0) / r2n))); // target elevation over the plane
    if (Math.abs(delta) < 1e-9) return null;
    const foot = normalize(projectToPlane(r2, n0));
    // Outward: cheapest around 90° before intercept or later. Inward: 90° or earlier.
    const [lo, hi] = length(r1) > r2n ? [HALF_PI, Math.PI] : [0, HALF_PI];

    /** Plane change about the in-plane axis `x` radians before the target's foot point. */
    const geometry = (x: number) => {
      const axis = rotate(foot, n0, -x);
      const angle = Math.atan2(Math.tan(delta), Math.sin(x));
      // Rotating about `axis` by -angle brings r2 down into the plane; +angle takes the in-plane arrival back up.
      let r2p = rotate(r2, axis, -angle);
      let sign = 1;
      if (Math.abs(dot(r2p, n0)) > Math.abs(dot(rotate(r2, axis, angle), n0))) {
        r2p = rotate(r2, axis, angle);
        sign = -1;
      }
      return { axis, angle: angle * sign, r2p };
    };

    const solveFor = (x: number) => {
      const g = geometry(x);
      const sol = lambert(this.mu, r1, g.r2p, tof, n0);
      if (!sol) return null;
      const shape = conicShape(this.mu, r1, sol.v1);
      // Horizontal speed where the transfer crosses the axis: h / r = mu (1 + e cos nu) / h.
      const nuAxis = shape.en > 1e-9 ? signedAngle(shape.e, g.axis, shape.normal) : 0;
      const vh = (this.mu * (1 + shape.en * Math.cos(nuAxis))) / shape.hn;
      const dv = Math.abs(2 * vh * Math.sin(g.angle / 2));
      return { g, sol, dv, shape };
    };

    // The burn must come after departure: the axis has to lie between r1 and the arrival point.
    const first = solveFor(HALF_PI);
    if (!first || first.sol.angle <= HALF_PI) return null;
    const maxX = Math.min(hi, first.sol.angle - 1e-3);
    if (maxX <= lo) return null;
    const x = goldenSection(lo, maxX, 1e-3, (xx) => solveFor(xx)?.dv ?? Infinity);
    const best = solveFor(x);
    if (!best) return null;

    const v2 = rotate(best.sol.v2, best.g.axis, best.g.angle);
    return this.candidate(best.sol.v1, v2, vo, vt, best.sol.angle, best.dv, { axis: best.g.axis, angle: best.g.angle });
  }

  private candidate(
    v1: Vec3,
    v2: Vec3,
    vo: Vec3,
    vt: Vec3,
    angle: number,
    planeChangeDv: number,
    planeChange: Candidate['planeChange'],
  ): Candidate {
    const vinf1 = length(sub(v1, vo));
    const vinf2 = length(sub(v2, vt));
    const ejectionDv = this.ejectionDv(sub(v1, vo), vinf1);
    const captureDv = this.captureDv(vinf2);
    return { v1, v2, angle, ejectionDv, planeChangeDv, captureDv, dv: ejectionDv + planeChangeDv + captureDv, planeChange };
  }

  /** Time and post-burn state of the plane change: where the transfer crosses the rotation axis. */
  private locatePlaneChange(r1: Vec3, v1: Vec3, axis: Vec3, angle: number, tof: number) {
    // Only computed for details. Bisect on the in-plane angle travelled.
    const n = normalize(cross(r1, v1));
    const target = signedAngle(r1, axis, n);
    const goal = target < 0 ? target + TWO_PI : target;
    let lo = 0;
    let hi = tof;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const p = propagate(this.mu, r1, v1, mid);
      let a = signedAngle(r1, p.position, n);
      if (a < 0) a += TWO_PI;
      if (a < goal) lo = mid;
      else hi = mid;
    }
    const s = propagate(this.mu, r1, v1, lo);
    const r = normalize(s.position);
    return { dt: lo, angle, after: { position: s.position, velocity: rotate(s.velocity, r, angle) } };
  }

  /** Ejection burn from the circular parking orbit, with the plane change into the ejection plane. */
  private ejectionDv(vinfVec: Vec3, vinf: number): number {
    const alt = this.settings.initialAltitude;
    if (!alt) return vinf;
    const e = this.ejectionGeometry(vinfVec, vinf, alt);
    if (!e) return NaN;
    return Math.sqrt(e.v0 * e.v0 + e.vp * e.vp - 2 * e.v0 * e.vp * Math.cos(e.inclination));
  }

  /**
   * Hyperbolic ejection from a circular equatorial orbit: the periapsis must lie in the equator
   * and the velocity at the SOI edge must point along v∞. Returns null if no such orbit exists.
   */
  private ejectionGeometry(vinfVec: Vec3, vinf: number, alt: number) {
    const body = this.origin;
    const mu = body.mu;
    const r0 = body.radius + alt;
    const rsoi = body.soi;
    const v0 = Math.sqrt(mu / r0);
    const vp = Math.sqrt(vinf * vinf + (2 * mu) / r0 - (2 * mu) / rsoi);
    const ecc = (r0 * vp * vp) / mu - 1;
    if (ecc < 1 && (r0 * (1 + ecc)) / (1 - ecc) <= rsoi) return null;
    const cosNu = ((r0 * (1 + ecc)) / rsoi - 1) / ecc;
    const nu = Math.acos(Math.max(-1, Math.min(1, cosNu)));
    const zenith = Math.asin(Math.min(1, (r0 * vp) / (rsoi * vinf)));
    const theta = nu + zenith; // angle from periapsis to the exit velocity
    const u = normalize(vinfVec);
    const uh = Math.hypot(u[0], u[1]);
    const c = Math.cos(theta) / uh;
    if (Math.abs(c) > 1) return null;
    const phi = Math.atan2(u[1], u[0]) - Math.acos(c);
    const periapsis: Vec3 = [Math.cos(phi), Math.sin(phi), 0];
    const normal = normalize(cross(periapsis, u));
    const inclination = Math.acos(Math.max(-1, Math.min(1, normal[2])));
    return { v0, vp, periapsis, inclination, theta, u };
  }

  /**
   * Ejection angle: where on the parking orbit to burn, measured from the origin's prograde
   * direction. Same convention as alexmoon's planner: the angle you still have to travel from
   * the burn point to the prograde vector, 0..360°.
   */
  ejection(vinfVec: Vec3, originVelocity: Vec3): { angle: number; inclination: number } {
    const vinf = length(vinfVec);
    const e = this.ejectionGeometry(vinfVec, vinf, this.settings.initialAltitude || defaultParkingAltitude(this.origin));
    if (!e) return { angle: NaN, inclination: NaN };
    const prograde = normalize([originVelocity[0], originVelocity[1], 0]);
    let angle = Math.acos(Math.max(-1, Math.min(1, dot(e.periapsis, prograde))));
    if (cross(e.periapsis, prograde)[2] < 0) angle = TWO_PI - angle;
    const sign = Math.sign(Math.PI - e.theta) * Math.sign(e.u[2]) || 1;
    return { angle: angle * (180 / Math.PI), inclination: e.inclination * sign * (180 / Math.PI) };
  }

  private captureDv(vinf: number): number {
    const alt = this.settings.finalAltitude;
    if (alt === null) return 0;
    const body = this.target;
    const r = body.radius + alt;
    const v = Math.sqrt(body.mu / r);
    return Math.sqrt(vinf * vinf + 2 * v * v - (2 * body.mu) / body.soi) - v;
  }
}

interface Candidate {
  v1: Vec3;
  v2: Vec3;
  angle: number;
  ejectionDv: number;
  planeChangeDv: number;
  captureDv: number;
  dv: number;
  /** Rotation axis (unit, in the origin plane) and signed angle of the mid-course plane change. */
  planeChange: { axis: Vec3; angle: number } | null;
}

/** Minimises a unimodal function on [a, b]. */
export function goldenSection(a: number, b: number, tol: number, f: (x: number) => number): number {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (Math.abs(b - a) > tol) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/** Wraps degrees to (-180, 180]. */
export function wrapDeg(d: number): number {
  const r = (((d + 180) % 360) + 360) % 360 - 180;
  return r === -180 ? 180 : r;
}
