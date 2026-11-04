/** Kepler's equation and anomaly conversions for elliptic orbits (0 <= e < 1). Angles in radians. */

const TWO_PI = 2 * Math.PI;

/** Wraps an angle to [0, 2π). */
export function wrapTwoPi(x: number): number {
  const r = x % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** Solves M = E - e sin E for the eccentric anomaly E. */
export function solveKepler(meanAnomaly: number, e: number, tolerance = 1e-14): number {
  const M = wrapTwoPi(meanAnomaly);
  if (e === 0) return M;
  // Starting guess that converges for every M when e is high.
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 50; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < tolerance) break;
  }
  return E;
}

export function trueFromEccentric(E: number, e: number): number {
  return wrapTwoPi(2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)));
}

export function eccentricFromTrue(nu: number, e: number): number {
  return wrapTwoPi(2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2)));
}

export function meanFromEccentric(E: number, e: number): number {
  return wrapTwoPi(E - e * Math.sin(E));
}
