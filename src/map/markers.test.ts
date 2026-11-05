import { describe, expect, it } from 'vitest';
import stock from '../../data/packs/stock.json';
import { PlanetarySystem, type SystemPack } from '../core/index.ts';
import { focusMarkers } from './markers.ts';

const system = new PlanetarySystem(stock as SystemPack);

describe('focusMarkers', () => {
  it('shows the planets\' apsides when looking at the Sun', () => {
    const keys = focusMarkers(system.root).map((m) => m.key);
    for (const planet of ['Moho', 'Eve', 'Duna', 'Dres', 'Jool', 'Eeloo']) {
      expect(keys).toContain(`${planet}-ap`);
      expect(keys).toContain(`${planet}-pe`);
    }
    expect(keys.some((k) => k.endsWith('-an') || k.endsWith('-dn'))).toBe(false);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the focused body\'s own Ap/Pe/AN/DN and adds its moons\' apsides', () => {
    const keys = focusMarkers(system.get('Duna')).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['Duna-ap', 'Duna-pe', 'Duna-an', 'Duna-dn']));
    // Ike's orbit is nearly circular but not quite.
    expect(keys).toEqual(expect.arrayContaining(['Ike-ap', 'Ike-pe']));
  });
});
