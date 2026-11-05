import { formatDuration, formatUt, type Body } from '../core/index.ts';
import { useMapStore } from '../state/store.ts';
import { problemFor, useTransferStore } from './store.ts';

const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v).toLocaleString('en-US')} m/s` : '-');
const deg = (v: number, digits = 1) => (Number.isFinite(v) ? `${v.toFixed(digits)}°` : '-');

/** The selected transfer: dates, Δv split, and the angles to fly it by hand. */
export function TransferDetails({ origin }: { origin: Body }) {
  const system = useMapStore((s) => s.system);
  const setUt = useMapStore((s) => s.setUt);
  const cal = system.pack.calendar;
  const { selected, mode, capture, initialAltitude, select, openPorkchop } = useTransferStore();
  if (!selected) return null;
  const target = system.find(selected.targetId);
  if (!target) return null;
  const tr = selected.transfer;
  const problem = problemFor(origin, target, { mode, capture, initialAltitude });
  const ejectFrom = tr.ejectionAngle;
  // Outward transfers are usually given from prograde, inward ones from retrograde.
  const outward = target.orbit!.a > origin.orbit!.a;
  const ejectionText = outward
    ? `${deg(ejectFrom)} to prograde`
    : `${deg((((ejectFrom - 180) % 360) + 360) % 360)} to retrograde`;

  return (
    <div className="tt-details">
      <div className="tt-details-head">
        <span className="dot" style={{ background: origin.data.style.color }} /> {origin.name} →{' '}
        <span className="dot" style={{ background: target.data.style.color }} /> {target.name}
        <strong className="tt-total">{ms(tr.dv)}</strong>
        <button onClick={() => openPorkchop(target.id)}>Porkchop plot</button>
        <button onClick={() => select(null)} aria-label="Clear transfer">
          ✕
        </button>
      </div>
      <div className="tt-details-grid">
        <dl>
          <Row k="Depart">
            <button className="tt-link" onClick={() => setUt(tr.departure)} title="Set the clock to the departure">
              {formatUt(tr.departure, cal)}
            </button>
          </Row>
          <Row k="Arrive">
            <button className="tt-link" onClick={() => setUt(tr.arrival)} title="Set the clock to the arrival">
              {formatUt(tr.arrival, cal)}
            </button>
          </Row>
          <Row k="Flight time">{formatDuration(tr.timeOfFlight, cal)}</Row>
          <Row k="Transfer angle">{deg(tr.transferAngle)}</Row>
        </dl>
        <dl>
          <Row k="Ejection burn">{ms(tr.ejectionDv)}</Row>
          <Row k="Plane change">
            {tr.planeChange ? (
              <button
                className="tt-link"
                onClick={() => setUt(tr.planeChange!.time)}
                title={`Turn the orbit plane by ${Math.abs(tr.planeChange.angle).toFixed(2)}° on ${formatUt(tr.planeChange.time, cal)}`}
              >
                {ms(tr.planeChangeDv)}
              </button>
            ) : (
              'none'
            )}
          </Row>
          <Row k="Capture burn">{capture ? ms(tr.captureDv) : 'none'}</Row>
          <Row k="v∞ out / in">
            {ms(tr.ejectionVinf)} / {ms(tr.arrivalVinf)}
          </Row>
        </dl>
        <dl>
          <Row k="Phase angle" title={`How far ${target.name} is ahead of ${origin.name} at departure. The Hohmann ideal assumes circular, flat orbits.`}>
            {deg(tr.phaseAngle)} <small>(Hohmann {deg(problem.idealPhaseAngle)})</small>
          </Row>
          <Row k="Ejection angle" title="Where to burn on the parking orbit: how far your ship still has to travel, going round its orbit, before it passes the planet's prograde (or retrograde) direction.">
            {ejectionText}
          </Row>
          <Row k="Ejection inclination">{deg(tr.ejectionInclination, 2)}</Row>
          <Row k="Synodic period">{formatDuration(problem.synodicPeriod, cal)}</Row>
        </dl>
      </div>
    </div>
  );
}

function Row(props: { k: string; title?: string; children: React.ReactNode }) {
  return (
    <div title={props.title}>
      <dt>{props.k}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}
