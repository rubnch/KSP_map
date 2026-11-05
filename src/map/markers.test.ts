import { describe, expect, it } from 'vitest';
import stock from '../../data/packs/stock.json';
import { PlanetarySystem, type SystemPack } from '../core/index.ts';
import { orbitMarkers } from './markers.ts';

const system = new PlanetarySystem(stock as SystemPack);
const summary = (id: string) => orbitMarkers(system.get(id)).map((m) => m.kind + (m.node ? `+${m.node.kind}` : ''));

describe('orbitMarkers', () => {
  it('shows Ap and Pe on a perfectly circular orbit (Kerbin around the Sun)', () => {
    const markers = orbitMarkers(system.get('Kerbin'));
    expect(markers.map((m) => m.kind)).toEqual(['pe', 'ap']);
    expect(markers[0]!.altitude).toBeCloseTo(markers[1]!.altitude!, 0);
  });

  it('merges nodes that sit on an apsis into its label (Eve: argument of periapsis 0°)', () => {
    expect(summary('Eve')).toEqual(['pe+an', 'ap+dn']);
  });

  it('keeps nodes separate when they are away from the apsides', () => {
    expect(summary('Moho')).toEqual(['pe', 'ap', 'an', 'dn']); // 15° from Pe
    expect(summary('Dres')).toEqual(['pe', 'ap', 'an', 'dn']); // 90°
  });

  it('labels nodes with the inclination, signed like the game', () => {
    const labels = orbitMarkers(system.get('Moho')).map((m) => m.label);
    expect(labels).toContain('AN +7.0°');
    expect(labels).toContain('DN \u22127.0°');
    expect(orbitMarkers(system.get('Eve'))[0]!.node!.label).toBe('AN +2.1°');
  });

  it('has none for the Sun', () => {
    expect(orbitMarkers(system.root)).toEqual([]);
  });
});
