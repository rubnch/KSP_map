import { create } from 'zustand';
import { useMapStore } from '../state/store.ts';

type Overrides = Record<string, number>;

interface DvState {
  from: string | null;
  to: string | null;
  aerobrake: boolean;
  planeChanges: boolean;
  /** Ascent / landing overrides for the loaded pack, by body id, m/s. */
  overrides: Overrides;
  pick: (id: string) => void;
  swap: () => void;
  clear: () => void;
  setAerobrake: (v: boolean) => void;
  setPlaneChanges: (v: boolean) => void;
  setOverride: (bodyId: string, value: number | null) => void;
}

const storageKey = () => `ksp-map:dv-overrides:${useMapStore.getState().system.pack.id}`;

function loadOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(storageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveOverrides(o: Overrides) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(o));
  } catch {
    // Private mode or blocked storage: overrides just last for this visit.
  }
}

export const useDvStore = create<DvState>((set, get) => ({
  from: null,
  to: null,
  aerobrake: false,
  planeChanges: false,
  overrides: loadOverrides(),
  // First click picks the start, second the destination, a third starts over.
  pick: (id) => {
    const { from, to } = get();
    if (!from || (from && to)) set({ from: id, to: null });
    else if (id === from) set({ from: null });
    else set({ to: id });
  },
  swap: () => set((s) => ({ from: s.to ?? s.from, to: s.to ? s.from : null })),
  clear: () => set({ from: null, to: null }),
  setAerobrake: (aerobrake) => set({ aerobrake }),
  setPlaneChanges: (planeChanges) => set({ planeChanges }),
  setOverride: (bodyId, value) => {
    const overrides = { ...get().overrides };
    if (value === null || !Number.isFinite(value)) delete overrides[bodyId];
    else overrides[bodyId] = value;
    saveOverrides(overrides);
    set({ overrides });
  },
}));
