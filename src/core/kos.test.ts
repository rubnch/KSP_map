/**
 * Optional check of a pack against a kOS dump from the real game (tools/kos/dump-bodies.ks).
 * Skipped unless KOS_DUMP points at the dump file. PACK picks the pack (default: stock).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PlanetarySystem } from './system.ts';
import type { SystemPack } from './types.ts';

const dumpPath = process.env.KOS_DUMP;
const packId = process.env.PACK ?? 'stock';

interface KosEntry {
  radius: number;
  mu: number;
  rotationPeriod: number;
  atmosphereHeight?: number;
  parent?: string;
  soi?: number;
  semiMajorAxis?: number;
  eccentricity?: number;
  inclination?: number;
  longitudeOfAscendingNode?: number;
  argumentOfPeriapsis?: number;
  meanAnomalyAtEpoch?: number;
  epoch?: number;
  period?: number;
}

// kOS WRITEJSON wraps values in typed objects; unwrap to plain numbers/strings.
function unwrap(v: unknown): unknown {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('value' in o && Object.keys(o).every((k) => k === 'value' || k === '$type')) return unwrap(o.value);
    if (Array.isArray(o.entries)) {
      const entries = o.entries as unknown[];
      const out: Record<string, unknown> = {};
      for (let i = 0; i + 1 < entries.length; i += 2) out[String(unwrap(entries[i]))] = unwrap(entries[i + 1]);
      return out;
    }
  }
  return v;
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
const angleDiff = (a: number, b: number) => {
  const d = (((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
};

describe.skipIf(!dumpPath)('pack matches kOS dump', () => {
  if (!dumpPath) return; // describe bodies still run during collection when skipped
  const pack = JSON.parse(readFileSync(join(__dirname, `../../data/packs/${packId}.json`), 'utf8')) as SystemPack;
  const system = new PlanetarySystem(pack);
  const dump = unwrap(JSON.parse(readFileSync(dumpPath, 'utf8'))) as Record<string, KosEntry>;

  it.each(system.bodies.map((b) => b.id))('%s', (id) => {
    const body = system.get(id);
    const k = dump[body.name];
    expect(k, `${body.name} missing from dump`).toBeDefined();
    if (!k) return;
    expect(rel(body.radius, k.radius)).toBeLessThan(1e-6);
    expect(rel(body.mu, k.mu)).toBeLessThan(1e-6);
    expect(rel(body.data.physical.rotationPeriod, k.rotationPeriod)).toBeLessThan(1e-4);
    if (k.atmosphereHeight) expect(body.data.physical.atmosphere?.height).toBeCloseTo(k.atmosphereHeight, 0);
    const o = body.data.orbit;
    if (!o || k.semiMajorAxis === undefined) return;
    expect(body.parent?.name).toBe(k.parent);
    expect(rel(o.semiMajorAxis, k.semiMajorAxis)).toBeLessThan(1e-6);
    expect(o.eccentricity).toBeCloseTo(k.eccentricity!, 6);
    expect(angleDiff(o.inclination, k.inclination!)).toBeLessThan(1e-4);
    if (o.inclination > 0)
      expect(angleDiff(o.longitudeOfAscendingNode, k.longitudeOfAscendingNode!)).toBeLessThan(1e-3);
    if (o.eccentricity > 0) expect(angleDiff(o.argumentOfPeriapsis, k.argumentOfPeriapsis!)).toBeLessThan(1e-3);
    // Compare mean anomaly at a common UT, since the epochs may differ.
    const ut = dump.ut as unknown as number;
    const ours = (body.orbit!.meanAnomalyAt(ut) * 180) / Math.PI;
    const theirs = k.meanAnomalyAtEpoch! + (360 / k.period!) * (ut - k.epoch!);
    expect(angleDiff(ours, theirs)).toBeLessThan(0.01);
    expect(rel(body.soi, k.soi!)).toBeLessThan(1e-3);
  });
});
