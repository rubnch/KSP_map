import { create } from 'zustand';
import { loadSystem } from '../data/packs.ts';
import type { PlanetarySystem } from '../core/index.ts';

/** Time warp steps, like the game's map view, plus two faster steps for long transfers. */
export const WARP_STEPS = [1, 5, 10, 50, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000] as const;

export type ViewMode = '3d' | '2d';

interface MapState {
  system: PlanetarySystem;
  focusId: string;
  hoverId: string | null;
  ut: number;
  warpIndex: number;
  paused: boolean;
  viewMode: ViewMode;
  /** Bumped whenever the camera should re-frame the focused body. */
  focusSerial: number;
  setFocus: (id: string) => void;
  setHover: (id: string | null) => void;
  setUt: (ut: number) => void;
  setWarpIndex: (i: number) => void;
  togglePause: () => void;
  setViewMode: (m: ViewMode) => void;
  cycleFocus: (dir: 1 | -1) => void;
}

function initialParams() {
  const p = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  return { pack: p.get('pack') ?? 'stock', focus: p.get('focus'), ut: Number(p.get('ut')) || 0 };
}

const params = initialParams();
const system = loadSystem(params.pack);

export const useMapStore = create<MapState>((set, get) => ({
  system,
  focusId: params.focus && system.find(params.focus) ? params.focus : system.home.id,
  hoverId: null,
  ut: Math.max(0, params.ut),
  warpIndex: 0,
  paused: false,
  viewMode: '3d',
  focusSerial: 0,
  setFocus: (id) => set((s) => ({ focusId: id, focusSerial: s.focusSerial + 1 })),
  setHover: (id) => set({ hoverId: id }),
  setUt: (ut) => set({ ut: Math.max(0, ut) }),
  setWarpIndex: (i) => set({ warpIndex: Math.min(WARP_STEPS.length - 1, Math.max(0, i)) }),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  setViewMode: (viewMode) => set({ viewMode }),
  cycleFocus: (dir) => {
    const { system, focusId, setFocus } = get();
    const list = system.bodies;
    const i = list.findIndex((b) => b.id === focusId);
    setFocus(list[(i + dir + list.length) % list.length]!.id);
  },
}));

// Keep the focused body in the URL so a view can be shared.
useMapStore.subscribe((s, prev) => {
  if (s.focusId === prev.focusId || typeof history === 'undefined') return;
  const p = new URLSearchParams(location.search);
  p.set('focus', s.focusId);
  history.replaceState(null, '', `?${p.toString()}`);
});
