import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useMapStore } from '../state/store.ts';
import { ascentCost, hasSurface, lowOrbitRadius, syncOrbitRadius, transferTime, type AscentSource } from './physics.ts';
import {
  DvGraph,
  edgeCost,
  findRoute,
  routeLegs,
  nodeId,
  nodeLabel,
  type DvEdge,
  type DvNode,
  type DvOptions,
  type NodeKind,
  type Route,
} from './graph.ts';
import { layoutDvMap, routeView, type LayoutNode, type LayoutRow } from './layout.ts';
import type { Body } from '../core/index.ts';
import { OrbitCard } from './OrbitCard.tsx';
import { usePanZoom } from './panzoom.ts';
import { useDvStore, type DvSettings } from './store.ts';

const COL = 98;
const ROW = 60;
const PAD_X = 28;
const PAD_Y = 56;
const NAME_W = 190;

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

type Pt = { x: number; y: number };

/**
 * A line's colour, or when dimmed the same colour mixed into the background: opaque, so lines that
 * overlap (shared trunks) don't add up into darker and lighter shades the way transparency does.
 */
const shade = (color: string, dim: boolean) => (dim ? `color-mix(in srgb, ${color} 30%, var(--bg))` : color);

/** The dark tag behind a number that the picked route or start changed. */
function Pill({ x, y, text, transform }: { x: number; y: number; text: string; transform?: string }) {
  const w = text.length * 7 + 12;
  return <rect className="dv-pill" x={x - w / 2} y={y - 8} width={w} height={16} rx={8} transform={transform} />;
}

