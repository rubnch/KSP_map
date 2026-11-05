import { describe, expect, it } from 'vitest';
import stock from '../../data/packs/stock.json';
import { length, PlanetarySystem, sub, type SystemPack, type Vec3 } from '../core/index.ts';
import { propagate } from './conics.ts';
import { lambert } from './lambert.ts';
import { TransferProblem, type TransferSettings } from './transfer.ts';
import { findWindows, porkchop, porkchopRange, predictWindows } from './windows.ts';

const system = new PlanetarySystem(stock as SystemPack);
const DAY = 21600;
const YEAR = 9201600;
const date = (year: number, day: number) => (year - 1) * YEAR + (day - 1) * DAY;
/** alexmoon's Launch Window Planner defaults: 100 km parking orbits at both ends. */
const planner = (mode: TransferSettings['mode']): TransferSettings => ({
  initialAltitude: 100_000,
  finalAltitude: 100_000,
  mode,
});
const problem = (o: string, t: string, mode: TransferSettings['mode'] = 'ballistic') =>
  new TransferProblem(system.get(o), system.get(t), planner(mode));

describe('lambert', () => {
  const mu = system.root.mu;
  const r1: Vec3 = [13.6e9, 0, 0];
  const cases: [string, Vec3, number][] = [
    ['short arc', [10e9, 12e9, 0.4e9], 60 * DAY],
    ['more than 180°', [-15e9, -8e9, 0.6e9], 300 * DAY],
    ['fast, hyperbolic', [-20e9, 3e9, 1e9], 20 * DAY],
    ['long, close to 180°', [-20.7e9, 0.2e9, 0.05e9], 260 * DAY],
  ];
  it.each(cases)('%s: the solution reaches r2 in the time of flight', (_, r2, tof) => {
    const sol = lambert(mu, r1, r2, tof)!;
    expect(sol).not.toBeNull();
    const end = propagate(mu, r1, sol.v1, tof);
    expect(length(sub(end.position, r2)) / length(r2)).toBeLessThan(1e-8);
    expect(length(sub(end.velocity, sol.v2)) / length(sol.v2)).toBeLessThan(1e-8);
  });

  it('flies prograde around the reference normal', () => {
    const sol = lambert(mu, r1, [-15e9, -8e9, 0], 300 * DAY)!;
    expect(sol.angle).toBeGreaterThan(Math.PI);
    expect(sol.v1[1]).toBeGreaterThan(0);
  });
});

describe('circular-orbit prediction', () => {
  it('has the textbook Hohmann phase angles from Kerbin', () => {
    expect(problem('Kerbin', 'Duna').idealPhaseAngle).toBeCloseTo(44.36, 1);
    expect(problem('Kerbin', 'Eve').idealPhaseAngle).toBeCloseTo(-54.13, 1);
    expect(problem('Kerbin', 'Jool').idealPhaseAngle).toBeCloseTo(96.6, 0);
  });

  it('predicts windows one synodic period apart, at the ideal phase angle', () => {
    const p = problem('Kerbin', 'Duna');
    const ws = predictWindows(p, 0, 10 * YEAR);
    expect(ws.length).toBeGreaterThanOrEqual(4);
    for (const t of ws) expect(p.phaseAngleAt(t)).toBeCloseTo(p.idealPhaseAngle, 1);
    for (let i = 1; i < ws.length; i++) expect((ws[i]! - ws[i - 1]!) / p.synodicPeriod).toBeCloseTo(1, 0);
  });
});

