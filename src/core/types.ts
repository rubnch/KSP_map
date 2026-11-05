/**
 * Unified system pack format. Mirrors data/schema/system.schema.json.
 * Units: metres, seconds, m^3/s^2. All angles are in degrees.
 */

export type BodyKind = 'star' | 'planet' | 'dwarf' | 'moon';

export interface OrbitalElements {
  semiMajorAxis: number;
  eccentricity: number;
  inclination: number;
  longitudeOfAscendingNode: number;
  argumentOfPeriapsis: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
}

export interface Atmosphere {
  height: number;
  hasOxygen?: boolean;
  seaLevelPressure?: number;
}

export interface PhysicalProperties {
  radius: number;
  gravParameter: number;
  rotationPeriod: number;
  tidallyLocked?: boolean;
  initialRotation?: number;
  soi?: number;
  atmosphere?: Atmosphere;
}

export interface BodyStyle {
  color: string;
  orbitColor?: string;
}

/** Optional hints for the delta-v map; anything missing is derived from the physical data. */
export interface DeltaVHints {
  /** Low orbit altitude above the surface, metres. */
  lowOrbitAltitude?: number;
  /** Surface → low orbit, m/s (community value). */
  ascent?: number;
  /** False for gas giants. Defaults to true for everything but stars. */
  hasSurface?: boolean;
}

export interface BodyData {
  id: string;
  name: string;
  parent: string | null;
  kind: BodyKind;
  physical: PhysicalProperties;
  orbit?: OrbitalElements;
  style: BodyStyle;
  deltaV?: DeltaVHints;
}

export interface SystemPack {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  name: string;
  source: { mod: string; version: string; url?: string; license?: string; notes?: string };
  extends?: string;
  calendar: { dayLength: number; yearLength: number };
  rootBody: string;
  homeBody: string;
  bodies: BodyData[];
}
