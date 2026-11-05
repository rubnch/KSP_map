/**
 * Patched-conic delta-v building blocks. Everything is impulsive and assumes circular,
 * coplanar orbits at the semi-major axis (Hohmann), which lands within a few percent of
 * in-game numbers for the stock system.
 */
import type { Body } from '../core/index.ts';

export const circularSpeed = (mu: number, r: number) => Math.sqrt(mu / r);
export const escapeSpeed = (mu: number, r: number) => Math.sqrt((2 * mu) / r);

/** Speeds at both ends of a Hohmann ellipse between radii r1 and r2 (any order). */
export function hohmannSpeeds(mu: number, r1: number, r2: number): { v1: number; v2: number } {
  const a = (r1 + r2) / 2;
  return { v1: Math.sqrt(mu * (2 / r1 - 1 / a)), v2: Math.sqrt(mu * (2 / r2 - 1 / a)) };
}

/** Time along half a Hohmann ellipse between radii r1 and r2, s. */
export const hohmannTime = (mu: number, r1: number, r2: number) => Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / mu);

/**
 * How long the transfer into `to` from `from` takes: between sibling orbits, from the parent's low
 * orbit out to a moon, or from a moon (or planet) down to its parent's low orbit.
 */
export function transferTime(from: Body, to: Body): number | null {
  if (from.orbit && to.orbit && from.parent && from.parent === to.parent)
    return hohmannTime(from.parent.mu, from.orbit.a, to.orbit.a);
  if (to.orbit && to.parent === from) return hohmannTime(from.mu, lowOrbitRadius(from), to.orbit.a);
  if (from.orbit && from.parent === to) return hohmannTime(to.mu, from.orbit.a, lowOrbitRadius(to));
  return null;
}

/** Burn at periapsis of radius r turning a hyperbolic excess speed vInf into a parabolic orbit (Oberth included). */
export function excessBurn(mu: number, r: number, vInf: number): number {
  const vEsc = escapeSpeed(mu, r);
  return Math.sqrt(vInf * vInf + vEsc * vEsc) - vEsc;
}

export const planeChange = (v: number, angleRad: number) => 2 * v * Math.sin(Math.abs(angleRad) / 2);

/** Angle between two unit normals, radians. */
export function angleBetween(a: readonly number[], b: readonly number[]): number {
  const d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return Math.acos(Math.min(1, Math.max(-1, d)));
}

export function hasAtmosphere(b: Body): boolean {
  return !!b.data.physical.atmosphere;
}

export function hasSurface(b: Body): boolean {
  return b.data.deltaV?.hasSurface ?? b.data.kind !== 'star';
}

/** Low orbit altitude: the pack's hint, else just above the atmosphere, else 5% of the radius (at least 10 km). */
export function lowOrbitAltitude(b: Body): number {
  const hint = b.data.deltaV?.lowOrbitAltitude;
  if (hint) return hint;
  const atm = b.data.physical.atmosphere;
  if (atm) return atm.height + 10_000;
  return Math.max(10_000, 0.05 * b.radius);
}

export const lowOrbitRadius = (b: Body) => b.radius + lowOrbitAltitude(b);

/** Equatorial surface speed from rotation, m/s (0 when the period is unknown). */
export function surfaceSpeed(b: Body): number {
  const T = b.data.physical.rotationPeriod;
  return T ? (2 * Math.PI * b.radius) / T : 0;
}

/**
 * Ideal vacuum ascent to low orbit: a Hohmann climb from a "surface orbit" to the low orbit,
 * minus the free speed from rotation. Matches the community figures for airless moons
 * (Mun 580, Minmus 180) within a few m/s.
 */
export function vacuumAscent(b: Body): number {
  const r0 = b.radius;
  const r1 = lowOrbitRadius(b);
  const { v1, v2 } = hohmannSpeeds(b.mu, r0, r1);
  return v1 + (circularSpeed(b.mu, r1) - v2) - surfaceSpeed(b);
}

/**
 * Drag and gravity losses as a fraction of the vacuum ascent, for bodies the pack gives no
 * community value for. Calibrated on stock: Kerbin, Duna and Laythe all sit near +42%, and
 * Eve's 5 atm pushes it to +123%.
 */
export function atmosphericLossFactor(seaLevelPressureKPa: number | undefined): number {
  const p = seaLevelPressureKPa ?? 101.325;
  return 0.05 + 0.37 * Math.min(1, p / 5) + 0.002 * Math.max(0, p - 100);
}

export type AscentSource = 'override' | 'pack' | 'computed' | 'estimated';

export interface Ascent {
  value: number;
  source: AscentSource;
}

/** Surface ↔ low orbit cost: user override, then the pack's community value, then derived. */
export function ascentCost(b: Body, override?: number): Ascent {
  if (override !== undefined && Number.isFinite(override)) return { value: override, source: 'override' };
  const hint = b.data.deltaV?.ascent;
  if (hint !== undefined) return { value: hint, source: 'pack' };
  const vac = vacuumAscent(b);
  const atm = b.data.physical.atmosphere;
  if (!atm) return { value: vac, source: 'computed' };
  return { value: vac * (1 + atmosphericLossFactor(atm.seaLevelPressure)), source: 'estimated' };
}

/** Deorbit burn with aerobraking: drop the periapsis from low orbit to half the atmosphere height. */
export function deorbitBurn(b: Body): number {
  const atm = b.data.physical.atmosphere;
  if (!atm) return 0;
  const r1 = lowOrbitRadius(b);
  const { v1 } = hohmannSpeeds(b.mu, r1, b.radius + atm.height / 2);
  return circularSpeed(b.mu, r1) - v1;
}

/**
 * Radius of the synchronous (stationary) orbit, or null when it doesn't fit: above the low
 * orbit and inside the sphere of influence. Tidally locked moons never have one.
 */
export function syncOrbitRadius(b: Body): number | null {
  const T = Math.abs(b.data.physical.rotationPeriod);
  if (!T || b.data.physical.tidallyLocked) return null;
  const r = Math.cbrt((b.mu * T * T) / (4 * Math.PI * Math.PI));
  return r > lowOrbitRadius(b) && r < b.soi ? r : null;
}
