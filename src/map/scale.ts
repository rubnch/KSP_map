import type { Vec3 } from '../core/index.ts';

/** Scene units per metre. One scene unit is one kilometre. */
export const SCALE = 1e-3;

/**
 * Physics frame (x, y in the reference plane, z north) → three.js (y up).
 * Writes into `out` at `offset` so it can fill typed arrays directly.
 */
export function writeThree(v: Vec3, out: { [i: number]: number }, offset = 0): void {
  out[offset] = v[0] * SCALE;
  out[offset + 1] = v[2] * SCALE;
  out[offset + 2] = -v[1] * SCALE;
}
