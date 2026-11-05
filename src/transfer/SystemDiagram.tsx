import { useMemo } from 'react';
import type { Body, Vec3 } from '../core/index.ts';
import { propagate } from './conics.ts';
import type { Transfer } from './transfer.ts';

const SIZE = 400;
const DEG = 180 / Math.PI;

/**
 * Top-down view of the origin's parent: the orbits, where the bodies are, and the selected
 * transfer with its phase angle. Same orientation as the map's 2D view (x right, y up).
 */
export function SystemDiagram(props: { origin: Body; targets: Body[]; target: Body | null; transfer: Transfer | null; ut: number }) {
  const { origin, targets, target, transfer, ut } = props;
  const parent = origin.parent!;
  const shown = target ? [origin, target] : [origin, ...targets];
  const extent = Math.max(...shown.map((b) => b.orbit!.apoapsis)) * 1.12;
  const k = SIZE / 2 / extent;
  const xy = (p: Vec3): [number, number] => [SIZE / 2 + p[0] * k, SIZE / 2 - p[1] * k];
  const pts = (list: Vec3[]) => list.map((p) => xy(p).map((v) => v.toFixed(1)).join(',')).join(' ');

  const orbitPaths = useMemo(
    () => new Map([origin, ...targets].map((b) => [b.id, b.orbit!.points(128)] as const)),
    [origin, targets],
  );

  const arc = useMemo(() => {
    if (!transfer) return null;
    const mu = parent.mu;
    const pc = transfer.planeChange && transfer.afterPlaneChange ? transfer.planeChange.time - transfer.departure : Infinity;
    const at = (dt: number) =>
      dt < pc
        ? propagate(mu, transfer.start.position, transfer.start.velocity, dt).position
        : propagate(mu, transfer.afterPlaneChange!.position, transfer.afterPlaneChange!.velocity, dt - pc).position;
    const list: Vec3[] = [];
    for (let i = 0; i <= 160; i++) list.push(at((transfer.timeOfFlight * i) / 160));
    return { list, burn: Number.isFinite(pc) ? at(pc) : null };
  }, [transfer, parent]);

  // Dates the picture stands for: departure (and arrival) of the transfer, else the clock.
  const t0 = transfer ? transfer.departure : ut;
  const originAt = origin.orbit!.positionAt(t0);
  const phase = transfer && target ? phaseWedge(originAt, target.orbit!.positionAt(t0), transfer.phaseAngle) : null;

  return (
    <svg className="tp-diagram" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Orbits around ${parent.name}`}>
      <circle cx={SIZE / 2} cy={SIZE / 2} r={Math.max(3, parent.radius * k)} fill={parent.data.style.color} />
      {[origin, ...targets].map((b) => {
        const strong = b === origin || b === target;
        if (target && !strong) return null;
        return (
          <polyline
            key={b.id}
            points={pts(orbitPaths.get(b.id)!)}
            fill="none"
            stroke={b.data.style.orbitColor ?? b.data.style.color}
            strokeOpacity={strong ? 0.85 : 0.35}
            strokeWidth={strong ? 1.5 : 1}
          />
        );
      })}

      {/* Light lines from the parent to each body at the departure date: the phase angle sits between them. */}
      {(target ? [origin, target] : [origin, ...targets]).map((b) => {
        const [x, y] = xy(b.orbit!.positionAt(t0));
        return (
          <line
            key={`ray-${b.id}`}
            className="tp-ray"
            x1={SIZE / 2}
            y1={SIZE / 2}
            x2={x}
            y2={y}
            stroke={b.data.style.color}
          />
        );
      })}

      {phase && (
        <g className="tp-phase">
          <path d={wedgePath(phase.from, phase.to, phase.r * k)} />
          <text x={SIZE / 2 + phase.label[0] * k} y={SIZE / 2 - phase.label[1] * k}>
            {transfer!.phaseAngle.toFixed(1)}°
          </text>
        </g>
      )}

      {arc && <polyline points={pts(arc.list)} fill="none" stroke="#6fd36f" strokeWidth={2} />}
      {arc?.burn && <Marker at={xy(arc.burn)} label="plane change" />}

      {(target ? [origin, target] : [origin, ...targets]).map((b) => {
        const atDep = xy(b.orbit!.positionAt(t0));
        const isTarget = b === target && transfer;
        return (
          <g key={b.id}>
            {isTarget && (
              <circle cx={atDep[0]} cy={atDep[1]} r={4} fill="none" stroke={b.data.style.color} strokeOpacity={0.6} />
            )}
            <Body at={isTarget ? xy(b.orbit!.positionAt(transfer!.arrival)) : atDep} body={b} />
          </g>
        );
      })}
    </svg>
  );

  function wedgePath(from: number, to: number, r: number) {
    const c = SIZE / 2;
    const p1 = [c + r * Math.cos(from), c - r * Math.sin(from)];
    const p2 = [c + r * Math.cos(to), c - r * Math.sin(to)];
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    const sweep = to > from ? 0 : 1;
    return `M${c},${c} L${p1[0]},${p1[1]} A${r},${r} 0 ${large} ${sweep} ${p2[0]},${p2[1]} Z`;
  }
}

/** Wedge from the origin's direction, turning by the phase angle (towards the target). */
function phaseWedge(o: Vec3, t: Vec3, phaseDeg: number) {
  const from = Math.atan2(o[1], o[0]);
  const to = from + phaseDeg / DEG;
  const mid = (from + to) / 2;
  // Well inside both bodies, so the rays to them stay visible beyond the wedge.
  const r = Math.min(Math.hypot(o[0], o[1]), Math.hypot(t[0], t[1])) * 0.3;
  const lr = r * 1.45;
  return { from, to, r, label: [lr * Math.cos(mid), lr * Math.sin(mid)] as [number, number] };
}

function Body({ at, body }: { at: [number, number]; body: Body }) {
  return (
    <g>
      <circle cx={at[0]} cy={at[1]} r={5} fill={body.data.style.color} stroke="#05070d" strokeWidth={1.5} />
      {/* Labels point away from the centre so they stay inside the picture. */}
      <text
        className="tp-body-label"
        x={at[0] + (at[0] > SIZE / 2 ? -8 : 8)}
        y={at[1] + (at[1] > SIZE / 2 ? 16 : -8)}
        textAnchor={at[0] > SIZE / 2 ? 'end' : 'start'}
      >
        {body.name}
      </text>
    </g>
  );
}

function Marker({ at, label }: { at: [number, number]; label: string }) {
  return (
    <g>
      <rect x={at[0] - 4} y={at[1] - 4} width={8} height={8} transform={`rotate(45 ${at[0]} ${at[1]})`} fill="#ffb35c" />
      <text
        className="tp-body-label"
        x={at[0] + (at[0] > SIZE / 2 ? -8 : 8)}
        y={at[1] + (at[1] > SIZE / 2 ? 16 : -8)}
        textAnchor={at[0] > SIZE / 2 ? 'end' : 'start'}
      >
        {label}
      </text>
    </g>
  );
}
