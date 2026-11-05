import type React from 'react';
import type { DvNode } from './graph.ts';
import { nodeLabel } from './graph.ts';
import { lowOrbitRadius, syncOrbitRadius } from './physics.ts';

const SIZE = 150;
const C = SIZE / 2;
/** Drawn radius of the body. */
const R0 = 16;
/** Drawn radius of the sphere of influence. */
const RS = 68;

const km = (m: number) => `${Math.round(m / 1000).toLocaleString('en-US')} km`;

/**
 * A sketch of the orbit a node stands for, around its body: the body, its atmosphere, the sphere
 * of influence, and the orbit itself. Altitudes are squeezed so a low orbit and the SOI edge
 * both fit: the shapes are right, the sizes are not.
 */
export function OrbitCard({ node, x, y }: { node: DvNode; x: number; y: number }) {
  const b = node.body;
  const R = b.radius;
  const soi = b.soi;
  // Body surface → R0, anything above it at least a few pixels out, SOI edge → RS; altitudes
  // squeezed by a power law in between.
  const s = (r: number) => (r <= R ? R0 : R0 + 5 + (RS - R0 - 5) * ((r - R) / (soi - R)) ** 0.35);
  const color = b.data.style.color;
  const atm = b.data.physical.atmosphere;
  const low = lowOrbitRadius(b);
  const sync = syncOrbitRadius(b);

  // An orbit from periapsis rp to apoapsis ra, periapsis on the left of the body.
  const ellipse = (rp: number, ra: number, cls = 'orbit') => {
    const p = s(rp);
    const a = s(ra);
    const semi = (p + a) / 2;
    const minor = Math.sqrt(p * a);
    return <ellipse className={cls} cx={C - p + semi} cy={C} rx={semi} ry={minor} />;
  };
  const circle = (r: number, cls = 'orbit') => <circle className={cls} cx={C} cy={C} r={s(r)} />;
  const pe = (r: number) => <circle className="mark" cx={C - s(r)} cy={C} r={2.5} />;

  let shape: React.ReactNode;
  let text: string;
  switch (node.kind) {
    case 'surface':
      shape = <circle className="mark" cx={C} cy={C - R0} r={3} />;
      text = 'On the ground';
      break;
    case 'low':
      shape = circle(low);
      text = `Circular, ${km(low - R)}`;
      break;
    case 'sync':
      shape = (
        <>
          {circle(low, 'ghost')}
          {circle(sync!)}
        </>
      );
      text = `Circular, ${km(sync! - R)}: turns with ${b.name}`;
      break;
    case 'syncTransfer':
      shape = (
        <>
          {circle(low, 'ghost')}
          {circle(sync!, 'ghost')}
          {ellipse(low, sync!)}
          {pe(low)}
        </>
      );
      text = `Periapsis ${km(low - R)}, apoapsis ${km(sync! - R)}`;
      break;
    case 'capture':
      shape = (
        <>
          {circle(low, 'ghost')}
          {ellipse(low, soi * 0.98)}
          {pe(low)}
        </>
      );
      text = `Periapsis ${km(low - R)}, apoapsis at the SOI edge`;
      break;
    case 'syncCapture':
      shape = (
        <>
          {circle(sync!, 'ghost')}
          {ellipse(sync!, soi * 0.98)}
          {pe(sync!)}
        </>
      );
      text = `Periapsis ${km(sync! - R)}, apoapsis at the SOI edge`;
      break;
    case 'intercept': {
      // A pass through the SOI, closest at the low orbit.
      const p = s(low);
      shape = (
        <>
          {circle(low, 'ghost')}
          <path
            className="orbit"
            d={`M${C + RS},${C - RS * 0.75} Q${C - 2 * p - RS},${C} ${C + RS},${C + RS * 0.75}`}
          />
          <circle className="mark" cx={C - p} cy={C} r={2.5} />
        </>
      );
      text = `Entering the SOI from ${node.from!.name}`;
      break;
    }
  }

  return (
    <div className="panel dv-orbit-card" style={{ left: x, top: y }}>
      <strong>{nodeLabel(node)}</strong>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        <circle className="soi" cx={C} cy={C} r={RS} />
        {atm && <circle className="atm" cx={C} cy={C} r={s(R + atm.height)} style={{ fill: color }} />}
        <circle cx={C} cy={C} r={R0} style={{ fill: color }} />
        {shape}
      </svg>
      <span>{text}</span>
    </div>
  );
}
