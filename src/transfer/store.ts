import { create } from 'zustand';
import type { Body, PlanetarySystem } from '../core/index.ts';
import { defaultParkingAltitude, TransferProblem, type Transfer, type TransferMode, type TransferSettings } from './transfer.ts';

/** UI state of the transfer timeline: which origin, what is selected, how transfers are flown. */
interface TransferState {
  /** The planner page is showing (over the map). */
  open: boolean;
  /** Origin body id; null = the pack's home body. */
  originId: string | null;
  /** Years shown on the timeline. */
  /** Index into the origin's spans (2, 5, 10, 20 of its orbital periods). */
  spanIndex: number;
  mode: TransferMode;
  /** Capture into a low circular orbit at the target (else: flyby / aerobrake, no capture burn). */
  capture: boolean;
  /** Parking orbit altitude at the origin, metres; null = the body's default low orbit. */
  initialAltitude: number | null;
  selected: { targetId: string; transfer: Transfer } | null;
  /** Target whose porkchop plot is shown; null = the selected transfer's, else the first. */
  porkchopTargetId: string | null;
  setOpen: (open: boolean) => void;
  setOrigin: (id: string) => void;
  setSpanIndex: (i: number) => void;
  setMode: (m: TransferMode) => void;
  setCapture: (c: boolean) => void;
  setInitialAltitude: (m: number | null) => void;
  select: (sel: { targetId: string; transfer: Transfer } | null) => void;
  openPorkchop: (targetId: string | null) => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  open: typeof location !== 'undefined' && new URLSearchParams(location.search).has('transfers'),
  originId: null,
  spanIndex: 2,
  mode: 'optimal',
  capture: true,
  initialAltitude: null,
  selected: null,
  porkchopTargetId: null,
  setOpen: (open) => set({ open }),
  setOrigin: (originId) => set({ originId, initialAltitude: null, selected: null, porkchopTargetId: null }),
  setSpanIndex: (spanIndex) => set({ spanIndex }),
  // Settings changes keep the selected transfer; the planner re-solves it with the new settings.
  setMode: (mode) => set({ mode }),
  setCapture: (capture) => set({ capture }),
  setInitialAltitude: (initialAltitude) => set({ initialAltitude }),
  select: (selected) => set({ selected }),
  openPorkchop: (porkchopTargetId) => set({ porkchopTargetId }),
}));

/** Bodies a transfer can start from: anything that shares its parent with another body. */
export function originCandidates(system: PlanetarySystem): Body[] {
  return system.bodies.filter((b) => b.parent && b.parent.children.length > 1);
}

export function targetsOf(origin: Body): Body[] {
  return origin.parent ? origin.parent.children.filter((b) => b !== origin) : [];
}

/** The options that change the numbers: how to fly, whether to capture, the parking orbit. */
export interface TransferOptions {
  mode: TransferMode;
  capture: boolean;
  initialAltitude: number | null;
}

export function settingsFor(origin: Body, target: Body, o: TransferOptions): TransferSettings {
  return {
    initialAltitude: o.initialAltitude ?? defaultParkingAltitude(origin),
    finalAltitude: o.capture ? defaultParkingAltitude(target) : null,
    mode: o.mode,
  };
}

export function problemFor(origin: Body, target: Body, o: TransferOptions): TransferProblem {
  return new TransferProblem(origin, target, settingsFor(origin, target, o));
}
