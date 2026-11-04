import { describe, expect, it } from 'vitest';
import { eccentricFromTrue, meanFromEccentric, solveKepler, trueFromEccentric, wrapTwoPi } from './kepler.ts';

describe('solveKepler', () => {
  const es = [0, 0.01, 0.2, 0.55, 0.9, 0.99];
  const Ms = Array.from({ length: 37 }, (_, k) => (k * Math.PI) / 18);

  it.each(es)('satisfies Kepler equation for e=%s', (e) => {
    for (const M of Ms) {
      const E = solveKepler(M, e);
      const residual = wrapTwoPi(E - e * Math.sin(E) - M + Math.PI) - Math.PI;
      expect(residual).toBeCloseTo(0, 10);
    }
  });

  it('round-trips true ↔ eccentric ↔ mean', () => {
    for (const e of es) {
      for (const M of Ms.slice(0, -1)) {
        const E = solveKepler(M, e);
        const nu = trueFromEccentric(E, e);
        expect(eccentricFromTrue(nu, e)).toBeCloseTo(E, 9);
        expect(meanFromEccentric(E, e)).toBeCloseTo(M, 9);
      }
    }
  });
});
