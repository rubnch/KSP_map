import type { SystemPack } from '../core/index.ts';
import type { TransferSettings } from './transfer.ts';
import type { PorkchopGrid, TransferWindow } from './windows.ts';

/** Messages between the UI and the transfer worker. */
export type WorkerRequest =
  | { id: number; kind: 'windows'; pack: SystemPack; origin: string; target: string; settings: TransferSettings; from: number; to: number }
  | {
      id: number;
      kind: 'porkchop';
      pack: SystemPack;
      origin: string;
      target: string;
      settings: TransferSettings;
      depFrom: number;
      depTo: number;
      tofFrom: number;
      tofTo: number;
      width: number;
      height: number;
    };

export type WorkerResponse =
  | { id: number; kind: 'windows'; windows: TransferWindow[] }
  | { id: number; kind: 'porkchop'; grid: PorkchopGrid }
  | { id: number; kind: 'error'; message: string };
