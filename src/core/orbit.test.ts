import { describe, expect, it } from 'vitest';
import { Orbit, soiRadius, synodicPeriod } from './orbit.ts';
import { cross, dot, length } from './vec3.ts';

const MU_KERBOL = 1.1723328e18;

const duna = new Orbit(
  {
    semiMajorAxis: 20726155264,
    eccentricity: 0.051,
    inclination: 0.06,
    longitudeOfAscendingNode: 135.5,
    argumentOfPeriapsis: 0,
    meanAnomalyAtEpoch: 179.9,
    epoch: 0,
  },
  MU_KERBOL,
);

const tilted = new Orbit(
  {
    semiMajorAxis: 128500000,
    eccentricity: 0.235,
    inclination: 15,
    longitudeOfAscendingNode: 10,
    argumentOfPeriapsis: 25,
    meanAnomalyAtEpoch: 51.6,
    epoch: 0,
  },
  2.82528e14,
);

describe('Orbit', () => {
  it('conserves energy (vis-viva) and angular momentum around the orbit', () => {
    for (const o of [duna, tilted]) {
      const h0 = cross(o.stateAt(0).position, o.stateAt(0).velocity);
      for (let k = 0; k < 24; k++) {
        const t = (k / 24) * o.period;
        const { position, velocity } = o.stateAt(t);
        const r = length(position);
        const v = length(velocity);
        expect(v * v).toBeCloseTo(o.mu * (2 / r - 1 / o.a), -1);
        const h = cross(position, velocity);
        expect(length(h) / length(h0)).toBeCloseTo(1, 10);
      }
    }
  });

  it('velocity is the time derivative of position', () => {
    const t = 1234567;
    const dt = 1;
    const p0 = tilted.positionAt(t - dt);
    const p1 = tilted.positionAt(t + dt);
    const v = tilted.stateAt(t).velocity;
    for (let k = 0; k < 3; k++) expect((p1[k]! - p0[k]!) / (2 * dt)).toBeCloseTo(v[k]!, 3);
  });

  it('is periodic', () => {
    const a = tilted.positionAt(1000);
    const b = tilted.positionAt(1000 + 3 * tilted.period);
    for (let k = 0; k < 3; k++) expect(b[k]!).toBeCloseTo(a[k]!, 0);
  });

  it('has an orbit normal matching the inclination, and stays in its plane', () => {
    expect(Math.acos(tilted.normal[2]) * (180 / Math.PI)).toBeCloseTo(15, 10);
    for (let k = 0; k < 10; k++) expect(dot(tilted.positionAt(k * 50000), tilted.normal) / tilted.a).toBeCloseTo(0, 12);
  });

  it('periapsis lies at argument of periapsis from the ascending node', () => {
    const pe = tilted.positionAtTrueAnomaly(0);
    expect(length(pe)).toBeCloseTo(tilted.periapsis, 3);
    const an = tilted.positionAtTrueAnomaly(-tilted.argPe);
    expect(an[2] / tilted.a).toBeCloseTo(0, 12); // ascending node is on the reference plane
    expect(Math.atan2(an[1], an[0]) * (180 / Math.PI)).toBeCloseTo(10, 8); // at longitude Ω
    const justAfter = tilted.positionAtTrueAnomaly(-tilted.argPe + 0.01);
    expect(justAfter[2]).toBeGreaterThan(0); // and the body goes north there
  });

  it('timeOfTrueAnomaly finds the next periapsis passage', () => {
    const t = tilted.timeOfTrueAnomaly(0, 5000);
    expect(t).toBeGreaterThanOrEqual(5000);
    expect(t - 5000).toBeLessThan(tilted.period);
    expect(length(tilted.positionAt(t))).toBeCloseTo(tilted.periapsis, 0);
  });

  it('points() starts on the body when given its eccentric anomaly', () => {
    const t = 777777;
    const pts = tilted.points(64, tilted.eccentricAnomalyAt(t));
    const p = tilted.positionAt(t);
    for (let k = 0; k < 3; k++) expect(pts[0]![k]!).toBeCloseTo(p[k]!, 3);
    expect(pts).toHaveLength(65);
  });
});

describe('helpers', () => {
  it('soiRadius uses the Laplace formula', () => {
    expect(soiRadius(13599840256, 3.5316e12, MU_KERBOL)).toBeCloseTo(84159286, -3);
  });
  it('synodicPeriod', () => {
    expect(synodicPeriod(2, 3)).toBeCloseTo(6);
  });
});
