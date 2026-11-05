import { describe, expect, it } from 'vitest';
import stock from '../../data/packs/stock.json';
import { PlanetarySystem, type SystemPack } from '../core/index.ts';
import {
  ascentCost,
  DvGraph,
  findRoute,
  layoutDvMap,
  legLabel,
  routeView,
  vacuumAscent,
  type DvOptions,
} from './index.ts';

const system = new PlanetarySystem(stock as SystemPack);
const g = new DvGraph(system);
const plain: DvOptions = { aerobrake: false, planeChanges: false };
const cost = (from: string, to: string, o = plain) => findRoute(g, from, to, o)!.total;
/** Within `pct` percent of a community delta-v map figure. */
const near = (value: number, community: number, pct = 5) =>
  expect(Math.abs(value - community) / community).toBeLessThan(pct / 100);

describe('ascent', () => {
  it('matches community values for airless moons', () => {
    near(vacuumAscent(system.get('Mun')), 580);
    near(vacuumAscent(system.get('Minmus')), 180);
    near(vacuumAscent(system.get('Tylo')), 2270);
  });

  it('uses pack values, then overrides', () => {
    expect(ascentCost(system.get('Kerbin'))).toEqual({ value: 3400, source: 'pack' });
    expect(ascentCost(system.get('Kerbin'), 3200)).toEqual({ value: 3200, source: 'override' });
    expect(ascentCost(system.get('Mun')).source).toBe('computed');
  });

  it('estimates atmospheric ascent close to the community figures when the pack has none', () => {
    for (const [id, community] of [
      ['Kerbin', 3400],
      ['Eve', 8000],
      ['Duna', 1450],
      ['Laythe', 2900],
    ] as const) {
      const b = system.get(id);
      const bare = { ...b, data: { ...b.data, deltaV: { ...b.data.deltaV, ascent: undefined } } };
      const est = ascentCost(bare);
      expect(est.source).toBe('estimated');
      near(est.value, community, 6);
    }
  });
});

describe('transfers from low Kerbin orbit', () => {
  it('reaches the Mun like the community map (860 + 310)', () => {
    near(cost('Kerbin:low', 'Mun:intercept:Kerbin'), 860);
    near(cost('Mun:intercept:Kerbin', 'Mun:low'), 310);
  });

  it('escapes Kerbin for 950', () => near(cost('Kerbin:low', 'Kerbin:capture'), 950));

  it('ejects to Duna and Jool with the Oberth effect', () => {
    near(cost('Kerbin:low', 'Duna:intercept:Kerbin'), 950 + 130);
    near(cost('Kerbin:low', 'Jool:intercept:Kerbin'), 950 + 980);
  });

  it('captures at Jool and transfers to Laythe like the community map', () => {
    near(cost('Jool:intercept:Kerbin', 'Jool:capture'), 160, 8);
    near(cost('Jool:capture', 'Laythe:intercept:Jool'), 930);
    near(cost('Laythe:intercept:Jool', 'Laythe:low'), 1070);
  });

  it('lands on the Mun from Kerbin surface for about 5150', () => {
    near(cost('Kerbin:surface', 'Mun:surface'), 3400 + 860 + 310 + 580);
  });
});

describe('synchronous orbits', () => {
  it('exist only where they fit inside the SOI', () => {
    for (const id of ['Kerbin', 'Eve', 'Duna', 'Jool', 'Minmus', 'Dres', 'Eeloo'])
      expect(g.nodes.has(`${id}:sync`)).toBe(true);
    for (const id of ['Mun', 'Moho', 'Laythe', 'Tylo']) expect(g.nodes.has(`${id}:sync`)).toBe(false);
  });

  it('matches the community keostationary figures (680 + 435)', () => {
    near(cost('Kerbin:low', 'Kerbin:syncTransfer'), 680, 3);
    near(cost('Kerbin:syncTransfer', 'Kerbin:sync'), 435, 3);
    expect(findRoute(g, 'Kerbin:low', 'Kerbin:sync', plain)!.nodes).toEqual([
      'Kerbin:low',
      'Kerbin:syncTransfer',
      'Kerbin:sync',
    ]);
  });
});

describe('aerobraking', () => {
  it('makes Duna capture and landing nearly free', () => {
    const aero = { aerobrake: true, chutes: true, planeChanges: false };
    expect(cost('Duna:intercept:Kerbin', 'Duna:surface', aero)).toBeLessThan(60);
    // Aerobraking alone still lands under power.
    expect(cost('Duna:low', 'Duna:surface', { aerobrake: true, planeChanges: false })).toBe(1450);
    expect(cost('Duna:low', 'Duna:surface', { aerobrake: false, chutes: true, planeChanges: false })).toBeLessThan(60);
    expect(cost('Duna:intercept:Kerbin', 'Duna:surface')).toBeGreaterThan(1450);
  });

  it('never discounts ascent', () => {
    expect(cost('Kerbin:surface', 'Kerbin:low', { aerobrake: true, planeChanges: false })).toBe(3400);
  });
});

