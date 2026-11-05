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
  /** Position relative to the body's parent, metres. */
  position: Vec3;
}

/**
 * Apsides (if the orbit is not circular) and, unless `apsidesOnly`, the ascending and descending
 * nodes. Nodes are where the orbit crosses the system's reference plane (z = 0), the plane the
 * pack's inclination and longitude of the ascending node are measured from. In stock KSP that is
 * Kerbol's equator, which is also Kerbin's orbital plane and every body's equator.
 */
export function orbitMarkers(body: Body, apsidesOnly = false): OrbitMarker[] {
  const o = body.orbit;
  const parent = body.parent;
  if (!o || !parent) return [];
  const out: OrbitMarker[] = [];
  const marker = (kind: MarkerKind, label: string, position: Vec3, altitude?: number): OrbitMarker => ({
    key: `${body.id}-${kind}`,
    kind,
    label,
    body,
    altitude,
    position,
  });
  if (o.e > 1e-3) {
    out.push(marker('pe', 'Pe', o.positionAtTrueAnomaly(0), o.periapsis - parent.radius));
    out.push(marker('ap', 'Ap', o.positionAtTrueAnomaly(Math.PI), o.apoapsis - parent.radius));
  }
  if (!apsidesOnly && o.i > 1e-4) {
    out.push(marker('an', 'AN', o.positionAtTrueAnomaly(-o.argPe)));
    out.push(marker('dn', 'DN', o.positionAtTrueAnomaly(Math.PI - o.argPe)));
  }
  return out;
}

/**
 * Markers to draw for a focus: the focused body's own orbit in full, plus the apsides of every
 * body orbiting it (the planets when looking at the Sun, the moons when looking at a planet).
 */
export function focusMarkers(focus: Body): OrbitMarker[] {
  return [...orbitMarkers(focus), ...focus.children.flatMap((c) => orbitMarkers(c, true))];
}