describe('transfers match alexmoon\'s Launch Window Planner', () => {
  // [origin, target, departure, time of flight, total Δv, ejection Δv, capture Δv, ejection angle °]
  // from the planner's own code (ballistic, 100 km parking orbits), run against the same stock data.
  const reference: [string, string, number, number, number, number, number, number][] = [
    ['Kerbin', 'Duna', 5e6, 5.5e6, 1696.91, 1043.19, 653.72, 157.226],
    ['Kerbin', 'Moho', 3e6, 2.5e6, 8174.85, 2394.84, 5780.01, 269.586],
    ['Kerbin', 'Eve', 2e7, 3.9e6, 17574, 7625.12, 9948.89, 228.106],
    ['Kerbin', 'Jool', 1.5e7, 2.4e7, 5502.96, 2540.98, 2961.98, 152.891],
    ['Kerbin', 'Eeloo', 2.2e6, 4.5e7, 10324.97, 8259.05, 2065.92, 351.137],
    ['Laythe', 'Tylo', 1e5, 6e4, 2944.29, 1970.52, 973.77, 359.734],
  ];
  it.each(reference)('%s → %s at a fixed date', (o, t, dep, tof, dv, ej, cap, angle) => {
    const tr = problem(o, t).transfer(dep, tof)!;
    expect(tr.dv).toBeCloseTo(dv, 0);
    expect(tr.ejectionDv).toBeCloseTo(ej, 0);
    expect(tr.captureDv).toBeCloseTo(cap, 0);
    expect(tr.ejectionAngle).toBeCloseTo(angle, 1);
  });

  it('finds the same Kerbin → Duna windows over ten years', () => {
    // Optimum of each window in the planner's porkchop plots: [year, day, flight days, Δv m/s].
    const expected = [
      [1, 238.0, 258.1, 1691.7],
      [3, 311.4, 268.3, 1656.8],
      [5, 368.5, 303.7, 1627.5],
      [7, 405.0, 341.1, 1639.7],
      [10, 21.9, 346.2, 1661.9],
    ];
    const ws = findWindows(problem('Kerbin', 'Duna'), 0, 10 * YEAR);
    expect(ws.map((w) => [Math.floor(w.best.departure / YEAR) + 1, w.best.dv])).toHaveLength(expected.length);
    ws.forEach((w, i) => {
      const [year, day, flight, dv] = expected[i]!;
      expect(Math.abs(w.best.departure - date(year!, day!)) / DAY).toBeLessThan(0.5);
      expect(Math.abs(w.best.timeOfFlight / DAY - flight!)).toBeLessThan(0.5);
      expect(w.best.dv).toBeCloseTo(dv!, 0);
      expect(w.open).toBeLessThanOrEqual(w.best.departure);
      expect(w.close).toBeGreaterThanOrEqual(w.best.departure);
    });
  });

  it('finds the Kerbin → Eve windows with a mid-course plane change allowed', () => {
    const ws = findWindows(problem('Kerbin', 'Eve', 'optimal'), 0, 6 * YEAR);
    expect(ws.map((w) => Math.round(w.best.dv))).toEqual([2741, 2560, 2443]);
  });
});

describe('plane changes', () => {
  it('a mid-course plane change is never worse than ballistic, and is used for Moho', () => {
    const ballistic = problem('Kerbin', 'Moho');
    const optimal = problem('Kerbin', 'Moho', 'optimal');
    let used = 0;
    for (let dep = 0; dep < YEAR; dep += 20 * DAY) {
      for (const tof of [80 * DAY, 110 * DAY, 140 * DAY]) {
        const b = ballistic.dv(dep, tof);
        const o = optimal.transfer(dep, tof);
        if (!o || !Number.isFinite(b)) continue;
        expect(o.dv).toBeLessThanOrEqual(b + 1e-6);
        if (o.planeChange) {
          used++;
          expect(o.planeChangeDv).toBeGreaterThan(0);
          expect(o.planeChange.time).toBeGreaterThan(dep);
          expect(o.planeChange.time).toBeLessThan(dep + tof);
        }
      }
    }
    expect(used).toBeGreaterThan(0);
  });

  it('after the plane change burn, the ship meets the target', () => {
    const p = problem('Kerbin', 'Moho', 'optimal');
    const ws = findWindows(p, 0, 3 * YEAR);
    const tr = ws.map((w) => w.best).find((b) => b.planeChange)!;
    expect(tr).toBeDefined();
    const after = tr.afterPlaneChange!;
    const end = propagate(system.root.mu, after.position, after.velocity, tr.arrival - tr.planeChange!.time);
    const moho = system.get('Moho').orbit!.positionAt(tr.arrival);
    // Within Moho's sphere of influence.
    expect(length(sub(end.position, moho))).toBeLessThan(system.get('Moho').soi);
  });
});

describe('porkchop', () => {
  it('has its minimum at the window the timeline finds', () => {
    const p = problem('Kerbin', 'Duna');
    const center = date(1, 238);
    const r = porkchopRange(p, center);
    const g = porkchop(p, r.depFrom, r.depTo, r.tofFrom, r.tofTo, 120, 80);
    expect(g.dv).toHaveLength(120 * 80);
    expect(Math.abs(g.min.departure - center) / DAY).toBeLessThan(12);
    expect(g.min.dv).toBeLessThan(1720);
  });
});
