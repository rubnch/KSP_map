import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatDuration, formatUt, type Body } from '../core/index.ts';
import { useMapStore } from '../state/store.ts';
import { requestWindows } from './client.ts';
import { PorkchopPanel } from './PorkchopPanel.tsx';
import { originCandidates, settingsFor, targetsOf, useTransferStore, type TransferOptions } from './store.ts';
import { defaultParkingAltitude } from './transfer.ts';
import { TransferDetails } from './TransferDetails.tsx';
import type { TransferWindow } from './windows.ts';
import './transfer.css';

const SPANS = [2, 5, 10, 20];

/**
 * Scrubbable timeline of the next transfer windows from one origin to each of its siblings.
 * Drag along it to move the map clock; click a window to jump there and draw the transfer.
 */
export function TransferTimeline() {
  const open = useTransferStore((s) => s.open);
  const setOpen = useTransferStore((s) => s.setOpen);
  if (!open) {
    return (
      <button className="panel transfer-open" onClick={() => setOpen(true)} title="Transfer windows and porkchop plots">
        Transfer windows
      </button>
    );
  }
  return <TimelinePanel />;
}

function TimelinePanel() {
  const system = useMapStore((s) => s.system);
  const ut = useMapStore((s) => s.ut);
  const t = useTransferStore();
  const origin = system.find(t.originId ?? '') ?? system.home;
  const targets = useMemo(() => targetsOf(origin), [origin]);
  const year = system.pack.calendar.yearLength;

  // The visible range starts at the beginning of the year the panel opened in and only moves
  // with the ◀ ▶ and "Now" buttons. It never follows the clock: at high time warp that would
  // shift it (and recompute every window) many times a second.
  const [rangeStart, setRangeStart] = useState(() => Math.floor(ut / year) * year);
  const rangeEnd = rangeStart + t.spanYears * year;
  const page = (dir: 1 | -1) => setRangeStart((s) => Math.max(0, s + dir * Math.max(1, t.spanYears / 2) * year));
  const clockOutside = ut < rangeStart || ut > rangeEnd;

  const options: TransferOptions = { mode: t.mode, capture: t.capture, initialAltitude: t.initialAltitude };
  const windows = useWindows(origin, targets, rangeStart, rangeEnd, options);

  return (
    <section className="panel transfer-timeline" aria-label="Transfer windows">
      <header className="tt-header">
        <strong>Transfer windows</strong>
        <label>
          from{' '}
          <select value={origin.id} onChange={(e) => t.setOrigin(e.target.value)}>
            {originCandidates(system).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <div className="tt-seg" role="group" aria-label="Plane change">
          <button
            className={t.mode === 'optimal' ? 'on' : ''}
            onClick={() => t.setMode('optimal')}
            title="Cheapest of a direct transfer and one with a mid-course plane change"
          >
            Optimal
          </button>
          <button
            className={t.mode === 'ballistic' ? 'on' : ''}
            onClick={() => t.setMode('ballistic')}
            title="Direct transfer, no mid-course burn"
          >
            Ballistic
          </button>
        </div>
        <AltitudeInput origin={origin} />
        <label title="Include the burn into a low circular orbit at the target. Off: flyby or aerobraking.">
          <input type="checkbox" checked={t.capture} onChange={(e) => t.setCapture(e.target.checked)} /> capture burn
        </label>
        <div className="tt-seg" role="group" aria-label="Years shown">
          {SPANS.map((y) => (
            <button key={y} className={t.spanYears === y ? 'on' : ''} onClick={() => t.setSpanYears(y)}>
              {y}y
            </button>
          ))}
        </div>
        <div className="tt-seg" role="group" aria-label="Move the timeline">
          <button onClick={() => page(-1)} disabled={rangeStart === 0} title="Earlier" aria-label="Earlier">
            ◀
          </button>
          <button
            className={clockOutside ? 'on' : ''}
            onClick={() => setRangeStart(Math.floor(ut / year) * year)}
            title="Show the clock's current date"
          >
            Now
          </button>
          <button onClick={() => page(1)} title="Later" aria-label="Later">
            ▶
          </button>
        </div>
        <button className="tt-close" onClick={() => t.setOpen(false)} aria-label="Close transfer windows">
          ✕
        </button>
      </header>

      <Track
        origin={origin}
        targets={targets}
        windows={windows}
        from={rangeStart}
        to={rangeEnd}
        ut={ut}
        yearLength={year}
      />

      {t.selected && <TransferDetails origin={origin} />}
      {/* Portalled: the panel's backdrop-filter would otherwise pin the "fixed" plot inside the timeline. */}
      {t.porkchopTargetId &&
        system.find(t.porkchopTargetId) &&
        createPortal(<PorkchopPanel origin={origin} target={system.get(t.porkchopTargetId)} />, document.body)}
      <p className="tt-note">
        Δv from a parking orbit {fmtKm(settingsFor(origin, origin, options).initialAltitude)} above {origin.name}
        {t.capture ? ", with capture into the target's low orbit (as on the Δv map)" : ', no capture burn'}. Bars span
        the dates within 10% of the best Δv. Drag along the timeline to move the clock.
      </p>
    </section>
  );
}

type WindowsByTarget = Record<string, TransferWindow[] | 'loading' | 'error'>;

function useWindows(origin: Body, targets: Body[], from: number, to: number, options: TransferOptions) {
  const { mode, capture, initialAltitude } = options;
  const pack = useMapStore((s) => s.system.pack);
  const [state, setState] = useState<WindowsByTarget>({});
  useEffect(() => {
    let alive = true;
    setState(Object.fromEntries(targets.map((b) => [b.id, 'loading'])));
    // Start a little before the range so a window that is open right now still shows.
    const start = Math.max(0, from - pack.calendar.yearLength / 2);
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

function Track(props: {
  origin: Body;
  targets: Body[];
  windows: WindowsByTarget;
  from: number;
  to: number;
  ut: number;
  yearLength: number;
}) {
  const { origin, targets, windows, from, to, ut, yearLength } = props;
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

  const years: number[] = [];
  for (let y = Math.ceil(from / yearLength) * yearLength; y <= to; y += yearLength) years.push(y);
  const yearStep = Math.max(1, Math.ceil(years.length / 10));

  const choose = (target: Body, w: TransferWindow) => {
    t.select({ targetId: target.id, transfer: w.best });
    const s = useMapStore.getState();
    if (!s.paused) s.togglePause();
    setUt(w.best.departure);
  };

  return (
    <div className="tt-body">
      <div className="tt-labels">
        <div className="tt-axis-spacer" />
        {targets.map((b) => (
          <div key={b.id} className="tt-label">
            <span className="dot" style={{ background: b.data.style.color }} />
            {b.name}
            <button
              className="tt-porkchop"
              title={`Porkchop plot ${origin.name} → ${b.name}`}
              aria-label={`Porkchop plot ${origin.name} to ${b.name}`}
              onClick={() => t.openPorkchop(b.id)}
            >
              ▦
            </button>
          </div>
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
          {years.map((y, i) =>
            i % yearStep === 0 ? (
              <span key={y} className="tt-year" style={{ left: `${pct(y)}%` }}>
                Y{Math.round(y / yearLength) + 1}
              </span>
            ) : null,
          )}
        </div>
        {years.map((y) => (
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

function fmtKm(m: number) {
  return `${Math.round(m / 1000)} km`;
}

/** Parking orbit altitude at the origin, in km. Empty = the body's low orbit from the Δv map. */
function AltitudeInput({ origin }: { origin: Body }) {
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
