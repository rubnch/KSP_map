import { describe, expect, it } from 'vitest';
import stock from '../../data/packs/stock.json';
import { PlanetarySystem } from './system.ts';
import { add } from './vec3.ts';
import type { SystemPack } from './types.ts';

const system = new PlanetarySystem(stock as SystemPack);

// Reference values from the KSP wiki (KSP 1.12): SOI radius (m) and sidereal orbital period (s).
const reference: Record<string, { soi: number; period: number }> = {
  Moho: { soi: 9646663, period: 2215754.2 },
  Eve: { soi: 85109365, period: 5657995.1 },
  Gilly: { soi: 126123.27, period: 388587.42 },
  Kerbin: { soi: 84159286, period: 9203544.6 },
  Mun: { soi: 2429559.1, period: 138984.38 },
  Minmus: { soi: 2247428.4, period: 1077310.5 },
  Duna: { soi: 47921949, period: 17315400 },
  Ike: { soi: 1049598.9, period: 65517.862 },
  Dres: { soi: 32832840, period: 47893063 },
  Jool: { soi: 2455985200, period: 104661432 },
  Laythe: { soi: 3723645.8, period: 52980.879 },
  Vall: { soi: 2406401.4, period: 105962.09 },
  Tylo: { soi: 10856518, period: 211926.36 },
  Bop: { soi: 1221060.9, period: 544507.43 },
  Pol: { soi: 1042138.9, period: 901902.62 },
  Eeloo: { soi: 119082940, period: 156992048 },
};

describe('stock system', () => {
  it('loads all 17 bodies under Kerbol, with Kerbin as home', () => {
    expect(system.bodies).toHaveLength(17);
    expect(system.root.id).toBe('Kerbol');
    expect(system.home.id).toBe('Kerbin');
    expect(system.get('Jool').children.map((b) => b.id)).toEqual(['Laythe', 'Vall', 'Tylo', 'Bop', 'Pol']);
  });

  it('matches the ground truth in the plan: Kerbin SMA, 6 h day, 426 day year', () => {
    const kerbin = system.get('Kerbin');
    expect(kerbin.orbit!.a).toBe(13599840256);
    expect(stock.calendar.dayLength).toBe(6 * 3600);
    expect(stock.calendar.yearLength / stock.calendar.dayLength).toBe(426);
    expect(kerbin.orbit!.period / stock.calendar.dayLength).toBeCloseTo(426.09, 1);
  });

  it.each(Object.entries(reference))('%s SOI and period agree with the wiki within 0.1%%', (id, ref) => {
    const body = system.get(id);
    expect(Math.abs(body.soi / ref.soi - 1)).toBeLessThan(1e-3);
    expect(Math.abs(body.orbit!.period / ref.period - 1)).toBeLessThan(1e-3);
  });

  it('tidally locked bodies rotate once per orbit', () => {
    for (const b of system.bodies.filter((x) => x.data.physical.tidallyLocked)) {
      expect(b.data.physical.rotationPeriod / b.orbit!.period).toBeCloseTo(1, 3);
    }
  });

  it('every moon orbit fits inside its parent SOI and outside its parent', () => {
    for (const b of system.bodies) {
      if (!b.parent || !b.orbit) continue;
      expect(b.orbit.apoapsis).toBeLessThan(b.parent.soi);
      expect(b.orbit.periapsis).toBeGreaterThan(b.parent.radius + (b.parent.data.physical.atmosphere?.height ?? 0));
    }
  });

  it('composes absolute positions through the hierarchy', () => {
    const t = 5_000_000;
    const mun = system.get('Mun');
    const kerbin = system.get('Kerbin');
    const expected = add(kerbin.orbit!.positionAt(t), mun.orbit!.positionAt(t));
    expect(system.absolutePosition(mun, t)).toEqual(expected);
    expect(system.relativePosition(mun, kerbin, t).map((x) => Math.round(x))).toEqual(
      mun.orbit!.positionAt(t).map((x) => Math.round(x)),
    );
  });

  it('places Kerbin at UT 0 opposite the reference direction (mean anomaly 3.14 rad)', () => {
    const p = system.absolutePosition(system.home, 0);
    expect(p[0] / 13599840256).toBeCloseTo(-1, 5);
    expect(Math.abs(p[1] / 13599840256)).toBeLessThan(0.002);
  });
});
