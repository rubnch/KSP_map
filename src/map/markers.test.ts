import { describe, expect, it } from 'vitest';
import stock from '../../data/packs/stock.json';
import { PlanetarySystem, type SystemPack } from '../core/index.ts';
import { orbitMarkers } from './markers.ts';

const system = new PlanetarySystem(stock as SystemPack);

describe('orbitMarkers', () => {
  it('shows Ap and Pe on a perfectly circular orbit (Kerbin around the Sun)', () => {
    const markers = orbitMarkers(system.get('Kerbin'));
    expect(markers.map((m) => m.kind)).toEqual(['pe', 'ap']);
    expect(markers[0]!.altitude).toBeCloseTo(markers[1]!.altitude!, 0);
  });

  it('adds AN/DN on an inclined orbit', () => {
    expect(orbitMarkers(system.get('Moho')).map((m) => m.kind)).toEqual(['pe', 'ap', 'an', 'dn']);
  });

  it('has none for the Sun', () => {
    expect(orbitMarkers(system.root)).toEqual([]);
  });
});
