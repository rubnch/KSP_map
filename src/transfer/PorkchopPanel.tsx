import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, formatUt, type Body } from '../core/index.ts';
import { useMapStore } from '../state/store.ts';
import { requestPorkchop } from './client.ts';
import { problemFor, useTransferStore } from './store.ts';
import { porkchopRange, type PorkchopGrid } from './windows.ts';

const W = 180;
const H = 140;

// Sequential single-hue ramp (blue), dark → light: on the dark map, cheap transfers are the bright ones.
const RAMP = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
const RAMP_RGB = RAMP.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const);

/**
 * Departure date (x) against time of flight (y), coloured by total Δv. Click a point to pick
 * that transfer; it is drawn on the map and the clock jumps to its departure.
 */
export function PorkchopPanel({ origin, target }: { origin: Body; target: Body }) {
  const system = useMapStore((s) => s.system);
  const ut = useMapStore((s) => s.ut);
  const cal = system.pack.calendar;
  const { mode, capture, initialAltitude, selected, select } = useTransferStore();
  const problem = useMemo(
    () => problemFor(origin, target, { mode, capture, initialAltitude }),
    [origin, target, mode, capture, initialAltitude],
  );

  // Centre on the selected transfer if it goes to this target, else on now + half a synodic period.
  const center =
    selected?.targetId === target.id ? selected.transfer.departure : ut + Math.min(problem.synodicPeriod, 2 * origin.orbit!.period) / 2;
  const [range, setRange] = useState(() => porkchopRange(problem, center));
  // A new target re-centres the plot; a settings change (Optimal / Ballistic, orbits) keeps it where it is.
  useEffect(() => setRange(porkchopRange(problem, center)), [target.id, origin.id]);
  // A window picked on the timeline that is off the plot: move the plot to it.
  const selDep = selected?.targetId === target.id ? selected.transfer.departure : null;
  useEffect(() => {
    if (selDep !== null && (selDep < range.depFrom || selDep > range.depTo)) setRange(porkchopRange(problem, selDep));
  }, [selDep]);

  const [grid, setGrid] = useState<PorkchopGrid | null>(null);
  useEffect(() => {
    let alive = true;
    setGrid(null);
    requestPorkchop(system.pack, origin.id, target.id, problem.settings, range, W, H).then(
      (g) => alive && setGrid(g),
      () => alive && setGrid(null),
    );
    return () => {
      alive = false;
    };
  }, [system.pack, origin, target, problem, range]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const scaleMax = grid ? grid.min.dv * 2 : 1;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !grid) return;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const lo = Math.log(grid.min.dv);
    const hi = Math.log(scaleMax);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const v = grid.dv[j * W + i]!;
        const o = ((H - 1 - j) * W + i) * 4; // row 0 (shortest flight) at the bottom
        if (!Number.isFinite(v)) {
          img.data[o + 3] = 0;
          continue;
        }
        const f = 1 - Math.max(0, Math.min(1, (Math.log(v) - lo) / (hi - lo)));
        const [r, g, b] = RAMP_RGB[Math.round(f * (RAMP_RGB.length - 1))]!;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [grid, scaleMax]);

  const [hover, setHover] = useState<{ x: number; y: number; dep: number; tof: number; dv: number } | null>(null);
  const toData = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const dep = range.depFrom + fx * (range.depTo - range.depFrom);
    const tof = range.tofTo - fy * (range.tofTo - range.tofFrom);
    return { x: fx * 100, y: fy * 100, dep, tof };
  };

  const pick = (dep: number, tof: number) => {
    const tr = problem.transfer(dep, tof);
    if (!tr || !Number.isFinite(tr.dv)) return;
    select({ targetId: target.id, transfer: tr });
    const s = useMapStore.getState();
    if (!s.paused) s.togglePause();
    s.setUt(dep);
  };

  const mark = (dep: number, tof: number) => ({
    left: `${((dep - range.depFrom) / (range.depTo - range.depFrom)) * 100}%`,
    top: `${(1 - (tof - range.tofFrom) / (range.tofTo - range.tofFrom)) * 100}%`,
  });
  const sel = selected?.targetId === target.id ? selected.transfer : null;
  const shift = (f: number) => {
    const d = (range.depTo - range.depFrom) * f;
    setRange({ ...range, depFrom: Math.max(0, range.depFrom + d), depTo: Math.max(range.depTo - range.depFrom, range.depTo + d) });
  };

  return (
    <div className="porkchop" aria-label={`Porkchop plot ${origin.name} to ${target.name}`}>
      <header>
        <strong>
          {origin.name} → {target.name}
        </strong>
        <span className="pc-legend">
          <span>{grid ? `${Math.round(grid.min.dv).toLocaleString('en-US')}` : '…'}</span>
          <span className="pc-ramp" style={{ background: `linear-gradient(to right, ${[...RAMP].reverse().join(',')})` }} />
          <span>{grid ? `≥ ${Math.round(scaleMax).toLocaleString('en-US')} m/s` : ''}</span>
        </span>
        <button onClick={() => shift(-0.5)} title="Earlier departures">
          ◀
        </button>
        <button onClick={() => shift(0.5)} title="Later departures">
          ▶
        </button>
      </header>
      <div className="pc-plot">
        <div className="pc-yaxis">
          <span>{formatDuration(range.tofTo, cal)}</span>
          <span className="pc-axis-title">flight time</span>
          <span>{formatDuration(range.tofFrom, cal)}</span>
        </div>
        <div
          className="pc-canvas-wrap"
          onPointerMove={(e) => {
            const d = toData(e);
            setHover({ ...d, dv: problem.dv(d.dep, d.tof) });
          }}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const d = toData(e);
            pick(d.dep, d.tof);
          }}
        >
          <canvas ref={canvas} width={W} height={H} />
          {!grid && <div className="pc-loading">computing…</div>}
          {grid && Number.isFinite(grid.min.dv) && (
            <button
              className="pc-min"
              style={mark(grid.min.departure, grid.min.timeOfFlight)}
              title="Cheapest transfer in the plot"
              onClick={(e) => {
                e.stopPropagation();
                pick(grid.min.departure, grid.min.timeOfFlight);
              }}
            />
          )}
          {sel && <div className="pc-selected" style={mark(sel.departure, sel.timeOfFlight)} />}
          {hover && (
            <>
              <div className="pc-cross-x" style={{ top: `${hover.y}%` }} />
              <div className="pc-cross-y" style={{ left: `${hover.x}%` }} />
              <div className="pc-tip" style={{ left: `${Math.min(62, hover.x)}%`, top: `${Math.min(70, hover.y)}%` }}>
                <strong>{Number.isFinite(hover.dv) ? `${Math.round(hover.dv).toLocaleString('en-US')} m/s` : 'no solution'}</strong>
                <span>depart {formatUt(hover.dep, cal).replace(/ - .*/, '')}</span>
                <span>{formatDuration(hover.tof, cal)} flight</span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="pc-xaxis">
        <span>{formatUt(range.depFrom, cal).replace(/ - .*/, '')}</span>
        <span className="pc-axis-title">departure</span>
        <span>{formatUt(range.depTo, cal).replace(/ - .*/, '')}</span>
      </div>
    </div>
  );
}