/** A polyline with its corners rounded off, like a subway map. */
function rounded(pts: Pt[], r = 16) {
  const p = pts.filter((q, i) => i === 0 || q.x !== pts[i - 1]!.x || q.y !== pts[i - 1]!.y);
  let d = `M${p[0]!.x},${p[0]!.y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [a, b, c] = [p[i - 1]!, p[i]!, p[i + 1]!];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(r, l1 / 2, l2 / 2);
    const s = { x: b.x + ((a.x - b.x) / l1) * k, y: b.y + ((a.y - b.y) / l1) * k };
    const e = { x: b.x + ((c.x - b.x) / l2) * k, y: b.y + ((c.y - b.y) / l2) * k };
    d += ` L${s.x},${s.y} Q${b.x},${b.y} ${e.x},${e.y}`;
  }
  const z = p[p.length - 1]!;
  return `${d} L${z.x},${z.y}`;
}

/** A white ring with a sketch of the orbit inside: the same shapes as the legend. */
function NodeIcon({ kind }: { kind: NodeKind }) {
  switch (kind) {
    case 'surface':
      return <circle r={11} className="ring" />;
    case 'low':
      return (
        <>
          <circle r={9.5} className="ring" />
          <circle r={5} className="inner" />
          <circle r={2} className="dot" />
        </>
      );
    case 'sync':
      return (
        <>
          <circle r={9.5} className="ring" />
          <circle r={6.5} className="inner" />
          <circle r={3.5} className="inner" />
          <circle r={1.4} className="dot" />
        </>
      );
    case 'capture':
    case 'syncCapture':
    case 'syncTransfer': {
      // An ellipse with the body at its focus.
      const [rx, ry] = kind === 'syncTransfer' ? [4.6, 3] : [6, 3.6];
      return (
        <>
          <circle r={9.5} className="ring" />
          <g transform="rotate(-35)">
            <ellipse cx={1.2} rx={rx} ry={ry} className="inner" />
            <circle cx={1.2 - Math.sqrt(rx * rx - ry * ry)} r={1.8} className="dot" />
          </g>
        </>
      );
    }
    case 'intercept':
      // A pass bending around the body.
      return (
        <>
          <circle r={9.5} className="ring" />
          <path d="M-1,-7 Q7,0 -1,7" transform="rotate(-35)" className="inner" />
          <circle r={2} className="dot" />
        </>
      );
  }
}

const SOURCE_LABEL: Record<AscentSource, string> = {
  override: 'your value',
  pack: 'community',
  computed: 'computed',
  estimated: 'estimate',
};

function useDvGraph() {
  const system = useMapStore((s) => s.system);
  const overrides = useDvStore((s) => s.overrides);
  const sync = useDvStore((s) => s.sync);
  const graph = useMemo(() => new DvGraph(system, overrides, { sync }), [system, overrides, sync]);
  return { graph };
}

function useOptions(): DvOptions {
  const aerobrake = useDvStore((s) => s.aerobrake);
  const chutes = useDvStore((s) => s.chutes);
  const planeChanges = useDvStore((s) => s.planeChanges);
  return useMemo(() => ({ aerobrake, chutes, planeChanges }), [aerobrake, chutes, planeChanges]);
}

/** The route there, and the way back when round trips are on. */
function useRoutes(graph: DvGraph, options: DvOptions) {
  const from = useDvStore((s) => s.from);
  const to = useDvStore((s) => s.to);
  const roundTrip = useDvStore((s) => s.roundTrip);
  return useMemo(() => {
    if (!from || !to || !graph.nodes.has(from) || !graph.nodes.has(to)) return { route: null, back: null, total: 0 };
    const route = findRoute(graph, from, to, options);
    const back = roundTrip ? findRoute(graph, to, from, options) : null;
    return { route, back, total: (route?.total ?? 0) + (back?.total ?? 0) };
  }, [graph, from, to, roundTrip, options]);
}

/** The delta-v map: a subway diagram generated from the loaded system, plus the route panel. */
export function DeltaVView() {
  const { graph } = useDvGraph();
  // The map always reads without plane changes (they show as +N under each transfer); the
  // setting only changes what the route panel counts.
  const routeOptions = useOptions();
  const options = useMemo(() => ({ ...routeOptions, planeChanges: false }), [routeOptions]);
  const from = useDvStore((s) => s.from);
  const to = useDvStore((s) => s.to);
  const pick = useDvStore((s) => s.pick);
  const clear = useDvStore((s) => s.clear);
  const layout = useMemo(() => layoutDvMap(graph), [graph]);
  const roundTrip = useDvStore((s) => s.roundTrip);
  const { route } = useRoutes(graph, routeOptions);
  const view = useMemo(
    () => (route ? routeView(layout, route.nodes, route.edges, options) : null),
    [graph, layout, route, options],
  );
  // Interplanetary numbers always read on the target's row: its trunk line carries the ejection
  // toward it, its intercept line the capture there. With only a start picked, every planet reads
  // from the start's planet; with a route, the route's own transfer does. The start planet's own
  // two transfer lines (about arriving from home) read as coasts.
  const solar = useMemo(() => {
    const labels = new Map<string, number | null>();
    const planes = new Map<string, number>();
    if (!from || !graph.nodes.has(from) || (to && !route)) return { labels, planes, origin: null as Body | null };
    const star = graph.system.root;
    const home = graph.system.home;
    const planetOf = (b: Body) => {
      while (b.parent && b.parent !== star) b = b.parent;
      return b;
    };
    // The route's interplanetary ejection, if it has one.
    const k = route
      ? route.edges.findIndex((e) => {
          const a = graph.node(e.from);
          const b = graph.node(e.to);
          return b.kind === 'intercept' && a.body.parent === star && (b.body.parent === star || b.body === star);
        })
      : -1;
    const ejectEdge = route && k >= 0 ? route.edges[k]! : null;
    if (route && !ejectEdge) return { labels, planes, origin: null as Body | null };
    const origin = ejectEdge ? graph.node(ejectEdge.from).body : planetOf(graph.node(from).body);
    if (origin === home || origin === star) return { labels, planes, origin: null as Body | null };
    const arrivalOf = (r: LayoutRow) =>
      r.nodes[1] ? layout.edges.find((e) => e.from === r.nodes[0]!.id && e.to === r.nodes[1]!.id) : undefined;
    for (const r of layout.rows) {
      const p = r.body;
      if (p.parent !== star && p !== star) continue;
      const arrival = arrivalOf(r);
      if (p === origin) {
        if (r.attach) labels.set(r.attach.id, null);
        if (arrival) labels.set(arrival.id, null);
        continue;
      }
      if (ejectEdge && graph.node(ejectEdge.to).body !== p) continue;
      const arriveAt = nodeId(p, p === star ? 'low' : 'capture');
      const intercept = nodeId(p, 'intercept', origin);
      const eject = ejectEdge ?? graph.edge(nodeId(origin, 'capture'), intercept);
      const next = ejectEdge ? route!.edges[k + 1] : undefined;
      const capture = ejectEdge ? (next && next.to === arriveAt ? next : undefined) : graph.edge(intercept, arriveAt);
      if (!eject) continue;
      const key = p === home ? 'home-eject' : r.attach?.id;
      if (!key) continue;
      labels.set(key, edgeCost(eject, options));
      if (eject.plane !== undefined) planes.set(key, eject.plane);
      if (capture) {
        if (p === home) labels.set('home-capture', edgeCost(capture, options));
        else if (!ejectEdge && arrival) labels.set(arrival.id, edgeCost(capture, options));
      }
    }
    return { labels, planes, origin };
  }, [graph, layout, from, to, route, options]);
  const labels = new Map([...(view?.labels ?? []), ...solar.labels]);
  const preview = solar.labels;

  // The trunk sits in the middle, with room for names on both sides.
  const leftRoom = layout.minCol < 0 ? NAME_W : 0;
  const trunkX = PAD_X + leftRoom - layout.minCol * COL;
  const pos = (n: LayoutNode) => ({ x: trunkX + n.col * COL, y: PAD_Y + n.y * ROW });

  // To each body's surface (or low orbit for gas giants): from the picked departure, or from the
  // home surface when none is picked. The departure's own body gets no total.
  const departure = from && graph.nodes.has(from) ? from : null;
  const landing = useMemo(() => {
    const home = graph.system.home;
    const start =
      departure ?? (graph.nodes.has(nodeId(home, 'surface')) ? nodeId(home, 'surface') : nodeId(home, 'low'));
    const startBody = graph.node(start).body;
    const out = new Map<string, { total: number; worst: number; orbitOnly: boolean }>();
    for (const r of layout.rows) {
      if (r.body === startBody) continue;
      const surf = nodeId(r.body, 'surface');
      const orbitOnly = !graph.nodes.has(surf);
      const target = orbitOnly ? nodeId(r.body, 'low') : surf;
      const cost = (o: DvOptions) => {
        const there = findRoute(graph, start, target, o);
        const back = roundTrip ? findRoute(graph, target, start, o) : null;
        return there && (back || !roundTrip) ? there.total + (back?.total ?? 0) : null;
      };
      const total = cost(options);
      const worst = cost({ ...options, planeChanges: true });
      if (total !== null && worst !== null) out.set(r.body.id, { total, worst, orbitOnly });
    }
    return out;
  }, [graph, layout, options, roundTrip, departure]);

  const width = trunkX + layout.maxCol * COL + NAME_W + PAD_X;
  // The solar trunk: from the first planet branch to the last.
  const star = graph.system.root;
  const trunkEdge = (e: DvEdge) =>
    e.from === nodeId(graph.system.home, 'capture') &&
    graph.node(e.to).kind === 'intercept' &&
    (graph.node(e.to).body.parent === star || graph.node(e.to).body === star);
  const trunkYs = layout.edges.filter(trunkEdge).map((e) => pos(layout.nodes.get(e.to)!).y);
  const homeCap = layout.nodes.get(nodeId(graph.system.home, 'capture'));
  if (homeCap) trunkYs.push(pos(homeCap).y);
  const starRow = layout.rows.find((r) => r.vertical);
  const trunk = trunkYs.length > 1 ? { top: Math.min(...trunkYs), bottom: Math.max(...trunkYs) } : null;
  const height = PAD_Y * 2 + (layout.height - 1) * ROW;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ node: DvNode; x: number; y: number } | null>(null);
  const hoverAt = (node: DvNode) => (ev: PointerEvent) => {
    if (ev.buttons) return;
    const r = box.current!.getBoundingClientRect();
    setHover({ node, x: ev.clientX - r.left, y: ev.clientY - r.top });
  };
  const pz = usePanZoom(box, { width, height }, panelInsets);
  const rowEnds = new Set(layout.rows.map((r) => r.nodes[r.nodes.length - 1]!.id));
  const shortcutEdges = new Set(view?.shortcuts.flatMap((sc) => [sc.up.id, sc.down.id]));
  const stubOn = layout.edges.some((e) => trunkEdge(e) && view?.edges.has(e.id) && !shortcutEdges.has(e.id));

  /**
   * Where a line runs (a polyline, drawn with rounded corners), and where its number sits: in the
   * middle of the line, turned along it on vertical stretches. `a` and `b` are its two ends, in the
   * edge's direction.
   */
  const onRoute = (e: DvEdge) => !!view?.edges.has(e.id) && !shortcutEdges.has(e.id);
  const lineColor = (e: DvEdge) => (trunkEdge(e) ? star.data.style.color : graph.node(e.from).body.data.style.color);
  const geometry = (e: DvEdge) => {
    const a = pos(layout.nodes.get(e.from)!);
    const b = pos(layout.nodes.get(e.to)!);
    const an = layout.nodes.get(e.from)!;
    const bn = layout.nodes.get(e.to)!;
    const flat = (pts: Pt[], lx: number, ly: number, ea = a, eb = b) => ({
      pts,
      lx,
      ly,
      vertical: false,
      out: 1,
      a: ea,
      b: eb,
    });
    const lowX = (n: LayoutNode) => pos(layout.nodes.get(nodeId(graph.node(n.id).body, 'low'))!).x;
    if (an.sub && bn.sub) return flat([a, b], (a.x + b.x) / 2, b.y);
    // Climbs from the row: straight up from the row node, then across to the node up there, with
    // the number on the way up. The home world's high capture is reached from its intercept
    // (drawn on the map only), like everyone else's.
    if (bn.sub || an.sub) {
      let top = bn.sub ? a : b;
      const sub = bn.sub ? b : a;
      const rowN = bn.sub ? an : bn;
      if (rowN === homeCap && graph.node((bn.sub ? bn : an).id).kind === 'syncCapture') {
        top = { x: trunkX + (homeCap.col - Math.sign(homeCap.col)) * COL, y: top.y };
      }
      const out = Math.sign(top.x - lowX(bn.sub ? bn : an)) || -1;
      return {
        pts: bn.sub ? [top, { x: top.x, y: sub.y }, sub] : [sub, { x: top.x, y: sub.y }, top],
        lx: top.x,
        ly: (top.y + sub.y) / 2,
        vertical: true,
        out,
        a: bn.sub ? top : sub,
        b: bn.sub ? sub : top,
      };
    }
    // Transfers from home leave from the trunk, where the home branch joins it.
    if (trunkEdge(e)) {
      const t = { x: trunkX, y: a.y };
      // Drawn from the home intercept along the home branch, so the turn onto the trunk is a
      // rounded corner rather than a line end sticking out of the branch.
      const h = homeCap ? { x: trunkX + (homeCap.col - Math.sign(homeCap.col)) * COL, y: a.y } : t;
      // Up the trunk to the star's row: the number just under the star's intercept.
      if (b.x === trunkX) return { ...flat([h, t, b], b.x, b.y + ROW / 2, t, b), vertical: true };
      return flat([h, t, { x: t.x, y: b.y }, b], (t.x + b.x) / 2, b.y, t, b);
    }
    if (an.y === bn.y) return flat([a, b], (a.x + b.x) / 2, b.y);
    // Straight up or down (the star's row): the number turned along the line.
    if (a.x === b.x) return { ...flat([a, b], a.x, (a.y + b.y) / 2), vertical: true };
    return flat([a, { x: a.x, y: b.y }, b], (a.x + b.x) / 2, b.y);
  };

  // Small print under a node, as on the community maps: orbit altitudes, and for an intercept how
  // long the transfer there takes (from the picked departure's planet when there is one).
  const home = graph.system.home;
  const solarDay = (() => {
    const rot = home.data.physical.rotationPeriod;
    const year = home.orbit?.period ?? Infinity;
    return Number.isFinite(year) ? (rot * year) / (year - rot) : rot;
  })();
  const year = (home.orbit?.period ?? Infinity) / solarDay;
  const duration = (s: number) => {
    const d = s / solarDay;
    if (d < 3) return `${Math.max(1, Math.round(s / 3600))} hours`;
    if (d < year) return `${Math.round(d)} days`;
    const y = Math.floor(d / year);
    return `${y} y ${Math.round(d - y * year)} d`;
  };
  const alt = (b: Body, r: number) => {
    const m = r - b.radius;
    return m >= 1e7 ? `${fmt(m / 1e6)} Mm` : `${fmt(m / 1000)} km`;
  };
  const detail = (node: DvNode): string | null => {
    const b = node.body;
    const low = lowOrbitRadius(b);
    switch (node.kind) {
      case 'low':
        return alt(b, low);
      case 'capture':
        return Number.isFinite(b.soi) ? `${alt(b, low)} – ${alt(b, b.soi)}` : null;
      case 'syncTransfer':
        return `${alt(b, low)} – ${alt(b, syncOrbitRadius(b) ?? low)}`;
      case 'intercept': {
        const planetRow = b === star || b.parent === star;
        const from = planetRow && solar.origin ? solar.origin : node.from;
        if (!from || from === b) return null;
        const t = transferTime(from, b);
        return t === null ? null : duration(t);
      }
      default:
        return null;
    }
  };

  // Names above the nodes over the row.
  const subLabel = (node: DvNode) => (
    <text y={-14}>
      {node.kind === 'sync'
        ? `Sync ${Math.round(((syncOrbitRadius(node.body) ?? 0) - node.body.radius) / 1000).toLocaleString('en-US')} km`
        : shortLabel(node)}
    </text>
  );

  const edgeLabel = (e: DvEdge) => {
    const g = geometry(e);
    const aero = options.aerobrake && e.aeroDv !== undefined;
    const chute = options.chutes && e.chuteDv !== undefined;
    const override = labels.get(e.id);
    const hasOverride = labels.has(e.id);
    // The plane change of the transfer this line stands for (the route's own, when it has one).
    const plane = solar.planes.get(e.id) ?? (hasOverride ? undefined : e.plane);
    // The link from the capture node to the synchronous orbit has no cost of its own.
    if (e.link && !hasOverride) return null;
    // Legs the picked route or start coasts through get no number at all.
    if (hasOverride && override === null) return null;
    const dim = view && !hasOverride && !(view.edges.has(e.id) && !shortcutEdges.has(e.id));
    // Aerobraking: an arrow in the line, pointing the way it works, filled when it is counted.
    const back = g.vertical ? g.b.y > g.a.y : g.b.x < g.a.x;
    const arrow = override !== null && e.aeroDv !== undefined ? (back ? (aero ? '◀' : '◁') : aero ? '▶' : '▷') : '';
    const turn = g.vertical ? `rotate(-90 ${g.lx} ${g.ly})` : undefined;
    return (
      <g key={`l-${e.id}`} className={`dv-edge-label${dim ? ' dim' : ''}`}>
        {hasOverride && (
          <Pill
            x={g.lx}
            y={g.ly}
            transform={turn}
            text={`${arrow ? arrow + ' ' : ''}${fmt(override!)}${e.chuteDv !== undefined ? ' P' : ''}`}
          />
        )}
        <text x={g.lx} y={g.ly + 4} transform={turn} className={hasOverride ? 'route-value' : undefined}>
          {arrow && back && <tspan className={`mark${aero ? ' on' : ''}`}>{arrow} </tspan>}
          {hasOverride ? (override === null ? '—' : fmt(override!)) : fmt(edgeCost(e, options))}
          {arrow && !back && <tspan className={`mark${aero ? ' on' : ''}`}> {arrow}</tspan>}
          {override !== null && e.chuteDv !== undefined && <tspan className={`mark${chute ? ' on' : ''}`}> P</tspan>}
          <title>
            {hasOverride
              ? override === null
                ? 'Coasting: no burn here on this route'
                : "This route's cost for this leg"
              : e.aeroDv !== undefined
                ? `Aerobraking possible: ${fmt(e.dv)} m/s powered, ${fmt(e.aeroDv)} m/s with aerobraking`
                : e.chuteDv !== undefined
                  ? `Parachutes possible: ${fmt(e.dv)} m/s powered landing, ${fmt(e.chuteDv)} m/s deorbit burn with parachutes`
                  : `${fmt(e.dv)} m/s`}
            {!hasOverride && e.source ? ` (${SOURCE_LABEL[e.source]})` : ''}
          </title>
        </text>
        {plane !== undefined && plane >= 0.5 && (
          <text
            x={g.vertical ? g.lx + g.out * 12 : g.lx}
            y={g.vertical ? g.ly + 4 : g.ly - 12}
            className="plane"
            style={g.vertical ? { textAnchor: g.out < 0 ? 'end' : 'start' } : undefined}
          >
            +{fmt(plane)} plane
            <title>Worst-case plane change for this transfer, m/s</title>
          </text>
        )}
      </g>
    );
  };

  return (
    <div
      className="dv-view"
      ref={box}
      {...pz.handlers}
      // A click anywhere but on a node drops the route.
      onClick={(ev) => {
        if (!(ev.target as Element).closest('.dv-node')) clear();
      }}
    >
      <svg role="img" aria-label="Delta-v map">
        <g transform={`translate(${pz.view.x},${pz.view.y}) scale(${pz.view.k})`}>
          {trunk && (
            <g className="dv-trunk">
              {/* Dimmed with the rest when a route is picked: the route's own stretch is redrawn. */}
              {/* The ends stop where the last branches' rounded corners take over. */}
              <path
                d={`M${trunkX},${trunk.top + (starRow ? 0 : 16)} V${trunk.bottom - 16}`}
                style={{ stroke: shade(star.data.style.color, !!view) }}
              />
            </g>
          )}
          {/* Between two rows that hang off the same node: along the trunk, not up to the node. */}
          {/* The home branch: from the trunk to the home capture node, no burn of its own. */}
          {homeCap && trunk && (
            <path
              // From the home intercept: the transfers draw the stretch to the trunk with its rounded
              // corners, so no line end shows at the trunk.
              d={`M${trunkX + (homeCap.col - Math.sign(homeCap.col)) * COL},${pos(homeCap).y} H${pos(homeCap).x}`}
              className="dv-line"
              style={{ stroke: shade(star.data.style.color, !!view && !stubOn) }}
            />
          )}
          {/* Lines off the route first, so the route's own lines are never covered. */}
          {[...layout.edges]
            .sort((a, b) => Number(onRoute(a)) - Number(onRoute(b)))
            .map((e) => {
              // Colour by the row a line leaves from, so shared vertical trunks keep one colour; the
              // solar trunk takes the star's colour.
              const color = lineColor(e);
              const on = onRoute(e);
              return (
                <path
                  key={e.id}
                  d={rounded(geometry(e).pts)}
                  className="dv-line"
                  style={{ stroke: shade(color, !!view && !on) }}
                />
              );
            })}
          {homeCap &&
            trunk &&
            preview.has('home-eject') &&
            (() => {
              const y = pos(homeCap).y + 4;
              const ix = trunkX + (homeCap.col - Math.sign(homeCap.col)) * COL;
              return (
                <g className="dv-edge-label">
                  <Pill x={(trunkX + ix) / 2} y={y - 4} text={fmt(preview.get('home-eject')!)} />
                  <text x={(trunkX + ix) / 2} y={y} className="route-value">
                    {fmt(preview.get('home-eject')!)}
                    <title>Ejection toward {graph.system.home.name}</title>
                  </text>
                  {solar.planes.get('home-eject') !== undefined && solar.planes.get('home-eject')! >= 0.5 && (
                    <text x={(trunkX + ix) / 2} y={y - 16} className="plane">
                      +{fmt(solar.planes.get('home-eject')!)} plane
                    </text>
                  )}
                  <Pill x={(ix + pos(homeCap).x) / 2} y={y - 4} text={fmt(preview.get('home-capture')!)} />
                  <text x={(ix + pos(homeCap).x) / 2} y={y} className="route-value">
                    {fmt(preview.get('home-capture')!)}
                    <title>Capture at {graph.system.home.name}</title>
                  </text>
                </g>
              );
            })()}
          {view?.shortcuts.map(({ up, down }) => {
            const a = geometry(up);
            const b = geometry(down);
            return (
              <path
                key={`s-${up.id}`}
                d={rounded([a.b, { x: a.a.x, y: a.b.y }, { x: a.a.x, y: b.b.y }, b.b])}
                className="dv-line"
                style={{ stroke: lineColor(up) }}
              />
            );
          })}
          {layout.edges.map((e) => edgeLabel(e))}
          {layout.rows.map((r) => {
            const last = r.nodes[r.nodes.length - 1]!;
            const p = pos(last);
            const land = landing.get(r.body.id);
            // Names sit beyond the last node, on the outer side; on the left they read leftwards.
            const left = r.side < 0;
            const anchor = left ? 'end' : 'start';
            const nameX = p.x + (left ? -18 : 18);
            return (
              <g key={`n-${r.body.id}`} textAnchor={anchor}>
                <text x={nameX} y={p.y + 6} className="dv-body-name">
                  {r.body.name}
                </text>
                {land && (
                  <text x={nameX} y={p.y + 22} className="dv-land">
                    {fmt(land.total)}
                    {land.orbitOnly ? ' to orbit' : ''}
                    <title>{`From ${departure ? nodeLabel(graph.node(departure)) : `${graph.system.home.name}'s surface`} to ${r.body.name}'s ${land.orbitOnly ? 'low orbit' : 'surface'}${roundTrip ? ' and back' : ''}, with the calculator settings, m/s`}</title>
                  </text>
                )}
                {land && land.worst - land.total >= 5 && (
                  <text x={nameX} y={p.y + 35} className="dv-land worst">
                    {fmt(land.worst)}
                    <title>Worst case, with the plane changes included, m/s</title>
                  </text>
                )}
              </g>
            );
          })}
          {[...layout.nodes.values()].map((n) => {
            const node = graph.node(n.id);
            const p = pos(n);
            const state = n.id === from ? ' from' : n.id === to ? ' to' : route?.nodes.includes(n.id) ? ' via' : '';
            return (
              <g
                key={n.id}
                className={`dv-node${state}${n.sub ? ' sub' : ''}`}
                transform={`translate(${p.x},${p.y})`}
                onClick={() => pick(n.id)}
                onPointerEnter={hoverAt(node)}
                onPointerLeave={() => setHover(null)}
                role="button"
                tabIndex={0}
                aria-label={nodeLabel(node)}
                onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && pick(n.id)}
              >
                <circle r={14} className="hit" />
                <g transform={n.sub ? 'scale(0.85)' : undefined}>
                  {/* The star's arrival is an ellipse down to periapsis: drawn like a capture. */}
                  <NodeIcon kind={node.kind === 'intercept' && !node.body.parent ? 'capture' : node.kind} />
                </g>
                {/* The row's last node sits by the body's name, and its ring says what it is. */}
                {n.sub
                  ? subLabel(node)
                  : !rowEnds.has(n.id) &&
                    // On the star's vertical row the line runs through below, so the name goes beside.
                    (starRow?.nodes.some((m) => m.id === n.id) ? (
                      <text x={16} y={4} style={{ textAnchor: 'start' }}>
                        {shortLabel(node)}
                      </text>
                    ) : (
                      <text y={25}>{shortLabel(node)}</text>
                    ))}
                {!n.sub &&
                  (() => {
                    const d = detail(node);
                    if (!d) return null;
                    // On the star's row: beside the node, left of the low orbit (its name is on the right).
                    const end = rowEnds.has(n.id);
                    return starRow?.nodes.some((m) => m.id === n.id) ? (
                      <text
                        x={end ? -16 : 16}
                        y={end ? 4 : 17}
                        className="detail"
                        style={{ textAnchor: end ? 'end' : 'start' }}
                      >
                        {d}
                      </text>
                    ) : (
                      <text y={end ? 25 : 37} className="detail">
                        {d}
                      </text>
                    );
                  })()}
                <title>{nodeLabel(node)}</title>
              </g>
            );
          })}
          {/* The home world's intercept: where arrivals from the other planets enter its SOI. Every
              planet has its own intercept node in the graph; on the map they share this one. */}
          {homeCap &&
            trunk &&
            (() => {
              const col = homeCap.col - Math.sign(homeCap.col);
              const node: DvNode = { id: 'home-intercept', body: graph.system.home, kind: 'intercept' };
              return (
                <g
                  className={`dv-node${stubOn ? ' via' : ''}`}
                  transform={`translate(${trunkX + col * COL},${pos(homeCap).y})`}
                  onPointerEnter={hoverAt(node)}
                  onPointerLeave={() => setHover(null)}
                  aria-label={`${graph.system.home.name} intercept`}
                >
                  <circle r={14} className="hit" />
                  <NodeIcon kind="intercept" />
                  <text y={25}>Intercept</text>
                  <title>{`${graph.system.home.name} intercept: arrivals from the other planets enter the SOI here`}</title>
                </g>
              );
            })()}
        </g>
      </svg>
      {hover && (
        <OrbitCard
          node={hover.node}
          // Beside the pointer, flipped to the other side near the right or bottom edge.
          x={hover.x + (hover.x > (box.current?.clientWidth ?? 0) - 520 ? -196 : 16)}
          y={Math.min(hover.y + 16, (box.current?.clientHeight ?? 0) - 230)}
        />
      )}
      <Legend sync={graph.withSync} />
      <div className="dv-zoom panel" onClick={(ev) => ev.stopPropagation()}>
        <button onClick={() => pz.zoomBy(1.4)} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => pz.zoomBy(1 / 1.4)} aria-label="Zoom out">
          −
        </button>
        <button onClick={pz.fit} aria-label="Fit the whole map">
          Fit
        </button>
      </div>
    </div>
  );
}

