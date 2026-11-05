/**
 * The delta-v graph of a planetary system.
 *
 * Every non-root body gets up to four kinds of node:
 *  - surface    (when it has one)
 *  - low        a low circular orbit, the body's hub
 *  - capture    a parabolic orbit with periapsis at the low orbit, i.e. the SOI edge with no excess speed
 *                (the "elliptical orbit" / escape node of community maps)
 *  - intercept  arriving on a transfer from a specific origin; one node per (target, origin) pair,
 *                because the arrival speed depends on where the transfer started
 *
 * Edges are directed. Splitting each Hohmann transfer into "eject" and "capture" halves around
 * the parabolic capture nodes keeps sums exact with the Oberth effect: low → capture → intercept
 * → capture → low adds up to the combined patched-conic burn.
 */
import type { Body, PlanetarySystem } from '../core/index.ts';
import {
  angleBetween,
  ascentCost,
  circularSpeed,
  deorbitBurn,
  escapeSpeed,
  excessBurn,
  hasAtmosphere,
  hasSurface,
  hohmannSpeeds,
  lowOrbitAltitude,
  lowOrbitRadius,
  planeChange,
  syncOrbitRadius,
  type AscentSource,
} from './physics.ts';

export type NodeKind = 'surface' | 'low' | 'sync' | 'capture' | 'intercept';

export interface DvNode {
  id: string;
  body: Body;
  kind: NodeKind;
  /** For intercept nodes: the body the transfer started from. */
  from?: Body;
}

export interface DvEdge {
  id: string;
  from: string;
  to: string;
  /** Cost without aerobraking, m/s. */
  dv: number;
  /** Cost when aerobraking is allowed; set only on edges that end inside an atmosphere's reach. */
  aeroDv?: number;
  /** Plane change covering the full inclination gap, burned at the transfer's slowest point, m/s. The real cost at AN/DN depends on the date; the transfer timeline computes it per window. */
  plane?: number;
  /** For two-burn transfers (low orbit ↔ synchronous orbit): the burns that make up dv. */
  burns?: [number, number];
  /** Where the number comes from, for ascent and landing edges. */
  source?: AscentSource;
}

export interface DvOptions {
  aerobrake: boolean;
  planeChanges: boolean;
}

export const nodeId = (body: Body, kind: NodeKind, from?: Body) =>
  kind === 'intercept' ? `${body.id}:intercept:${from!.id}` : `${body.id}:${kind}`;

export function edgeCost(e: DvEdge, o: DvOptions): number {
  const base = o.aerobrake && e.aeroDv !== undefined ? e.aeroDv : e.dv;
  return base + (o.planeChanges && e.plane ? e.plane : 0);
}

export class DvGraph {
  readonly system: PlanetarySystem;
  readonly nodes = new Map<string, DvNode>();
  readonly edges: DvEdge[] = [];
  readonly out = new Map<string, DvEdge[]>();

  constructor(system: PlanetarySystem, ascentOverrides: Record<string, number | undefined> = {}) {
    this.system = system;
    const bodies = system.bodies.filter((b) => b.parent);
    for (const b of bodies) {
      if (hasSurface(b)) this.addNode(b, 'surface');
      this.addNode(b, 'low');
      this.addNode(b, 'capture');
      if (syncOrbitRadius(b)) this.addNode(b, 'sync');
    }
    for (const b of bodies) this.addBodyEdges(b, ascentOverrides[b.id]);
    for (const p of system.bodies) {
      const kids = p.children;
      // Parent ↔ moon, for parents that have nodes themselves (not the root star).
      if (p.parent) for (const m of kids) this.addParentMoon(p, m);
      // Sibling ↔ sibling inside the parent's SOI.
      for (const x of kids) for (const y of kids) if (x !== y) this.addSiblings(p, x, y);
    }
  }

