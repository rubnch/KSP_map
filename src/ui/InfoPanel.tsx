import { useState } from 'react';
import { formatDistance, formatDuration, synodicPeriod, type Body } from '../core/index.ts';
import { useMapStore } from '../state/store.ts';

const G0 = 9.80665;

/** Facts about the focused body. */
export function InfoPanel() {
  const system = useMapStore((s) => s.system);
  const focusId = useMapStore((s) => s.focusId);
  const body = system.get(focusId);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 720);
  const cal = system.pack.calendar;
  const p = body.data.physical;
  const o = body.orbit;
  const surfaceGravity = body.mu / (body.radius * body.radius);
  const escape = Math.sqrt((2 * body.mu) / body.radius);
  const home = system.home;
  const synodic =
    o && home.orbit && body !== home && body.parent === home.parent ? synodicPeriod(o.period, home.orbit.period) : null;

  const rows: [string, string][] = [
    ['Radius', formatDistance(body.radius)],
    ['Surface gravity', `${surfaceGravity.toFixed(2)} m/s² (${(surfaceGravity / G0).toFixed(3)} g)`],
    ['Escape velocity', `${Math.round(escape).toLocaleString('en-US')} m/s`],
    ['Rotation', `${formatDuration(p.rotationPeriod, cal)}${p.tidallyLocked ? ' (tidally locked)' : ''}`],
  ];
  if (Number.isFinite(body.soi)) rows.push(['Sphere of influence', formatDistance(body.soi)]);
  if (p.atmosphere) {
    const extra = [
      p.atmosphere.seaLevelPressure !== undefined ? `${p.atmosphere.seaLevelPressure} kPa` : null,
      p.atmosphere.hasOxygen ? 'oxygen' : null,
    ].filter(Boolean);
    rows.push(['Atmosphere', `${formatDistance(p.atmosphere.height)}${extra.length ? ` (${extra.join(', ')})` : ''}`]);
  }
  if (o && body.parent) {
    rows.push(
      ['Semi-major axis', formatDistance(o.a)],
      ['Apoapsis', formatDistance(o.apoapsis - body.parent.radius)],
      ['Periapsis', formatDistance(o.periapsis - body.parent.radius)],
      ['Eccentricity', o.e.toFixed(3)],
      ['Inclination', `${body.data.orbit!.inclination}°`],
      ['Orbital period', formatDuration(o.period, cal)],
    );
    if (synodic) rows.push([`Synodic period (${home.name})`, formatDuration(synodic, cal)]);
  }

  return (
    <aside className="panel info-panel" aria-label={`${body.name} details`}>
      <header onClick={() => setOpen(!open)} aria-expanded={open} role="button" tabIndex={0}>
        <span className="dot" style={{ background: body.data.style.color }} />
        <h2>{body.name}</h2>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        <span className="kind">{kindLabel(body)}</span>
      </header>
      {open && (
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}

function kindLabel(b: Body): string {
  const kind = { star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', moon: 'Moon' }[b.data.kind];
  return b.parent ? `${kind} of ${b.parent.name}` : kind;
}