const LEGEND: { kind: NodeKind; label: string }[] = [
  { kind: 'intercept', label: 'Intercept: entering the SOI' },
  { kind: 'capture', label: 'Capture/Escape: elliptical orbit to the SOI edge' },
  { kind: 'syncTransfer', label: 'Transfer up to synchronous orbit' },
  { kind: 'sync', label: 'Synchronous orbit' },
  { kind: 'low', label: 'Low orbit' },
  { kind: 'surface', label: 'Surface' },
];

/** What the rings and marks on the lines mean. */
function Legend({ sync }: { sync: boolean }) {
  return (
    <div className="dv-legend panel" onClick={(ev) => ev.stopPropagation()}>
      {LEGEND.filter((l) => sync || (l.kind !== 'sync' && l.kind !== 'syncTransfer')).map((l) => (
        <div key={l.kind} className="dv-node">
          <svg width={26} height={26} viewBox="-13 -13 26 26" aria-hidden>
            <NodeIcon kind={l.kind} />
          </svg>
          {l.label}
        </div>
      ))}
      <div>
        <span className="sym">▷</span>Aerobraking possible (▶ when counted)
      </div>
      <div>
        <span className="sym">P</span>Parachute landing possible
      </div>
      <div>
        <span className="sym plane">+N</span>Worst-case plane change
      </div>
      <div>
        <svg width={26} height={26} viewBox="-13 -13 26 26" aria-hidden>
          <rect className="dv-pill" x={-12} y={-7} width={24} height={14} rx={7} />
        </svg>
        Changes with the departure you pick
      </div>
    </div>
  );
}

