import type { Body, Vec3 } from '../core/index.ts';

export interface OrbitMarker {
  key: 'ap' | 'pe' | 'an' | 'dn';
  kind: 'ap' | 'pe' | 'an' | 'dn';
  label: string;
  /** Altitude above the parent's surface, metres (apsides only). */
  altitude?: number;
  /** Position relative to the parent, metres. */
  position: Vec3;
}

/** Apsides (if the orbit is not circular) and nodes against the parent's reference plane (if inclined). */
export function orbitMarkers(body: Body): OrbitMarker[] {
  const o = body.orbit;
  const parent = body.parent;
  if (!o || !parent) return [];
  const out: OrbitMarker[] = [];
  if (o.e > 1e-3) {
    out.push({
      key: 'pe',
      kind: 'pe',
      label: 'Pe',
      altitude: o.periapsis - parent.radius,
      position: o.positionAtTrueAnomaly(0),
    });
    out.push({
      key: 'ap',
      kind: 'ap',
      label: 'Ap',
      altitude: o.apoapsis - parent.radius,
      position: o.positionAtTrueAnomaly(Math.PI),
    });
  }
  if (o.i > 1e-4) {
    out.push({ key: 'an', kind: 'an', label: 'AN', position: o.positionAtTrueAnomaly(-o.argPe) });
    out.push({ key: 'dn', kind: 'dn', label: 'DN', position: o.positionAtTrueAnomaly(Math.PI - o.argPe) });
  }
  return out;
}
