import type { SystemPack } from '../core/index.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import type { TransferSettings } from './transfer.ts';
import type { PorkchopGrid, TransferWindow } from './windows.ts';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

/**
 * A small pool of transfer workers. Results are cached per pack, origin, target, settings and
 * range, so scrubbing back and forth or reopening a porkchop is instant.
 */
const POOL_SIZE = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1);
let pool: Worker[] | null = null;
let next = 0;
let nextId = 1;
const pending = new Map<number, Pending>();
const cache = new Map<string, Promise<unknown>>();

function workers(): Worker[] {
  if (pool) return pool;
  pool = Array.from({ length: POOL_SIZE }, () => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.kind === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    return w;
  });
  return pool;
}

type Request = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

function send(req: Request): Promise<WorkerResponse> {
  const id = nextId++;
  const list = workers();
  const w = list[next++ % list.length]!;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...req, id });
  });
}

function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = run();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

const settingsKey = (s: TransferSettings) => `${s.mode}:${s.initialAltitude}:${s.finalAltitude}`;

export function requestWindows(
  pack: SystemPack,
  origin: string,
  target: string,
  settings: TransferSettings,
  from: number,
  to: number,
): Promise<TransferWindow[]> {
  const key = `w|${pack.id}|${origin}|${target}|${settingsKey(settings)}|${from}|${to}`;
  return cached(key, () =>
    send({ kind: 'windows', pack, origin, target, settings, from, to }).then((r) => (r.kind === 'windows' ? r.windows : [])),
  );
}

export function requestPorkchop(
  pack: SystemPack,
  origin: string,
  target: string,
  settings: TransferSettings,
  range: { depFrom: number; depTo: number; tofFrom: number; tofTo: number },
  width: number,
  height: number,
): Promise<PorkchopGrid> {
  const key = `p|${pack.id}|${origin}|${target}|${settingsKey(settings)}|${range.depFrom}|${range.depTo}|${range.tofFrom}|${range.tofTo}|${width}x${height}`;
  return cached(key, () =>
    send({ kind: 'porkchop', pack, origin, target, settings, ...range, width, height }).then((r) => {
      if (r.kind !== 'porkchop') throw new Error('Unexpected worker reply');
      return r.grid;
    }),
  );
}