/** Room the floating panels take: the toolbar on the left, the route panel on the right. */
function panelInsets() {
  if (typeof window === 'undefined' || window.innerWidth <= 720) return { top: 150, right: 8, bottom: 8, left: 8 };
  return { top: 16, right: 330, bottom: 64, left: 16 };
}

function shortLabel(n: DvNode): string {
  switch (n.kind) {
    case 'surface':
      return 'Surface';
    case 'low':
      return 'Low orbit';
    case 'syncTransfer':
      return 'Transfer';
    case 'sync':
      return 'Synchronous';
    case 'syncCapture':
      return 'High capture';
    case 'capture':
      return 'Capture/Escape';
    case 'intercept':
      return n.body.parent ? 'Intercept' : 'Periapsis';
  }
}

/** Route total and legs. */
export function DvPanel() {
  const { graph } = useDvGraph();
  const options = useOptions();
  const { from, to, swap, clear } = useDvStore();
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 720);
  const { route, back, total } = useRoutes(graph, options);
  const legs = (r: Route) =>
    routeLegs(graph, r.edges, options).map((leg) => (
      <li key={leg.id}>
        <span>{leg.label}</span>
        <span className="num">{fmt(leg.dv)}</span>
      </li>
    ));
  const showOnMap = () => {
    const target = to ?? from;
    if (!target) return;
    const s = useMapStore.getState();
    s.setFocus(graph.node(target).body.id);
    s.setPage('map');
  };

  return (
    <aside className="panel info-panel dv-panel" aria-label="Delta-v route">
      <header onClick={() => setOpen(!open)} aria-expanded={open} role="button" tabIndex={0}>
        <span className="dot" style={{ background: 'var(--route-start)' }} />
        <h2>{route ? `${fmt(total)} m/s` : 'Δv route'}</h2>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        <span className="kind">
          {!from
            ? 'Click a node to start a route'
            : !to
              ? `From ${nodeLabel(graph.node(from))}: pick a destination`
              : `${nodeLabel(graph.node(from))} ${back ? '⇄' : '→'} ${nodeLabel(graph.node(to))}`}
        </span>
      </header>
      {open && (
        <>
          {from && (
            <p className="dv-ends">
              <span className="dot start" /> {nodeLabel(graph.node(from))}
              {to && (
                <>
                  <br />
                  <span className="dot end" /> {nodeLabel(graph.node(to))}
                </>
              )}
            </p>
          )}
          {route && back && (
            <h3 className="dv-leg-head">
              There<span className="num">{fmt(route.total)}</span>
            </h3>
          )}
          {route && <ol className="dv-legs">{legs(route)}</ol>}
          {back && (
            <>
              <h3 className="dv-leg-head">
                Back<span className="num">{fmt(back.total)}</span>
              </h3>
              <ol className="dv-legs">{legs(back)}</ol>
            </>
          )}
          {from && (
            <div className="dv-actions">
              <button onClick={swap} disabled={!to}>
                Swap
              </button>
              <button onClick={clear}>Clear</button>
              <button onClick={showOnMap}>Show on map</button>
            </div>
          )}
          <p className="dv-note">
            Generated from the system data with Hohmann transfers between circular orbits; expect a few percent off
            in-game. Capture nodes are orbits with periapsis at low orbit and apoapsis at the edge of the sphere of
            influence.
          </p>
        </>
      )}
    </aside>
  );
}

