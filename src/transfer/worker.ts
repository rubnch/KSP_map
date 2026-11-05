/// <reference lib="webworker" />
import { PlanetarySystem, type SystemPack } from '../core/index.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import { TransferProblem } from './transfer.ts';
import { findWindows, porkchop } from './windows.ts';

/** Lambert searches run here so the map keeps its frame rate. */
const systems = new Map<string, PlanetarySystem>();

function systemFor(pack: SystemPack): PlanetarySystem {
  let s = systems.get(pack.id);
  if (!s) systems.set(pack.id, (s = new PlanetarySystem(pack)));
  return s;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    const system = systemFor(req.pack);
    const problem = new TransferProblem(system.get(req.origin), system.get(req.target), req.settings);
    let res: WorkerResponse;
    if (req.kind === 'windows') {
      res = { id: req.id, kind: 'windows', windows: findWindows(problem, req.from, req.to) };
      self.postMessage(res);
    } else {
      const grid = porkchop(problem, req.depFrom, req.depTo, req.tofFrom, req.tofTo, req.width, req.height);
      res = { id: req.id, kind: 'porkchop', grid };
      self.postMessage(res, { transfer: [grid.dv.buffer] });
    }
  } catch (e) {
    self.postMessage({ id: req.id, kind: 'error', message: String(e) } satisfies WorkerResponse);
  }
};
