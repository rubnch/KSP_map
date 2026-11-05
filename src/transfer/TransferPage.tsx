import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatUt } from '../core/index.ts';
import { cameraRequest } from '../map/MapView.tsx';
import { useMapStore } from '../state/store.ts';
import { PorkchopPanel } from './PorkchopPanel.tsx';
import { originCandidates, problemFor, settingsFor, targetsOf, useTransferStore, type TransferOptions } from './store.ts';
import { SystemDiagram } from './SystemDiagram.tsx';
import { AltitudeInput, fmtKm, SPANS, Track, useWindows } from './Timeline.tsx';
import { TransferDetails } from './TransferDetails.tsx';
import './transfer.css';

/**
 * Entry point on the map: a button that opens the transfer planner, or, while a transfer is
 * drawn on the map, a strip naming it with buttons to jump along it.
 */
export function TransferLauncher() {
  const open = useTransferStore((s) => s.open);
  const selected = useTransferStore((s) => s.selected);
  const { setOpen, select } = useTransferStore.getState();
  const system = useMapStore((s) => s.system);
  const cal = system.pack.calendar;
  const setUt = useMapStore((s) => s.setUt);

  return (
    <>
      {selected ? (
        <div className="panel tp-onmap">
          <span>
            Transfer to <strong>{system.get(selected.targetId).name}</strong> ·{' '}
            {Math.round(selected.transfer.dv).toLocaleString('en-US')} m/s
          </span>
          <button onClick={() => setUt(selected.transfer.departure)} title={formatUt(selected.transfer.departure, cal)}>
            Departure
          </button>
          <button onClick={() => setUt(selected.transfer.arrival)} title={formatUt(selected.transfer.arrival, cal)}>
            Arrival
          </button>
          <button className="primary" onClick={() => setOpen(true)}>
            Transfer planner
          </button>
          <button onClick={() => select(null)} aria-label="Remove the transfer from the map" title="Remove from the map">
            ✕
          </button>
        </div>
      ) : (
        <button className="panel transfer-open" onClick={() => setOpen(true)} title="Transfer windows and porkchop plots">
          Transfer planner
        </button>
      )}
      {open && createPortal(<TransferPage />, document.body)}
    </>
  );
}