const SETTINGS: { key: keyof DvSettings; label: string; hint: string }[] = [
  { key: 'roundTrip', label: 'Round trip', hint: 'Totals include the way back to the start.' },
  { key: 'aerobrake', label: 'Aerobraking (A)', hint: 'Captures and circularizations use the atmosphere.' },
  { key: 'chutes', label: 'Parachutes (P)', hint: 'Landings in an atmosphere cost only the deorbit burn.' },
  {
    key: 'planeChanges',
    label: 'Plane changes',
    hint: 'The route counts the worst case (full inclination gap, burned at the slowest point). The map keeps showing them as +N.',
  },
  {
    key: 'sync',
    label: 'Synchronous orbits',
    hint: 'Show the high capture, transfer and synchronous orbit nodes.',
  },
];

/** What the calculator counts: applies to the route, the map's numbers and the totals next to each name. */
export function DvSettingsPanel() {
  const { graph } = useDvGraph();
  const store = useDvStore();
  // Closed by default so it doesn't cover the map; the summary line says what's on.
  const [open, setOpen] = useState(false);
  const on = SETTINGS.filter((s) => s.key !== 'sync' && store[s.key]).map((s) => s.label.replace(/ \(.\)$/, ''));
  if (!store.sync) on.push('no synchronous orbits');
  return (
    <aside className="panel info-panel dv-settings" aria-label="Calculator settings">
      <header onClick={() => setOpen(!open)} aria-expanded={open} role="button" tabIndex={0}>
        <h2>Calculator</h2>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        {!open && <span className="kind">{on.length ? on.join(' · ') : 'One way, all powered'}</span>}
      </header>
      {open && (
        <>
          {SETTINGS.map((s) => (
            <label key={s.key} className="dv-toggle">
              <input
                type="checkbox"
                checked={store[s.key]}
                onChange={(e) => store.setSetting(s.key, e.target.checked)}
              />
              <span>
                {s.label}
                <small>{s.hint}</small>
              </span>
            </label>
          ))}
          <AscentTable graph={graph} />
        </>
      )}
    </aside>
  );
}

function AscentTable({ graph }: { graph: DvGraph }) {
  const overrides = useDvStore((s) => s.overrides);
  const setOverride = useDvStore((s) => s.setOverride);
  const [open, setOpen] = useState(false);
  const bodies = graph.system.bodies.filter((b) => b.parent && hasSurface(b));
  return (
    <section className="dv-ascent">
      <button className="panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Landing and ascent ▾' : 'Landing and ascent ▸'}
      </button>
      {open && (
        <table>
          <tbody>
            {bodies.map((b) => {
              const base = ascentCost(b);
              const current = ascentCost(b, overrides[b.id]);
              return (
                <tr key={b.id}>
                  <th>
                    <span className="dot" style={{ background: b.data.style.color }} /> {b.name}
                  </th>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      aria-label={`${b.name} ascent, m/s`}
                      placeholder={fmt(base.value)}
                      value={overrides[b.id] ?? ''}
                      onChange={(e) => setOverride(b.id, e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </td>
                  <td className={`src src-${current.source}`}>{SOURCE_LABEL[current.source]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
