/**
 * Subway-style layout of the delta-v map, rooted at one body: the home world by default, or the
 * start of the route being planned, so every leg of that route has its own line and its own cost.
 *
 * The displayed tree is the cheapest-path tree from the root's surface (no aerobraking, no plane
 * changes, so it doesn't jump when the toggles change). Each body is one horizontal row,
 * read left to right as travelling away from the root: intercept → capture → low orbit → surface.
 * A row hangs below the node it branches from, one column to the right.
 */
import type { Body } from '../core/index.ts';
import { DvGraph, edgeCost, hierarchyPath, nodeId, shortestPaths, type DvEdge, type DvOptions, type NodeKind } from './graph.ts';

export interface LayoutNode {
  id: string;
  col: number;
  row: number;
  /** Drawn just below its row, between two columns (the synchronous orbit under the low orbit). */
  sub?: boolean;
}

export interface LayoutRow {
  body: Body;
  row: number;
  nodes: LayoutNode[];
  /** Edge from another row into this row's first node; null for the root row. */
  attach: DvEdge | null;
  /** The row has a synchronous orbit node under it and needs extra height. */
  tall?: boolean;
}

export interface DvLayout {
  rows: LayoutRow[];
  nodes: Map<string, LayoutNode>;
  /** Edges drawn: inside rows and the connectors between them. */
  edges: DvEdge[];
  cols: number;
}

const ORDER: NodeKind[] = ['intercept', 'capture', 'low', 'surface'];

/** The body a trip from the root arrives at `y` from: a sibling on the root's side, or y's parent. */
function naturalOrigin(g: DvGraph, root: Body, y: Body): Body {
  const homeLine = [root, ...g.system.ancestors(root)];
  if (homeLine.includes(y)) return homeLine[homeLine.indexOf(y) - 1]!; // the root is (inside) one of y's moons
  const sibling = homeLine.find((h) => h.parent === y.parent);
  return sibling ?? y.parent!;
}

export function layoutDvMap(g: DvGraph, root: Body = g.system.home): DvLayout {
  const home = root.parent ? root : g.system.home;
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
    const intercept = nodeId(b, 'intercept', naturalOrigin(g, home, b));
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
    // The synchronous orbit sits just under the row, between the low orbit (launches climb to it)
    // and the capture node (arrivals capture straight into it), joined to both.
    const lowIdx = ids.indexOf(nodeId(b, 'low'));
    const capIdx = ids.indexOf(nodeId(b, 'capture'));
    const sync = nodeId(b, 'sync');
    if (lowIdx >= 0 && capIdx >= 0 && g.nodes.has(sync)) {
      const n = { id: sync, col: col0 + (lowIdx + capIdx) / 2, row, sub: true };
      nodes.set(sync, n);
      edges.push(g.edge(ids[lowIdx]!, sync)!);
      edges.push({ id: `${ids[capIdx]}->${sync}`, from: ids[capIdx]!, to: sync, dv: 0, link: true });
      r.tall = true;
    }
    // Rightmost branch points first, so the vertical connectors of earlier nodes never cross rows.
    for (let i = ids.length - 1; i >= 0; i--) {
      const kids = (childrenOf.get(ids[i]!) ?? []).sort((x, y) => x.orbit!.a - y.orbit!.a);
      for (const k of kids) place(k, col0 + i + 1);
    }
  };

  if (chains.has(home)) place(home, 0);
  return { rows, nodes, edges, cols };
}

export interface RouteView {
  /** Drawn edges the route runs along. */
  edges: Set<string>;
  /** The route's own cost on an edge, where it differs from what the map shows; null for a coast. */
  labels: Map<string, number | null>;
  /**
   * Pairs of connectors that hang off the same node the route doesn't visit (Moho → Eve both hang
   * off Kerbin's capture): the route runs along the trunk between them instead of up to the node.
   */
  shortcuts: { up: DvEdge; down: DvEdge }[];
}

/**
 * How a route shows on the map. The map stays drawn from home; a route between two other bodies
 * runs along the tree (Moho's row, the trunk, Eve's row), and only the transfer numbers change:
 * the ejection goes on the departure body's row, the capture on the arrival body's row.
 */
export function routeView(layout: DvLayout, routeNodes: string[], routeEdges: DvEdge[], o: DvOptions): RouteView {
  const view: RouteView = { edges: new Set(), labels: new Map(), shortcuts: [] };
  const start = routeNodes[0];
  const end = routeNodes[routeNodes.length - 1];
  if (!start || !end || !layout.nodes.has(start) || !layout.nodes.has(end)) return view;

  // The tree path between the two drawn ends.
  const adj = new Map<string, DvEdge[]>();
  for (const e of layout.edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e]);
  }
  const back = new Map<string, DvEdge>();
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const u = queue.shift()!;
    for (const e of adj.get(u) ?? []) {
      const v = e.from === u ? e.to : e.from;
      if (seen.has(v)) continue;
      seen.add(v);
      back.set(v, e);
      queue.push(v);
    }
  }
  const path: { edge: DvEdge; from: string; to: string }[] = [];
  for (let v = end; v !== start; ) {
    const e = back.get(v);
    if (!e) return view;
    const u = e.from === v ? e.to : e.from;
    path.unshift({ edge: e, from: u, to: v });
    v = u;
  }
  for (const p of path) view.edges.add(p.edge.id);
  const at = (node: string) => path.findIndex((p) => p.from === node);

  // Split the route into stretches between nodes the map draws, and put each stretch's legs on
  // the tree edges it spans: first leg on the first edge, last leg on the last, coasts between.
  let i = 0;
  while (i < routeEdges.length) {
    const legs = [routeEdges[i]!];
    while (!layout.nodes.has(legs[legs.length - 1]!.to) && i + legs.length < routeEdges.length) legs.push(routeEdges[i + legs.length]!);
    i += legs.length;
    const a = at(legs[0]!.from);
    const b = path.findIndex((p) => p.to === legs[legs.length - 1]!.to);
    if (a < 0 || b < a) continue;
    const span = path.slice(a, b + 1);
    const put = (edge: DvEdge, value: number | null) => {
      if (value === null || Math.abs(edgeCost(edge, o) - value) >= 0.5) view.labels.set(edge.id, value);
    };
    if (span.length === 1 && legs.length === 1) {
      put(span[0]!.edge, edgeCost(legs[0]!, o));
      continue;
    }
    const first = legs[0]!;
    const last = legs.length > 1 ? legs[legs.length - 1]! : null;
    span.forEach((p, k) => {
      if (k === 0 && (last || span.length === 1)) put(p.edge, edgeCost(first, o));
      else if (k === span.length - 1) put(p.edge, edgeCost(last ?? first, o) + (last ? legs.slice(1, -1).reduce((t, e) => t + edgeCost(e, o), 0) : 0));
      else put(p.edge, null);
    });
  }

  // Connector pairs around a node the route never visits.
  const visited = new Set(routeNodes);
  for (let k = 0; k + 1 < path.length; k++) {
    const up = path[k]!;
    const down = path[k + 1]!;
    const isConnector = (e: DvEdge) => layout.rows.some((r) => r.attach?.id === e.id);
    if (up.to === down.from && !visited.has(up.to) && isConnector(up.edge) && isConnector(down.edge)) {
      view.shortcuts.push({ up: up.edge, down: down.edge });
    }
  }
  return view;
}
