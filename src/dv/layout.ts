/**
 * Subway-style layout of the delta-v map, drawn from the home world.
 *
 * A vertical trunk down the middle stands for solar orbit: it runs through the home world's
 * capture node, and every planet branches off it at its place in distance from the star,
 * alternating left and right. Each body is one horizontal row reading outwards from the trunk:
 * intercept → capture → low orbit → surface (the home row: capture → low orbit → surface).
 * Moons hang below their planet's row, one column further out.
 */
import type { Body } from '../core/index.ts';
import { DvGraph, edgeCost, hierarchyPath, nodeId, shortestPaths, type DvEdge, type DvOptions, type NodeKind } from './graph.ts';

export interface LayoutNode {
  id: string;
  /** Columns from the trunk: positive to the right, negative to the left. */
  col: number;
  /** Rows from the top (fractional for the synchronous orbit, which sits under its row). */
  y: number;
  /** Drawn just below its row, between two columns (the synchronous orbit under the low orbit). */
  sub?: boolean;
}

export interface LayoutRow {
  body: Body;
  y: number;
  /** Which side of the trunk the row is on. */
  side: 1 | -1;
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
  minCol: number;
  maxCol: number;
  /** Total height in rows. */
  height: number;
}

/** Extra height, in rows, of a row with a synchronous orbit under it. */
export const SUB_ROWS = 0.8;

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
  let minCol = 0;
  let maxCol = 0;
  const cursor = { y: 0 };
  // Planets placed as their own branch off the trunk, not as children of the home row.
  const blocks = new Set<Body>();

  const place = (b: Body, col0: number, side: 1 | -1) => {
    const ids = chains.get(b)!;
    // The home row reads outwards from the trunk too: capture, low orbit, surface.
    const shown = b === home ? [...ids].reverse() : ids;
    const attach = attachOf.get(b) ?? null;
    const sync = nodeId(b, 'sync');
    const lowIdx = shown.indexOf(nodeId(b, 'low'));
    const capIdx = shown.indexOf(nodeId(b, 'capture'));
    const tall = lowIdx >= 0 && capIdx >= 0 && g.nodes.has(sync);
    const r: LayoutRow = { body: b, y: cursor.y, side, nodes: [], attach, tall };
    rows.push(r);
    cursor.y += 1 + (tall ? SUB_ROWS : 0);
    const put = (n: LayoutNode) => {
      nodes.set(n.id, n);
      minCol = Math.min(minCol, n.col);
      maxCol = Math.max(maxCol, n.col);
    };
    shown.forEach((id, i) => {
      const n = { id, col: side * (col0 + i), y: r.y };
      r.nodes.push(n);
      put(n);
    });
    ids.forEach((id, i) => i > 0 && edges.push(g.edge(ids[i - 1]!, id)!));
    if (attach) edges.push(attach);
    // The synchronous orbit sits just under the row, between the low orbit (launches climb to it)
    // and the capture node (arrivals capture straight into it), joined to both.
    if (tall) {
      put({ id: sync, col: side * (col0 + (lowIdx + capIdx) / 2), y: r.y + SUB_ROWS, sub: true });
      edges.push(g.edge(shown[lowIdx]!, sync)!);
      edges.push({ id: `${shown[capIdx]}->${sync}`, from: shown[capIdx]!, to: sync, dv: 0, link: true });
    }
    // Outermost branch points first, so the connectors of inner nodes never cross rows.
    for (let i = shown.length - 1; i >= 0; i--) {
      const kids = (childrenOf.get(shown[i]!) ?? []).sort((x, y) => x.orbit!.a - y.orbit!.a);
      for (const k of kids) if (!blocks.has(k)) place(k, col0 + i + 1, side);
    }
  };

  if (chains.has(home) && home.parent && !home.parent.parent) {
    // Planets around the star, by distance, alternating sides; a branch joins the trunk no higher
    // than the one before it, so the trunk reads in order.
    const sideY = { [1]: 0, [-1]: 0 } as Record<1 | -1, number>;
    let lastJunction = -Infinity;
    const planets = home.parent.children.filter((p) => chains.has(p)).sort((x, y) => x.orbit!.a - y.orbit!.a);
    for (const p of planets) blocks.add(p);
    planets.forEach((p, i) => {
      const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
      cursor.y = Math.max(sideY[side], lastJunction + 1);
      lastJunction = cursor.y;
      place(p, p === home ? 0 : 1, side);
      sideY[side] = cursor.y + 0.25;
    });
    cursor.y = Math.max(sideY[1], sideY[-1]);
  } else if (chains.has(home)) {
    place(home, 0, 1);
  }
  return { rows, nodes, edges, minCol, maxCol, height: cursor.y };
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
