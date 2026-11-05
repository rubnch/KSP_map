import { create } from 'zustand';
import { useMapStore } from '../state/store.ts';

type Overrides = Record<string, number>;

/** What the calculator counts. Kept across visits. */
export interface DvSettings {
  /** Totals include the way back to the start. */
  roundTrip: boolean;
  /** Captures and circularizations use the atmosphere where there is one. */
  aerobrake: boolean;
  /** Landings where there is an atmosphere cost only the deorbit burn. */
  chutes: boolean;
  /** Plane changes are added at their worst case. */
  planeChanges: boolean;
  /** Synchronous orbits are on the map (and in routes). */
  sync: boolean;
}

const DEFAULT_SETTINGS: DvSettings = {
  roundTrip: false,
  aerobrake: false,
  chutes: false,
  planeChanges: false,
  sync: false,
};

interface DvState extends DvSettings {
  from: string | null;
  to: string | null;
  /** Ascent / landing overrides for the loaded pack, by body id, m/s. */
  overrides: Overrides;
  pick: (id: string) => void;
  swap: () => void;
  clear: () => void;
  setSetting: (key: keyof DvSettings, value: boolean) => void;
  setOverride: (bodyId: string, value: number | null) => void;
}

const storageKey = () => `ksp-map:dv-overrides:${useMapStore.getState().system.pack.id}`;
// v2: synchronous orbits became off by default, so earlier saved settings start over.
const SETTINGS_KEY = 'ksp-map:dv-settings-v2';

function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: object) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: settings just last for this visit.
  }
}

const settingsOf = (s: DvSettings): DvSettings => ({
  roundTrip: s.roundTrip,
  aerobrake: s.aerobrake,
  chutes: s.chutes,
  planeChanges: s.planeChanges,
  sync: s.sync,
});

export const useDvStore = create<DvState>((set, get) => ({
  from: null,
  to: null,
  ...settingsOf(load(SETTINGS_KEY, DEFAULT_SETTINGS)),
  overrides: load<Overrides>(storageKey(), {}),
  // First click picks the start, second the destination, a third starts over.
  pick: (id) => {
    const { from, to } = get();
    if (!from || (from && to)) set({ from: id, to: null });
    else if (id === from) set({ from: null });
    else set({ to: id });
  },
  swap: () => set((s) => ({ from: s.to ?? s.from, to: s.to ? s.from : null })),
  clear: () => set({ from: null, to: null }),
  setSetting: (key, value) => {
    set({ [key]: value } as Partial<DvSettings>);
    save(SETTINGS_KEY, settingsOf(get()));
  },
  setOverride: (bodyId, value) => {
    const overrides = { ...get().overrides };
    if (value === null || !Number.isFinite(value)) delete overrides[bodyId];
    else overrides[bodyId] = value;
    save(storageKey(), overrides);
    set({ overrides });
  },
}));
