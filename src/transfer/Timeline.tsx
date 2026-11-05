import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { formatDuration, formatUt, type Body } from '../core/index.ts';
import { useMapStore } from '../state/store.ts';
import { requestWindows } from './client.ts';
import { settingsFor, useTransferStore, type TransferOptions } from './store.ts';
import { defaultParkingAltitude } from './transfer.ts';
import { tickLabel, tickStep } from './span.ts';
import type { TransferWindow } from './windows.ts';

export type WindowsByTarget = Record<string, TransferWindow[] | 'loading' | 'error'>;

/** Windows for every target over [from, to], computed in the workers (cached). */
export function useWindows(origin: Body, targets: Body[], from: number, to: number, options: TransferOptions) {
  const { mode, capture, initialAltitude } = options;
  const pack = useMapStore((s) => s.system.pack);
  const [state, setState] = useState<WindowsByTarget>({});
  useEffect(() => {
    let alive = true;
    setState(Object.fromEntries(targets.map((b) => [b.id, 'loading'])));
    // Start a little before the range so a window that is open right now still shows.
    const start = Math.max(0, from - (to - from) / 10);
    for (const target of targets) {
      requestWindows(pack, origin.id, target.id, settingsFor(origin, target, { mode, capture, initialAltitude }), start, to).then(
        (w) => alive && setState((s) => ({ ...s, [target.id]: w })),
        () => alive && setState((s) => ({ ...s, [target.id]: 'error' })),
      );
    }
    return () => {
      alive = false;
    };
  }, [pack, origin, targets, from, to, mode, capture, initialAltitude]);
  return state;
}

/**
 * Scrubbable timeline: one row per target, a bar per window. Drag along it to move the clock;
 * click a window to select that transfer; click a body's name for its porkchop plot.
 */
export function Track(props: {
  origin: Body;
  targets: Body[];
  windows: WindowsByTarget;
  from: number;
  to: number;
  ut: number;
  /** Target whose porkchop plot is showing. */
  porkchopId: string | null;
}) {
  const { origin, targets, windows, from, to, ut } = props;
  const cal = useMapStore((s) => s.system.pack.calendar);
  const setUt = useMapStore((s) => s.setUt);
  const t = useTransferStore();
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; text: string } | null>(null);
  const pct = (time: number) => ((time - from) / (to - from)) * 100;

  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return from + f * (to - from);
  };

  // Scrub: press and drag anywhere on the track (but not on a window) to move the clock.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.tt-window')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Scrubbing picks a date: stop the clock so it stays there.
    const s = useMapStore.getState();
    if (!s.paused) s.togglePause();
    setUt(timeAt(e.clientX));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) setUt(timeAt(e.clientX));
  };

  const step = tickStep(to - from, cal);
  const ticks: number[] = [];
  for (let x = Math.ceil(from / step) * step; x <= to; x += step) ticks.push(x);

  const choose = (target: Body, w: TransferWindow) => {
    t.select({ targetId: target.id, transfer: w.best });
    t.openPorkchop(target.id);
    const s = useMapStore.getState();
    if (!s.paused) s.togglePause();
    setUt(w.best.departure);
  };

  return (
    <div className="tt-body">
      <div className="tt-labels">
        <div className="tt-axis-spacer" />
        {targets.map((b) => (
          <button
            key={b.id}
            className={`tt-label${props.porkchopId === b.id ? ' on' : ''}`}
            title={`Porkchop plot ${origin.name} → ${b.name}`}
            onClick={() => t.openPorkchop(b.id)}
          >
            <span className="dot" style={{ background: b.data.style.color }} />
            {b.name}
          </button>
        ))}
      </div>
      <div
        className="tt-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <div className="tt-axis">
          {ticks.map((x, i) => (
            <span key={x} className="tt-year" style={{ left: `${pct(x)}%` }}>
              {tickLabel(x, step, cal, i === 0)}
            </span>
          ))}
        </div>
        {ticks.map((y) => (
          <div key={y} className="tt-gridline" style={{ left: `${pct(y)}%` }} />
        ))}
        {targets.map((b) => {
          const list = windows[b.id];
          const visible = Array.isArray(list) ? list.filter((w) => w.close >= from && w.open <= to) : [];
          const cheapest = visible.reduce<TransferWindow | null>((m, w) => (!m || w.best.dv < m.best.dv ? w : m), null);
          return (
            <div key={b.id} className="tt-row">
              {list === 'loading' && <span className="tt-status">computing…</span>}
              {list === 'error' && <span className="tt-status">no transfers found</span>}
              {Array.isArray(list) && visible.length === 0 && <span className="tt-status">no window in range</span>}
              {visible.map((w, i) => {
                // Δv label only where it fits before the next window (~4% of the track).
                const nextOpen = visible[i + 1] ? pct(visible[i + 1]!.open) : 100;
                const isSel = t.selected?.targetId === b.id && Math.abs(t.selected.transfer.departure - w.best.departure) < w.close - w.open;
                const left = Math.max(0, pct(w.open));
                const right = Math.min(100, pct(w.close));
                const text = `${origin.name} → ${b.name}: ${Math.round(w.best.dv).toLocaleString('en-US')} m/s · depart ${formatUt(w.best.departure, cal)} · ${formatDuration(w.best.timeOfFlight, cal)} flight`;
                return (
                  <button
                    key={w.best.departure}
                    className={`tt-window${w === cheapest ? ' cheapest' : ''}${isSel ? ' selected' : ''}`}
                    style={{ left: `${left}%`, width: `${Math.max(0.6, right - left)}%` }}
                    onClick={() => choose(b, w)}
                    onPointerEnter={() => setHover({ x: pct(w.best.departure), text })}
                    onPointerLeave={() => setHover(null)}
                    aria-label={text}
                  >
                    <span className="tt-diamond" style={{ left: `${((pct(w.best.departure) - left) / Math.max(0.6, right - left)) * 100}%` }} />
                    {nextOpen - right > 4 && <span className="tt-dv">{(w.best.dv / 1000).toFixed(2)}k</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
        {ut >= from && ut <= to && <div className="tt-cursor" style={{ left: `${pct(ut)}%` }} />}
        {hover && (
          <div className="tt-tooltip" style={{ left: `${Math.min(80, Math.max(20, hover.x))}%` }}>
            {hover.text}
          </div>
        )}
      </div>
    </div>
  );
}

export function fmtKm(m: number) {
  return `${Math.round(m / 1000)} km`;
}

/** Parking orbit altitude at the origin, in km. Empty = the body's low orbit from the Δv map. */
export function AltitudeInput({ origin }: { origin: Body }) {
  const value = useTransferStore((s) => s.initialAltitude);
  const set = useTransferStore((s) => s.setInitialAltitude);
  const fallback = defaultParkingAltitude(origin);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const km = Number(draft);
    const m = Math.round(km * 1000);
    // Must clear the surface and stay inside the SOI; anything else goes back to the default.
    set(draft.trim() === '' || !(km > 0) || m === fallback || origin.radius + m >= origin.soi ? null : m);
    setDraft(null);
  };
  return (
    <label title={`Circular parking orbit you leave ${origin.name} from. Default: its low orbit on the Δv map.`}>
      orbit
      <input
        className="tt-alt"
        type="number"
        min={1}
        step={10}
        value={draft ?? String(Math.round((value ?? fallback) / 1000))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      km
      {value !== null && (
        <button className="tt-reset" onClick={() => set(null)} title={`Back to ${Math.round(fallback / 1000)} km`}>
          ↺
        </button>
      )}
    </label>
  );
}
