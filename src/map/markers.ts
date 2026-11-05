import type { Body, Vec3 } from '../core/index.ts';

export type MarkerKind = 'ap' | 'pe' | 'an' | 'dn';

export interface OrbitMarker {
  /** Unique across all markers on screen, e.g. `Duna-ap`. */
  key: string;
  kind: MarkerKind;
  label: string;
  /** The body whose orbit this marker sits on. */
  body: Body;
  /** Altitude above the parent's surface, metres (apsides only). */
  altitude?: number;
  /** Signed relative inclination, e.g. `+7.0°` (nodes only). */
  angle?: string;
  /** Position relative to the body's parent, metres. */
  position: Vec3;
  /** A node that falls on (or next to) this apsis, shown in the same label instead of on its own. */
  node?: { kind: 'an' | 'dn'; label: string; angle: string };
}

/** A node within this angle of an apsis is merged into the apsis' label. */
const MERGE_ANGLE = 12 * (Math.PI / 180);

/** Smallest angle between two angles, radians. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
}

/**
 * Apsides and, if the orbit is inclined, the ascending and descending nodes. Apsides are shown
 * even for a perfectly circular orbit (Kerbin, Mun): they then sit where the orbit's elements put
 * them and have the same altitude. Nodes are where the orbit crosses the system's reference plane
 * (z = 0), the plane the pack's inclination and longitude of the ascending node are measured from.
 * In stock KSP that is Kerbol's equator, which is also Kerbin's orbital plane and every body's equator.
 */
export function orbitMarkers(body: Body): OrbitMarker[] {
  const o = body.orbit;
  const parent = body.parent;
  if (!o || !parent) return [];
  const marker = (kind: MarkerKind, label: string, position: Vec3, altitude?: number): OrbitMarker => ({
    key: `${body.id}-${kind}`,
    kind,
    label,
    body,
    altitude,
    position,
  });
  const pe = marker('pe', 'Pe', o.positionAtTrueAnomaly(0), o.periapsis - parent.radius);
  const ap = marker('ap', 'Ap', o.positionAtTrueAnomaly(Math.PI), o.apoapsis - parent.radius);
  const out = [pe, ap];
  if (o.i > 1e-4) {
    // Like the game: the relative inclination, positive at the ascending node, negative at the descending one.
    const deg = o.i * (180 / Math.PI);
    const angle = deg.toFixed(deg < 1 ? 2 : 1);
    const nodes = [
      { kind: 'an' as const, label: 'AN', angle: `+${angle}°`, nu: -o.argPe },
      { kind: 'dn' as const, label: 'DN', angle: `\u2212${angle}°`, nu: Math.PI - o.argPe },
    ];
    for (const n of nodes) {
      // Many orbits have their periapsis at a node (argument of periapsis 0° or 180°): one label.
      const apsis = angleBetween(n.nu, 0) < MERGE_ANGLE ? pe : angleBetween(n.nu, Math.PI) < MERGE_ANGLE ? ap : null;
      if (apsis) apsis.node = { kind: n.kind, label: n.label, angle: n.angle };
      else out.push({ ...marker(n.kind, n.label, o.positionAtTrueAnomaly(n.nu)), angle: n.angle });
    }
  }
  return out;
}
