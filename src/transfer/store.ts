import { create } from 'zustand';
import type { Body, PlanetarySystem } from '../core/index.ts';
import { defaultParkingAltitude, TransferProblem, type Transfer, type TransferMode, type TransferSettings } from './transfer.ts';

/** UI state of the transfer timeline: which origin, what is selected, how transfers are flown. */
interface TransferState {
  open: boolean;
  /** Origin body id; null = the pack's home body. */
  originId: string | null;
  /** Years shown on the timeline. */
  spanYears: number;
  mode: TransferMode;
  /** Capture into a low circular orbit at the target (else: flyby / aerobrake, no capture burn). */
  capture: boolean;
  selected: { targetId: string; transfer: Transfer } | null;
  porkchopTargetId: string | null;
  setOpen: (open: boolean) => void;
  setOrigin: (id: string) => void;
  setSpanYears: (y: number) => void;
  setMode: (m: TransferMode) => void;
  setCapture: (c: boolean) => void;
  select: (sel: { targetId: string; transfer: Transfer } | null) => void;
  openPorkchop: (targetId: string | null) => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  open: typeof location !== 'undefined' && new URLSearchParams(location.search).has('transfers'),
  originId: null,
  spanYears: 10,
  mode: 'optimal',
  capture: true,
  selected: null,
  porkchopTargetId: null,
  setOpen: (open) => set({ open, ...(open ? {} : { selected: null, porkchopTargetId: null }) }),
  setOrigin: (originId) => set({ originId, selected: null, porkchopTargetId: null }),
  setSpanYears: (spanYears) => set({ spanYears }),
  setMode: (mode) => set({ mode, selected: null }),
  setCapture: (capture) => set({ capture, selected: null }),
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

export function settingsFor(origin: Body, target: Body, mode: TransferMode, capture: boolean): TransferSettings {
  return {
    initialAltitude: defaultParkingAltitude(origin),
    finalAltitude: capture ? defaultParkingAltitude(target) : null,
    mode,
  };
}

export function problemFor(origin: Body, target: Body, mode: TransferMode, capture: boolean): TransferProblem {
  return new TransferProblem(origin, target, settingsFor(origin, target, mode, capture));
}
