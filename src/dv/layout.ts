/**
 * Subway-style layout of the delta-v map, rooted at the home world.
 *
 * The displayed tree is the cheapest-path tree from the home surface (no aerobraking, no plane
 * changes, so it doesn't jump when the toggles change). Each body is one horizontal row,
 * read left to right as travelling away from home: intercept → capture → low orbit → surface.
 * A row hangs below the node it branches from, one column to the right.
 */
import type { Body } from '../core/index.ts';
import { DvGraph, edgeCost, hierarchyPath, nodeId, shortestPaths, type DvEdge, type DvOptions, type NodeKind } from './graph.ts';

export interface LayoutNode {
  id: string;
  col: number;
  row: number;
}

export interface LayoutRow {
  body: Body;
  row: number;
  nodes: LayoutNode[];
  /** Edge from another row into this row's first node; null for the home row. */
  attach: DvEdge | null;
  /** A one-node row for the body's synchronous orbit, hanging off its low orbit. */
  sync?: boolean;
}

export interface DvLayout {
  rows: LayoutRow[];
  nodes: Map<string, LayoutNode>;
  /** Edges drawn: inside rows and the connectors between them. */
  edges: DvEdge[];
  cols: number;
}

const ORDER: NodeKind[] = ['intercept', 'capture', 'low', 'surface'];

/** The body a trip from home arrives at `y` from: a sibling on home's side, or y's parent. */
function naturalOrigin(g: DvGraph, y: Body): Body {
  const homeLine = [g.system.home, ...g.system.ancestors(g.system.home)];
  if (homeLine.includes(y)) return homeLine[homeLine.indexOf(y) - 1]!; // home is (inside) one of y's moons
  const sibling = homeLine.find((h) => h.parent === y.parent);
  return sibling ?? y.parent!;
}

export function layoutDvMap(g: DvGraph): DvLayout {
  const home = g.system.home;
  const start = g.nodes.has(nodeId(home, 'surface')) ? nodeId(home, 'surface') : nodeId(home, 'low');
  const plain = { aerobrake: false, planeChanges: false };

  // Each body's chain, and the cheapest edge from another row into its intercept.
  const chains = new Map<Body, string[]>();
  const attachOf = new Map<Body, DvEdge>();
  for (const b of g.system.bodies) {
    if (!b.parent) continue;
    if (b === home) {
      chains.set(b, (['surface', 'low', 'capture'] as const).map((k) => nodeId(b, k)).filter((id) => g.nodes.has(id)));
      continue;
    }
    const intercept = nodeId(b, 'intercept', naturalOrigin(g, b));
    if (!g.nodes.has(intercept)) continue;
    const { dist } = shortestPaths(g, start, plain, hierarchyPath(g, home, b));
    let best: DvEdge | null = null;
    for (const e of g.edges) {
      if (e.to !== intercept || !dist.has(e.from)) continue;
      if (!best || dist.get(e.from)! + e.dv < dist.get(best.from)! + best.dv) best = e;
    }
    if (!best) continue;
    attachOf.set(b, best);
    chains.set(b, [intercept, ...ORDER.slice(1).map((k) => nodeId(b, k)).filter((id) => g.nodes.has(id))]);
  }

  const childrenOf = new Map<string, Body[]>();
  for (const [b, e] of attachOf) {
    const list = childrenOf.get(e.from) ?? [];
    list.push(b);
    childrenOf.set(e.from, list);
  }

  const rows: LayoutRow[] = [];
  const nodes = new Map<string, LayoutNode>();
  const edges: DvEdge[] = [];
  let cols = 0;

  const place = (b: Body, col0: number) => {
    const ids = chains.get(b)!;
    const row = rows.length;
    const attach = attachOf.get(b) ?? null;
    const r: LayoutRow = { body: b, row, nodes: [], attach };
    rows.push(r);
    ids.forEach((id, i) => {
      const n = { id, col: col0 + i, row };
      r.nodes.push(n);
      nodes.set(id, n);
      cols = Math.max(cols, n.col + 1);
      if (i > 0) edges.push(g.edge(ids[i - 1]!, id)!);
    });
    if (attach) edges.push(attach);
    // Rightmost branch points first, so the vertical connectors of earlier nodes never cross rows.
    for (let i = ids.length - 1; i >= 0; i--) {
      const kids = (childrenOf.get(ids[i]!) ?? []).sort((x, y) => x.orbit!.a - y.orbit!.a);
      for (const k of kids) place(k, col0 + i + 1);
      if (ids[i] === nodeId(b, 'low') && g.nodes.has(nodeId(b, 'sync'))) placeSync(b, col0 + i + 1);
    }
  };
  const placeSync = (b: Body, col: number) => {
    const id = nodeId(b, 'sync');
    const attach = g.edge(nodeId(b, 'low'), id)!;
    const n = { id, col, row: rows.length };
    rows.push({ body: b, row: n.row, nodes: [n], attach, sync: true });
    nodes.set(id, n);
    cols = Math.max(cols, col + 1);
    edges.push(attach);
  };
  if (chains.has(home)) place(home, 0);
  return { rows, nodes, edges, cols };
}

export interface RouteOverlay {
  /** Drawn edges the route follows at the drawn cost. */
  highlight: Set<string>;
  /** Legs the map doesn't draw, or draws with another origin's cost: drawn on top, with the route's value. */
  extra: { edge: DvEdge; from: LayoutNode; to: LayoutNode }[];
}

/**
 * How to show a route on the map. The map only draws transfers from the home world, so a leg
 * like Moho → Eve has no line of its own. Hidden intercept nodes stand in for a drawn intercept
 * of the same body (the mirror of the same transfer first, e.g. Eeloo's intercept from Kerbin
 * for Kerbin's intercept from Eeloo). Where the drawn line between the stand-ins carries the
 * same cost, it is highlighted; otherwise the leg is drawn over it with its own number.
 */
export function routeOverlay(g: DvGraph, layout: DvLayout, routeEdges: DvEdge[], o: DvOptions): RouteOverlay {
  const shown = (id: string): LayoutNode | undefined => {
    const direct = layout.nodes.get(id);
    if (direct) return direct;
    const n = g.node(id);
    if (n.kind !== 'intercept') return undefined;
    const mirror = layout.nodes.get(nodeId(n.from!, 'intercept', n.body));
    if (mirror) return mirror;
    for (const [lid, ln] of layout.nodes) if (lid.startsWith(`${n.body.id}:intercept:`)) return ln;
    return undefined;
  };
  const drawn = new Map(layout.edges.map((e) => [`${e.from}|${e.to}`, e]));
  const highlight = new Set<string>();
  const extra: RouteOverlay['extra'] = [];
  for (const e of routeEdges) {
    const a = shown(e.from);
    const b = shown(e.to);
    if (!a || !b || a === b) continue;
    const same = drawn.get(`${a.id}|${b.id}`) ?? drawn.get(`${b.id}|${a.id}`);
    if (same && Math.abs(edgeCost(same, o) - edgeCost(e, o)) < 0.5) highlight.add(same.id);
    else extra.push({ edge: e, from: a, to: b });
  }
  return { highlight, extra };
}