  node(id: string): DvNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown dv node ${id}`);
    return n;
  }

  edge(from: string, to: string): DvEdge | undefined {
    return this.out.get(from)?.find((e) => e.to === to);
  }

  private addNode(body: Body, kind: NodeKind, from?: Body): string {
    const id = nodeId(body, kind, from);
    if (!this.nodes.has(id)) this.nodes.set(id, { id, body, kind, from });
    return id;
  }

  private addEdge(e: Omit<DvEdge, 'id'>) {
    const edge = { ...e, id: `${e.from}->${e.to}` };
    this.edges.push(edge);
    const list = this.out.get(e.from) ?? [];
    list.push(edge);
    this.out.set(e.from, list);
  }

  private addBodyEdges(b: Body, override: number | undefined) {
    const atm = hasAtmosphere(b);
    const r = lowOrbitRadius(b);
    const low = nodeId(b, 'low');
    const cap = nodeId(b, 'capture');
    const escape = escapeSpeed(b.mu, r) - circularSpeed(b.mu, r);
    this.addEdge({ from: low, to: cap, dv: escape });
    this.addEdge({ from: cap, to: low, dv: escape, aeroDv: atm ? 0 : undefined });
    const rSync = syncOrbitRadius(b);
    if (rSync) {
      // Hohmann from the low orbit up to the synchronous orbit, and the escape from there.
      const sync = nodeId(b, 'sync');
      const { v1, v2 } = hohmannSpeeds(b.mu, r, rSync);
      const burns: [number, number] = [v1 - circularSpeed(b.mu, r), circularSpeed(b.mu, rSync) - v2];
      const up = burns[0] + burns[1];
      this.addEdge({ from: low, to: sync, dv: up, burns });
      this.addEdge({ from: sync, to: low, dv: up, burns: [burns[1], burns[0]] });
      const out = escapeSpeed(b.mu, rSync) - circularSpeed(b.mu, rSync);
      this.addEdge({ from: sync, to: cap, dv: out });
      // Down from a parabolic orbit: lower the apoapsis at low-orbit periapsis, then circularize.
      const down = escapeSpeed(b.mu, r) - v1 + burns[1];
      this.addEdge({ from: cap, to: sync, dv: down, burns: [escapeSpeed(b.mu, r) - v1, burns[1]] });
    }
    if (hasSurface(b)) {
      const surf = nodeId(b, 'surface');
      const ascent = ascentCost(b, override);
      this.addEdge({ from: surf, to: low, dv: ascent.value, source: ascent.source });
      this.addEdge({
        from: low,
        to: surf,
        dv: ascent.value,
        source: ascent.source,
        aeroDv: atm ? deorbitBurn(b) : undefined,
      });
    }
  }

  /** Transfers between a parent's low orbit and one of its moons. */
  private addParentMoon(p: Body, m: Body) {
    const rLow = lowOrbitRadius(p);
    const rMoon = m.orbit!.a;
    const { v1: vp, v2: va } = hohmannSpeeds(p.mu, rLow, rMoon);
    const vLow = circularSpeed(p.mu, rLow);
    const vEsc = escapeSpeed(p.mu, rLow);
    const vInf = Math.abs(circularSpeed(p.mu, rMoon) - va);
    const plane = planeChange(va, angleBetween(m.orbit!.normal, [0, 0, 1]));
    const pLow = nodeId(p, 'low');
    const pCap = nodeId(p, 'capture');

    // Outbound: parent → moon.
    const mInt = this.addNode(m, 'intercept', p);
    this.addEdge({ from: pLow, to: mInt, dv: vp - vLow, plane });
    this.addEdge({ from: pCap, to: mInt, dv: vEsc - vp, plane });
    this.addCapture(mInt, m, vInf);

    // Inbound: moon → parent. The arrival ellipse has its periapsis at the parent's low orbit.
    const pInt = this.addNode(p, 'intercept', m);
    this.addEdge({ from: nodeId(m, 'capture'), to: pInt, dv: excessBurn(m.mu, lowOrbitRadius(m), vInf), plane });
    this.addEdge({ from: pInt, to: pLow, dv: vp - vLow, aeroDv: hasAtmosphere(p) ? 0 : undefined });
    this.addEdge({ from: pInt, to: pCap, dv: vEsc - vp });
  }

  /** Transfer from sibling x to sibling y around their common parent p. */
  private addSiblings(p: Body, x: Body, y: Body) {
    const r1 = x.orbit!.a;
    const r2 = y.orbit!.a;
    const { v1, v2 } = hohmannSpeeds(p.mu, r1, r2);
    const vInfX = Math.abs(v1 - circularSpeed(p.mu, r1));
    const vInfY = Math.abs(v2 - circularSpeed(p.mu, r2));
    const plane = planeChange(Math.min(v1, v2), angleBetween(x.orbit!.normal, y.orbit!.normal));
    const yInt = this.addNode(y, 'intercept', x);
    this.addEdge({ from: nodeId(x, 'capture'), to: yInt, dv: excessBurn(x.mu, lowOrbitRadius(x), vInfX), plane });
    this.addCapture(yInt, y, vInfY);
  }

  private addCapture(intercept: string, body: Body, vInf: number) {
    this.addEdge({
      from: intercept,
      to: nodeId(body, 'capture'),
      dv: excessBurn(body.mu, lowOrbitRadius(body), vInf),
      aeroDv: hasAtmosphere(body) ? 0 : undefined,
    });
  }
}

export interface Route {
  nodes: string[];
  edges: DvEdge[];
  total: number;
}

/**
 * Bodies a trip between a and b may pass through: both, and their ancestors up to the common one.
 * Without this, the cheapest path would happily stop at an unrelated body's capture orbit to wait
 * for a better departure (Duna → Kerbin → Eve), which is valid but not what a map is for.
 */
export function hierarchyPath(g: DvGraph, a: Body, b: Body): Set<Body> {
  const up = (x: Body) => [x, ...g.system.ancestors(x)];
  const ua = up(a);
  const ub = up(b);
  const common = ua.find((x) => ub.includes(x))!;
  return new Set([...ua.slice(0, ua.indexOf(common) + 1), ...ub.slice(0, ub.indexOf(common))]);
}

/** Cheapest paths from one node (Dijkstra; the graph has a few hundred nodes at most). */
export function shortestPaths(g: DvGraph, start: string, o: DvOptions, allowed?: Set<Body>) {
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, DvEdge>();
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) [u, best] = [id, d];
    if (u === null) break;
    done.add(u);
    for (const e of g.out.get(u) ?? []) {
      if (allowed && !allowed.has(g.node(e.to).body)) continue;
      const d = best + edgeCost(e, o);
      if (d < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, d);
        prev.set(e.to, e);
      }
    }
  }
  return { dist, prev };
}

export function findRoute(g: DvGraph, from: string, to: string, o: DvOptions): Route | null {
  const allowed = hierarchyPath(g, g.node(from).body, g.node(to).body);
  const { dist, prev } = shortestPaths(g, from, o, allowed);
  if (!dist.has(to)) return null;
  const edges: DvEdge[] = [];
  for (let n = to; n !== from; ) {
    const e = prev.get(n)!;
    edges.unshift(e);
    n = e.from;
  }
  return { nodes: [from, ...edges.map((e) => e.to)], edges, total: dist.get(to)! };
}

/** Human label for a node, e.g. "Mun low orbit (14 km)" or "Duna intercept (from Kerbin)". */
export function nodeLabel(n: DvNode): string {
  switch (n.kind) {
    case 'surface':
      return `${n.body.name} surface`;
    case 'low':
      return `${n.body.name} low orbit (${Math.round(lowOrbitAltitude(n.body) / 1000)} km)`;
    case 'sync':
      return `${n.body.name} synchronous orbit (${fmtKm(syncOrbitRadius(n.body)! - n.body.radius)})`;
    case 'capture':
      return `${n.body.name} capture / escape`;
    case 'intercept':
      return `${n.body.name} intercept (from ${n.from!.name})`;
  }
}

const fmtKm = (m: number) => `${Math.round(m / 1000).toLocaleString('en-US')} km`;

export const shortKindLabel: Record<NodeKind, string> = {
  surface: 'Surface',
  low: 'Low orbit',
  sync: 'Synchronous',
  capture: 'Capture',
  intercept: 'Intercept',
};

/** What a leg of a route actually is, described as the burn (or the aerobrake) it stands for. */
export function legLabel(g: DvGraph, e: DvEdge, o: DvOptions): string {
  const a = g.node(e.from);
  const b = g.node(e.to);
  const aero = o.aerobrake && e.aeroDv !== undefined;
  const A = a.body.name;
  const B = b.body.name;
  if (a.kind === 'surface') return `Launch to ${B} low orbit`;
  if (b.kind === 'surface') return aero ? `Deorbit and aerobrake to ${B} surface` : `Land on ${B}`;
  if (b.kind === 'sync') return `Raise to ${B} synchronous orbit (two burns)`;
  if (a.kind === 'sync' && b.kind === 'low') return `Lower to ${B} low orbit (two burns)`;
  if (a.kind === 'sync') return `Escape burn at ${A}`;
  if (a.kind === 'low' && b.kind === 'capture') return `Escape burn at ${A}`;
  if (a.kind === 'capture' && b.kind === 'low') return aero ? `Aerobrake into ${B} low orbit` : `Circularize at ${B} low orbit`;
  if (b.kind === 'intercept') {
    if (a.kind === 'low') return `Transfer burn from ${A} low orbit to ${B}`;
    if (a.kind === 'capture' && b.body.parent === a.body) return `Lower apoapsis at ${A} to reach ${B}`;
    return `Eject from ${A} toward ${B}`;
  }
  // From an intercept: arriving somewhere.
  if (b.kind === 'capture') {
    if (a.from && a.from.parent === b.body) return `Raise to escape at ${B}`;
    return aero ? `Aerocapture at ${B}` : `Capture at ${B}`;
  }
  return aero ? `Aerobrake into ${B} low orbit` : `Circularize at ${B} low orbit`;
}
