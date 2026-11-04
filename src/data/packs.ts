import stock from '../../data/packs/stock.json';
import { PlanetarySystem, type SystemPack } from '../core/index.ts';

/** Packs bundled with the app. Mod packs join this list in phase 5. */
export const packs: Record<string, SystemPack> = {
  stock: stock as SystemPack,
};

export function loadSystem(id: string): PlanetarySystem {
  const pack = packs[id] ?? packs.stock!;
  return new PlanetarySystem(pack);
}