/** The planner page: timeline, porkchop plot, a 2D diagram of the transfer and its details. */
function TransferPage() {
  const system = useMapStore((s) => s.system);
  const ut = useMapStore((s) => s.ut);
  const t = useTransferStore();
  const origin = system.find(t.originId ?? '') ?? system.home;
  const targets = useMemo(() => targetsOf(origin), [origin]);
  const year = system.pack.calendar.yearLength;

  // The page is for planning: stop the clock while it is open.
  useEffect(() => {
    const s = useMapStore.getState();
    if (!s.paused) s.togglePause();
  }, []);

  // Close with Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useTransferStore.getState().setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fixed range that only moves with ◀ Now ▶ (never follows the clock).
  const [rangeStart, setRangeStart] = useState(() => Math.floor(ut / year) * year);
  const rangeEnd = rangeStart + t.spanYears * year;
  const page = (dir: 1 | -1) => setRangeStart((s) => Math.max(0, s + dir * Math.max(1, t.spanYears / 2) * year));
  const clockOutside = ut < rangeStart || ut > rangeEnd;

  const options: TransferOptions = { mode: t.mode, capture: t.capture, initialAltitude: t.initialAltitude };
  const windows = useWindows(origin, targets, rangeStart, rangeEnd, options);

  const selectedTarget = t.selected ? system.find(t.selected.targetId) ?? null : null;

  // Same departure and flight time, re-solved when the settings change.
  useEffect(() => {
    const sel = useTransferStore.getState().selected;
    if (!sel) return;
    const target = system.find(sel.targetId);
    if (!target || target.parent !== origin.parent) return;
    const tr = problemFor(origin, target, options).transfer(sel.transfer.departure, sel.transfer.timeOfFlight);
    useTransferStore.getState().select(tr && Number.isFinite(tr.dv) ? { targetId: target.id, transfer: tr } : null);
  }, [t.mode, t.capture, t.initialAltitude]);
  const porkchopTarget =
    (t.porkchopTargetId && targets.find((b) => b.id === t.porkchopTargetId)) || selectedTarget || targets[0] || null;

  const showOnMap = () => {
    if (!t.selected) return;
    const s = useMapStore.getState();
    s.setFocus(origin.parent!.id);
    s.setViewMode('2d');
    // Frame both orbits (vertical field of view is 50°, so half the height is 0.47 × distance).
    const target = system.get(t.selected.targetId);
    cameraRequest.distance = (Math.max(origin.orbit!.apoapsis, target.orbit!.apoapsis) / Math.tan((25 * Math.PI) / 180)) * 1.15;
    s.setUt(t.selected.transfer.departure);
    if (!s.paused) s.togglePause();
    t.setOpen(false);
  };

  return (
    <div className="tp-page" role="dialog" aria-label="Transfer planner">
      <header className="tp-header">
        <strong className="tp-title">Transfer planner</strong>
        <label>
          From
          <select value={origin.id} onChange={(e) => t.setOrigin(e.target.value)}>
            {originCandidates(system).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <AltitudeInput origin={origin} />
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
        <label title="Include the burn into the target's low orbit. Off: flyby or aerobraking.">
          <input type="checkbox" checked={t.capture} onChange={(e) => t.setCapture(e.target.checked)} /> Capture burn
        </label>
        <button className="tp-back" onClick={() => t.setOpen(false)}>
          Back to map
        </button>
      </header>

      <main className="tp-main">
        <section className="tp-card tp-timeline">
          <div className="tp-card-head">
            <h2>Windows from {origin.name}</h2>
            <div className="tt-seg" role="group" aria-label="Years shown">
              {SPANS.map((y) => (
                <button key={y} className={t.spanYears === y ? 'on' : ''} onClick={() => t.setSpanYears(y)}>
                  {y} years
                </button>
              ))}
            </div>
            <div className="tt-seg" role="group" aria-label="Move the timeline">
              <button onClick={() => page(-1)} disabled={rangeStart === 0} aria-label="Earlier">
                ◀
              </button>
              <button className={clockOutside ? 'on' : ''} onClick={() => setRangeStart(Math.floor(ut / year) * year)}>
                Now
              </button>
              <button onClick={() => page(1)} aria-label="Later">
                ▶
              </button>
            </div>
          </div>
          <Track
            origin={origin}
            targets={targets}
            windows={windows}
            from={rangeStart}
            to={rangeEnd}
            ut={ut}
            yearLength={year}
            porkchopId={porkchopTarget?.id ?? null}
          />
          <p className="tt-note">
            Click a window to select it, or a planet's name for its porkchop plot. Bars span the departure dates within 10%
            of the best Δv; the brightest diamond is the cheapest window shown. Drag along the timeline to move the clock.
            Δv from {fmtKm(settingsFor(origin, origin, options).initialAltitude)} above {origin.name}
            {t.capture ? ", with capture into the target's low orbit (as on the Δv map)." : ', no capture burn.'}
          </p>
        </section>

        <section className="tp-card tp-porkchop">
          {porkchopTarget ? <PorkchopPanel origin={origin} target={porkchopTarget} /> : <p>No other body orbits here.</p>}
        </section>

        <section className="tp-card tp-side">
          <SystemDiagram
            origin={origin}
            targets={targets}
            target={selectedTarget}
            transfer={t.selected?.transfer ?? null}
            ut={ut}
          />
          {t.selected ? (
            <>
              <button className="tp-show" onClick={showOnMap}>
                Show on map
              </button>
              <TransferDetails origin={origin} />
            </>
          ) : (
            <p className="tp-hint">Pick a window on the timeline, or a point on the porkchop plot, to see the transfer here.</p>
          )}
        </section>
      </main>
    </div>
  );
}
