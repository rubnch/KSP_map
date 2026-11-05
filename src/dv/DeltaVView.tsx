import { useMemo, useState } from 'react';
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
} from './graph.ts';
import { layoutDvMap, routeView, type LayoutNode } from './layout.ts';
import { useDvStore } from './store.ts';

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
  const planeChanges = useDvStore((s) => s.planeChanges);
  return useMemo(() => ({ aerobrake, planeChanges }), [aerobrake, planeChanges]);
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
  const route = useMemo(
    () => (from && to && graph.nodes.has(from) && graph.nodes.has(to) ? findRoute(graph, from, to, options) : null),
    [graph, from, to, options],
  );
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
      const plain = findRoute(graph, start, target, { ...options, planeChanges: false });
      const worst = findRoute(graph, start, target, { ...options, planeChanges: true });
      if (plain && worst) out.set(r.body.id, { total: plain.total, worst: worst.total, orbitOnly });
    }
    return out;
  }, [graph, layout, options]);

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
  const shortcutEdges = new Set(view?.shortcuts.flatMap((sc) => [sc.up.id, sc.down.id]));
  const stubOn = layout.edges.some((e) => trunkEdge(e) && view?.edges.has(e.id) && !shortcutEdges.has(e.id));

  const geometry = (e: DvEdge) => {
    const a = pos(layout.nodes.get(e.from)!);
    const b = pos(layout.nodes.get(e.to)!);
    const an = layout.nodes.get(e.from)!;
    const bn = layout.nodes.get(e.to)!;
    // The synchronous orbit's two short legs: label on the outer side of each.
    if (bn.sub || an.sub) {
      const top = bn.sub ? a : b;
      const sub = bn.sub ? b : a;
      const side = top.x < sub.x ? -1 : 1;
      // Beside the sync node, on the side of the node this leg comes from.
      return { d: `M${a.x},${a.y} L${b.x},${b.y}`, lx: sub.x + side * 10, ly: sub.y + 11, anchor: (side < 0 ? 'end' : 'start') as 'end' | 'start', a, b };
    }
    // Transfers from home leave from the trunk, where the home branch joins it.
    if (trunkEdge(e)) {
      const t = { x: trunkX, y: a.y };
      return { d: `M${t.x},${t.y} V${b.y} H${b.x}`, lx: (t.x + b.x) / 2, ly: b.y, anchor: undefined, a: t, b };
    }
    if (an.y === bn.y) return { d: `M${a.x},${a.y} H${b.x}`, lx: (a.x + b.x) / 2, ly: b.y, anchor: undefined, a, b };
    return { d: `M${a.x},${a.y} V${b.y} H${b.x}`, lx: (a.x + b.x) / 2, ly: b.y, anchor: undefined, a, b };
  };

  // "Sync 2,863 km · 1,099": the climb from low orbit, or this route's cost into the orbit.
  const syncLabel = (node: DvNode) => {
    const km = Math.round(((syncOrbitRadius(node.body) ?? 0) - node.body.radius) / 1000).toLocaleString('en-US');
    const up = layout.edges.find((e) => e.to === node.id && !e.link)!;
    const legs = layout.edges.filter((e) => e.to === node.id || e.from === node.id);
    const routed = legs.find((e) => view?.labels.has(e.id));
    const value = routed ? view!.labels.get(routed.id) : edgeCost(up, options);
    return (
      <text y={17}>
        Sync {km} km ·{' '}
        <tspan className={routed ? 'route-value' : 'sync-cost'}>{value === null || value === undefined ? '—' : fmt(value)}</tspan>
        <title>
          {routed
            ? "This route's cost into or out of the synchronous orbit"
            : `From low orbit: ${up.burns ? `${fmt(up.burns[0])} + ${fmt(up.burns[1])}` : fmt(up.dv)} m/s`}
        </title>
      </text>
    );
  };

  const edgeLabel = (e: DvEdge) => {
    const { lx, ly } = geometry(e);
    const aero = options.aerobrake && e.aeroDv !== undefined;
    const override = view?.labels.get(e.id);
    const hasOverride = view?.labels.has(e.id) ?? false;
    const anchor = geometry(e).anchor;
    // The synchronous orbit's legs are labelled under the sync node instead (see syncLabel).
    if (layout.nodes.get(e.to)!.sub || layout.nodes.get(e.from)!.sub) return null;
    return (
      <g key={`l-${e.id}`} className="dv-edge-label">
        <text x={lx} y={ly - 7} textAnchor={anchor} className={hasOverride ? 'route-value' : undefined}>
          {hasOverride ? (override === null ? '—' : fmt(override!)) : fmt(edgeCost(e, options))}
          {!hasOverride && e.aeroDv !== undefined && <tspan className="aero-mark">{aero ? ' ✓A' : ' A'}</tspan>}
          <title>
            {hasOverride
              ? override === null
                ? 'Coasting: no burn here on this route'
                : 'This route\'s cost for this leg'
              : e.aeroDv !== undefined
                ? `Aerobraking possible: ${fmt(e.dv)} m/s powered, ${fmt(e.aeroDv)} m/s with aerobraking`
                : `${fmt(e.dv)} m/s`}
            {!hasOverride && e.source ? ` (${SOURCE_LABEL[e.source]})` : ''}
            {!hasOverride && e.burns ? ` (burns: ${fmt(e.burns[0])} + ${fmt(e.burns[1])})` : ''}
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
      // A click anywhere but on a node drops the route.
      onClick={(ev) => {
        if (!(ev.target as Element).closest('.dv-node')) clear();
      }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Delta-v map">
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
                  <title>{`From ${graph.system.home.name}'s surface to ${r.body.name}'s ${land.orbitOnly ? 'low orbit' : 'surface'}, m/s`}</title>
                </text>
              )}
              {land && land.worst - land.total >= 5 && (
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
              role="button"
              tabIndex={0}
              aria-label={nodeLabel(node)}
              onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && pick(n.id)}
            >
              <circle r={13} className="hit" />
              <circle r={node.kind === 'surface' ? 7 : n.sub ? 4.5 : 5.5} style={{ fill: node.body.data.style.color }} />
              {n.sub ? (
                syncLabel(node)
              ) : (
                <text y={20}>{shortLabel(node)}</text>
              )}
              <title>{nodeLabel(node)}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function shortLabel(n: DvNode): string {
  switch (n.kind) {
    case 'surface':
      return 'Surface';
    case 'low':
      return 'Low orbit';
    case 'sync':
      return 'Synchronous';
    case 'capture':
      return 'Capture';
    case 'intercept':
      return 'Intercept';
  }
}

/** Route total and legs, options, and the editable ascent / landing values. */
export function DvPanel() {
  const { graph } = useDvGraph();
  const options = useOptions();
  const { from, to, swap, clear, setAerobrake, setPlaneChanges } = useDvStore();
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 720);
  const route = from && to && graph.nodes.has(from) && graph.nodes.has(to) ? findRoute(graph, from, to, options) : null;
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
        <h2>{route ? `${fmt(route.total)} m/s` : 'Δv route'}</h2>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        <span className="kind">
          {!from
            ? 'Click a node to start a route'
            : !to
              ? `From ${nodeLabel(graph.node(from))}: pick a destination`
              : `${nodeLabel(graph.node(from))} → ${nodeLabel(graph.node(to))}`}
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
          {route && (
            <ol className="dv-legs">
              {route.edges.map((e) => (
                <li key={e.id}>
                  <span>{legLabel(graph, e, options)}</span>
                  <span className="num">{fmt(edgeCost(e, options))}</span>
                </li>
              ))}
            </ol>
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
          <label className="dv-toggle">
            <input type="checkbox" checked={options.aerobrake} onChange={(e) => setAerobrake(e.target.checked)} />
            Aerobrake where there is an atmosphere (A)
          </label>
          <label className="dv-toggle">
            <input type="checkbox" checked={options.planeChanges} onChange={(e) => setPlaneChanges(e.target.checked)} />
            Include plane changes (worst case: full inclination gap, at the slowest point)
          </label>
          <AscentTable graph={graph} />
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
