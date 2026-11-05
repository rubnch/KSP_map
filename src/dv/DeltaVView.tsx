import { useMemo, useRef, useState } from 'react';
import { useMapStore } from '../state/store.ts';
import { ascentCost, hasSurface, syncOrbitRadius, type AscentSource } from './physics.ts';
import {
  DvGraph,
  edgeCost,
  findRoute,
  legLabel,
  nodeId,
  nodeLabel,
  type DvEdge,
  type DvNode,
  type DvOptions,
  type Route,
} from './graph.ts';
import { layoutDvMap, routeView, type LayoutNode } from './layout.ts';
import { OrbitCard } from './OrbitCard.tsx';
import { usePanZoom } from './panzoom.ts';
import { useDvStore, type DvSettings } from './store.ts';

const COL = 98;
const ROW = 52;
const PAD_X = 28;
const PAD_Y = 56;
const NAME_W = 190;

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

const SOURCE_LABEL: Record<AscentSource, string> = {
  override: 'your value',
  pack: 'community',
  computed: 'computed',
  estimated: 'estimate',
};

function useDvGraph() {
  const system = useMapStore((s) => s.system);
  const overrides = useDvStore((s) => s.overrides);
  const graph = useMemo(() => new DvGraph(system, overrides), [system, overrides]);
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
  const options = useOptions();
  const from = useDvStore((s) => s.from);
  const to = useDvStore((s) => s.to);
  const pick = useDvStore((s) => s.pick);
  const clear = useDvStore((s) => s.clear);
  const layout = useMemo(() => layoutDvMap(graph), [graph]);
  const roundTrip = useDvStore((s) => s.roundTrip);
  const { route } = useRoutes(graph, options);
  const view = useMemo(
    () => (route ? routeView(layout, route.nodes, route.edges, options) : null),
    [graph, layout, route, options],
  );

  // The trunk sits in the middle, with room for names on both sides.
  const leftRoom = layout.minCol < 0 ? NAME_W : 0;
  const trunkX = PAD_X + leftRoom - layout.minCol * COL;
  const pos = (n: LayoutNode) => ({ x: trunkX + n.col * COL, y: PAD_Y + n.y * ROW });

  // From the home surface to each body's surface (or low orbit for gas giants).
  const landing = useMemo(() => {
    const home = graph.system.home;
    const start = graph.nodes.has(nodeId(home, 'surface')) ? nodeId(home, 'surface') : nodeId(home, 'low');
    const out = new Map<string, { total: number; worst: number; orbitOnly: boolean }>();
    for (const r of layout.rows) {
      if (r.body === home) continue;
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
  }, [graph, layout, options, roundTrip]);

  const width = trunkX + layout.maxCol * COL + NAME_W + PAD_X;
  // The solar trunk: from the first planet branch to the last.
  const star = graph.system.root;
  const trunkEdge = (e: DvEdge) =>
    e.from === nodeId(graph.system.home, 'capture') &&
    graph.node(e.to).kind === 'intercept' &&
    graph.node(e.to).body.parent === star;
  const trunkYs = layout.edges.filter(trunkEdge).map((e) => pos(layout.nodes.get(e.to)!).y);
  const homeCap = layout.nodes.get(nodeId(graph.system.home, 'capture'));
  if (homeCap) trunkYs.push(pos(homeCap).y);
  const trunk = trunkYs.length > 1 ? { top: Math.min(...trunkYs), bottom: Math.max(...trunkYs) } : null;
  const height = PAD_Y * 2 + (layout.height - 1) * ROW;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const pz = usePanZoom(box, { width, height }, panelInsets);
  const shortcutEdges = new Set(view?.shortcuts.flatMap((sc) => [sc.up.id, sc.down.id]));
  const stubOn = layout.edges.some((e) => trunkEdge(e) && view?.edges.has(e.id) && !shortcutEdges.has(e.id));

  const geometry = (e: DvEdge) => {
    const a = pos(layout.nodes.get(e.from)!);
    const b = pos(layout.nodes.get(e.to)!);
    const an = layout.nodes.get(e.from)!;
    const bn = layout.nodes.get(e.to)!;
    // Above the row: from the row node along the row to the spot below, then straight up, with
    // the number halfway up beside the climb, away from the row node. Between two nodes up there:
    // straight across, with the number under the line (their names sit above them).
    if (an.sub && bn.sub) {
      return { d: `M${a.x},${a.y} H${b.x}`, lx: (a.x + b.x) / 2, ly: b.y + 20, anchor: undefined, a, b };
    }
    if (bn.sub || an.sub) {
      const top = bn.sub ? a : b;
      const sub = bn.sub ? b : a;
      const d = bn.sub ? `M${a.x},${a.y} H${b.x} V${b.y}` : `M${a.x},${a.y} V${b.y} H${b.x}`;
      const inner = top.x < sub.x ? -1 : 1;
      const anchor = (inner < 0 ? 'end' : 'start') as 'end' | 'start';
      return { d, lx: sub.x + inner * 6, ly: (top.y + sub.y) / 2 + 11, anchor, a, b };
    }
    // Transfers from home leave from the trunk, where the home branch joins it.
    if (trunkEdge(e)) {
      const t = { x: trunkX, y: a.y };
      return { d: `M${t.x},${t.y} V${b.y} H${b.x}`, lx: (t.x + b.x) / 2, ly: b.y, anchor: undefined, a: t, b };
    }
    if (an.y === bn.y) return { d: `M${a.x},${a.y} H${b.x}`, lx: (a.x + b.x) / 2, ly: b.y, anchor: undefined, a, b };
    return { d: `M${a.x},${a.y} V${b.y} H${b.x}`, lx: (a.x + b.x) / 2, ly: b.y, anchor: undefined, a, b };
  };

  // Names above the nodes over the row.
  const subLabel = (node: DvNode) => (
    <text y={-11}>
      {node.kind === 'sync'
        ? `Sync ${Math.round(((syncOrbitRadius(node.body) ?? 0) - node.body.radius) / 1000).toLocaleString('en-US')} km`
        : shortLabel(node)}
    </text>
  );

  const edgeLabel = (e: DvEdge) => {
    const { lx, ly } = geometry(e);
    const aero = options.aerobrake && e.aeroDv !== undefined;
    const chute = options.chutes && e.chuteDv !== undefined;
    const override = view?.labels.get(e.id);
    const hasOverride = view?.labels.has(e.id) ?? false;
    const anchor = geometry(e).anchor;
    // The link from the capture node to the synchronous orbit has no cost of its own.
    if (e.link && !hasOverride) return null;
    return (
      <g key={`l-${e.id}`} className="dv-edge-label">
        <text
          x={lx}
          y={ly - 7}
          style={anchor ? { textAnchor: anchor } : undefined}
          className={hasOverride ? 'route-value' : undefined}
        >
          {hasOverride ? (override === null ? '—' : fmt(override!)) : fmt(edgeCost(e, options))}
          {!hasOverride && e.aeroDv !== undefined && <tspan className="aero-mark">{aero ? ' ✓A' : ' A'}</tspan>}
          {!hasOverride && e.chuteDv !== undefined && <tspan className="aero-mark">{chute ? ' ✓P' : ' P'}</tspan>}
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
        {!hasOverride && e.plane !== undefined && e.plane >= 5 && !options.planeChanges && (
          <text x={lx} y={ly + 13} className="plane">
            +{fmt(e.plane)} plane
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
              <path d={`M${trunkX},${trunk.top - 22} V${trunk.bottom}`} style={{ stroke: star.data.style.color }} />
              <text x={trunkX} y={trunk.top - 28}>
                {star.name} orbit
              </text>
            </g>
          )}
          {layout.edges.map((e) => {
            // Colour by the row a line leaves from, so shared vertical trunks keep one colour; the
            // solar trunk takes the star's colour.
            const color = trunkEdge(e) ? star.data.style.color : graph.node(e.from).body.data.style.color;
            const on = view?.edges.has(e.id) && !shortcutEdges.has(e.id);
            return (
              <path
                key={e.id}
                d={geometry(e).d}
                className={`dv-line${on ? ' on-route' : ''}`}
                style={{ stroke: on ? undefined : color }}
              />
            );
          })}
          {/* Between two rows that hang off the same node: along the trunk, not up to the node. */}
          {/* The home branch: from the trunk to the home capture node, no burn of its own. */}
          {homeCap && trunk && (
            <path
              d={`M${trunkX},${pos(homeCap).y} H${pos(homeCap).x}`}
              className={`dv-line${stubOn ? ' on-route' : ''}`}
              style={{ stroke: stubOn ? undefined : star.data.style.color }}
            />
          )}
          {view?.shortcuts.map(({ up, down }) => {
            const a = geometry(up);
            const b = geometry(down);
            return (
              <path
                key={`s-${up.id}`}
                d={`M${a.b.x},${a.b.y} H${a.a.x} V${b.b.y} H${b.b.x}`}
                className="dv-line on-route"
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
            const nameX = p.x + (left ? -16 : 16);
            const nx = nameX + (left ? -1 : 1) * (8 + r.body.name.length * 8);
            return (
              <g key={`n-${r.body.id}`} textAnchor={anchor}>
                <text x={nameX} y={p.y + 4} className="dv-body-name">
                  {r.body.name}
                </text>
                {land && (
                  <text x={nx} y={p.y + 1} className="dv-land">
                    {fmt(land.total)}
                    {land.orbitOnly ? ' to orbit' : ''}
                    <title>{`From ${graph.system.home.name}'s surface to ${r.body.name}'s ${land.orbitOnly ? 'low orbit' : 'surface'}${roundTrip ? ' and back' : ''}, with the calculator settings, m/s`}</title>
                  </text>
                )}
                {land && !options.planeChanges && land.worst - land.total >= 5 && (
                  <text x={nx} y={p.y + 14} className="dv-land worst">
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
                onPointerEnter={(ev) => {
                  if (ev.buttons) return;
                  const r = box.current!.getBoundingClientRect();
                  setHover({ id: n.id, x: ev.clientX - r.left, y: ev.clientY - r.top });
                }}
                onPointerLeave={() => setHover(null)}
                role="button"
                tabIndex={0}
                aria-label={nodeLabel(node)}
                onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && pick(n.id)}
              >
                <circle r={13} className="hit" />
                <circle
                  r={node.kind === 'surface' ? 7 : n.sub ? 4.5 : 5.5}
                  style={{ fill: node.body.data.style.color }}
                />
                {n.sub ? subLabel(node) : <text y={20}>{shortLabel(node)}</text>}
                <title>{nodeLabel(node)}</title>
              </g>
            );
          })}
        </g>
      </svg>
      {hover && graph.nodes.has(hover.id) && (
        <OrbitCard
          node={graph.node(hover.id)}
          // Beside the pointer, flipped to the other side near the right or bottom edge.
          x={hover.x + (hover.x > (box.current?.clientWidth ?? 0) - 520 ? -196 : 16)}
          y={Math.min(hover.y + 16, (box.current?.clientHeight ?? 0) - 230)}
        />
      )}
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
      return 'Capture';
    case 'intercept':
      return 'Intercept';
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
    r.edges.map((e) => (
      <li key={e.id}>
        <span>{legLabel(graph, e, options)}</span>
        <span className="num">{fmt(edgeCost(e, options))}</span>
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
    hint: 'Worst case: the full inclination gap, burned at the slowest point.',
  },
];

/** What the calculator counts: applies to the route, the map's numbers and the totals next to each name. */
export function DvSettingsPanel() {
  const { graph } = useDvGraph();
  const store = useDvStore();
  // Closed by default so it doesn't cover the map; the summary line says what's on.
  const [open, setOpen] = useState(false);
  const on = SETTINGS.filter((s) => store[s.key]).map((s) => s.label.replace(/ \(.\)$/, ''));
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