describe('plane changes', () => {
  it('only count when asked, and are larger for inclined targets', () => {
    const withPlane = { aerobrake: false, planeChanges: true };
    const moho =
      cost('Kerbin:capture', 'Moho:intercept:Kerbin', withPlane) - cost('Kerbin:capture', 'Moho:intercept:Kerbin');
    const duna =
      cost('Kerbin:capture', 'Duna:intercept:Kerbin', withPlane) - cost('Kerbin:capture', 'Duna:intercept:Kerbin');
    expect(moho).toBeGreaterThan(500);
    expect(duna).toBeLessThan(20);
  });
});

describe('routes', () => {
  it('goes between any two bodies, not only from home', () => {
    const r = findRoute(g, 'Duna:low', 'Eve:low', plain)!;
    expect(r.nodes).toContain('Eve:intercept:Duna');
    expect(r.total).toBeGreaterThan(0);
  });

  it('gets home from the Mun', () => {
    const r = findRoute(g, 'Mun:surface', 'Kerbin:surface', { aerobrake: true, chutes: true, planeChanges: false })!;
    expect(r.nodes).toContain('Kerbin:intercept:Mun');
    near(r.total, 580 + 310, 10);
  });
});

describe('layout', () => {
  const layout = layoutDvMap(g);

  it('has one row per non-root body, home first', () => {
    expect(layout.rows.length).toBe(system.bodies.length - 1);
    expect(layout.nodes.get('Kerbin:sync')).toMatchObject({ sub: true });
    expect(new Set(layout.rows.map((r) => r.body.id)).size).toBe(layout.rows.length);
    // Planets join the trunk in order of distance from Kerbol.
    const planets = layout.rows.filter((r) => r.body.parent === system.root).map((r) => r.body.id);
    expect(planets).toEqual(['Moho', 'Eve', 'Kerbin', 'Duna', 'Dres', 'Jool', 'Eeloo']);
  });

  it('hangs Jool moons off the Jool capture node and the Mun off low Kerbin orbit', () => {
    const row = (id: string) => layout.rows.find((r) => r.body.id === id)!;
    expect(row('Laythe').attach!.from).toBe('Jool:capture');
    expect(row('Mun').attach!.from).toBe('Kerbin:low');
    expect(row('Duna').attach!.from).toBe('Kerbin:capture');
  });

  it('highlights the same line for a trip and its return', () => {
    const out = findRoute(g, 'Kerbin:surface', 'Eeloo:surface', plain)!;
    const back = findRoute(g, 'Eeloo:surface', 'Kerbin:surface', plain)!;
    const a = routeView(layout, out.nodes, out.edges, plain);
    const b = routeView(layout, back.nodes, back.edges, plain);
    expect(a.edges.size).toBe(6);
    expect(a.labels.size).toBe(0);
    expect([...b.edges].sort()).toEqual([...a.edges].sort());
    expect(back.total).toBeCloseTo(out.total, 6);
  });

  it('runs Moho to Eve along the trunk, with Moho and Eve numbers on their rows', () => {
    const r = findRoute(g, 'Moho:low', 'Eve:low', plain)!;
    const v = routeView(layout, r.nodes, r.edges, plain);
    const eject = r.edges.find((e) => e.to === 'Eve:intercept:Moho')!;
    const capture = r.edges.find((e) => e.from === 'Eve:intercept:Moho')!;
    expect(v.labels.get('Moho:intercept:Kerbin->Moho:capture')).toBeCloseTo(eject.dv);
    expect(v.labels.get('Eve:intercept:Kerbin->Eve:capture')).toBeCloseTo(capture.dv);
    expect(v.labels.get('Kerbin:capture->Eve:intercept:Kerbin')).toBeNull();
    expect(v.shortcuts).toHaveLength(1);
  });

  it('reaches a synchronous orbit through the high capture, cheaper than via the low capture', () => {
    const r = findRoute(g, 'Duna:low', 'Kerbin:sync', plain)!;
    expect(r.nodes.slice(-3)).toEqual(['Kerbin:intercept:Duna', 'Kerbin:syncCapture', 'Kerbin:sync']);
    const viaLow =
      cost('Kerbin:intercept:Duna', 'Kerbin:capture') +
      cost('Kerbin:capture', 'Kerbin:syncTransfer') +
      cost('Kerbin:syncTransfer', 'Kerbin:sync');
    expect(cost('Kerbin:intercept:Duna', 'Kerbin:sync')).toBeLessThan(viaLow);
    near(cost('Kerbin:intercept:Duna', 'Kerbin:sync'), 688, 5);
    near(viaLow, 836, 5);
  });

  it('describes return legs as the burns they are', () => {
    const o = { aerobrake: true, chutes: true, planeChanges: false };
    const back = findRoute(g, 'Eeloo:surface', 'Kerbin:surface', o)!;
    expect(back.edges.map((e) => legLabel(g, e, o))).toEqual([
      'Launch to Eeloo low orbit',
      'Escape burn at Eeloo',
      'Eject from Eeloo toward Kerbin',
      'Aerocapture at Kerbin',
      'Aerobrake into Kerbin low orbit',
      'Deorbit and parachute to Kerbin surface',
    ]);
  });

  it('draws every edge between placed nodes', () => {
    for (const e of layout.edges) {
      expect(layout.nodes.has(e.from)).toBe(true);
      expect(layout.nodes.has(e.to)).toBe(true);
    }
  });
});
