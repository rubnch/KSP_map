/**
 * Subway-style layout of the delta-v map, rooted at the home world.
 *
 * The displayed tree is the cheapest-path tree from the home surface (no aerobraking, no plane
 * changes, so it doesn't jump when the toggles change). Each body is one horizontal row,
 * read left to right as travelling away from home: intercept → capture → low orbit → surface.
 * A row hangs below the node it branches from, one column to the right.
 */
import type { Body } from '../core/index.ts';
import { DvGraph, hierarchyPath, nodeId, shortestPaths, type DvEdge, type NodeKind } from './graph.ts';

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
    }
  };
  if (chains.has(home)) place(home, 0);
  return { rows, nodes, edges, cols };
}

/**
 * Drawn edges to highlight for a route. A route can use nodes the map doesn't draw, such as
 * Kerbin's intercept when coming back from Eeloo; those stand in for the drawn intercept of the
 * same transfer (Eeloo's intercept from Kerbin), so a return trip lights up the same line.
 */
export function routeHighlight(g: DvGraph, layout: DvLayout, routeNodes: string[]): Set<string> {
  const shown = (id: string): string | null => {
    if (layout.nodes.has(id)) return id;
    const n = g.node(id);
    if (n.kind !== 'intercept') return null;
    const mirror = nodeId(n.from!, 'intercept', n.body);
    return layout.nodes.has(mirror) ? mirror : null;
  };
  const mapped = routeNodes.map(shown);
  const pairs = new Set<string>();
  for (let i = 1; i < mapped.length; i++) {
    const a = mapped[i - 1];
    const b = mapped[i];
    if (a && b && a !== b) pairs.add(`${a}|${b}`).add(`${b}|${a}`);
  }
  return new Set(layout.edges.filter((e) => pairs.has(`${e.from}|${e.to}`)).map((e) => e.id));
}
