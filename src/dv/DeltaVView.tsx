import { useMemo, useState } from 'react';
import { useMapStore } from '../state/store.ts';
import { ascentCost, hasSurface, type AscentSource } from './physics.ts';
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
import { layoutDvMap, routeHighlight } from './layout.ts';
import { useDvStore } from './store.ts';

const COL = 124;
const ROW = 52;
const PAD_X = 28;
const PAD_Y = 34;
const NAME_W = 190;

const x = (col: number) => PAD_X + col * COL;
const y = (row: number) => PAD_Y + row * ROW;
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
  const layout = useMemo(() => layoutDvMap(graph), [graph]);
  return { graph, layout };
}

function useOptions(): DvOptions {
  const aerobrake = useDvStore((s) => s.aerobrake);
  const planeChanges = useDvStore((s) => s.planeChanges);
  return useMemo(() => ({ aerobrake, planeChanges }), [aerobrake, planeChanges]);
}

/** The delta-v map: a subway diagram generated from the loaded system, plus the route panel. */
export function DeltaVView() {
  const { graph, layout } = useDvGraph();
  const options = useOptions();
  const from = useDvStore((s) => s.from);
  const to = useDvStore((s) => s.to);
  const pick = useDvStore((s) => s.pick);
  const clear = useDvStore((s) => s.clear);
  const route = useMemo(
    () => (from && to && graph.nodes.has(from) && graph.nodes.has(to) ? findRoute(graph, from, to, options) : null),
    [graph, from, to, options],
  );
  const onRoute = useMemo(
    () => (route ? routeHighlight(graph, layout, route.nodes) : new Set<string>()),
    [graph, layout, route],
  );
  // Launch from the home surface to each body's surface (or low orbit for gas giants).
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
  const width = x(layout.cols - 1) + NAME_W + PAD_X;
  const height = y(layout.rows.length - 1) + PAD_Y;

  const edgeLabel = (e: DvEdge, lx: number, ly: number) => {
    const aero = options.aerobrake && e.aeroDv !== undefined;
    const value = edgeCost(e, options);
    return (
      <g key={`l-${e.id}`} className="dv-edge-label">
        <text x={lx} y={ly - 7} className={e.aeroDv !== undefined ? 'aero' : undefined}>
          {fmt(value)}
          {e.aeroDv !== undefined && <tspan className="aero-mark">{aero ? ' ✓A' : ' A'}</tspan>}
          <title>
            {e.aeroDv !== undefined
              ? `Aerobraking possible: ${fmt(e.dv)} m/s powered, ${fmt(e.aeroDv)} m/s with aerobraking`
              : `${fmt(e.dv)} m/s`}
            {e.source ? ` (${SOURCE_LABEL[e.source]})` : ''}
            {e.burns ? ` (burns: ${fmt(e.burns[0])} + ${fmt(e.burns[1])})` : ''}
          </title>
        </text>
        {e.plane !== undefined && e.plane >= 5 && !options.planeChanges && (
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
        {/* Connectors between rows, then in-row segments. */}
        {layout.edges.map((e) => {
          const a = layout.nodes.get(e.from)!;
          const b = layout.nodes.get(e.to)!;
          // Colour by the row a line leaves from, so shared vertical trunks keep one colour.
          const color = graph.node(e.from).body.data.style.color;
          const d = a.row === b.row ? `M${x(a.col)},${y(a.row)} H${x(b.col)}` : `M${x(a.col)},${y(a.row)} V${y(b.row)} H${x(b.col)}`;
          return (
            <path
              key={e.id}
              d={d}
              className={`dv-line${onRoute.has(e.id) ? ' on-route' : ''}`}
              style={{ stroke: onRoute.has(e.id) ? undefined : color }}
            />
          );
        })}
        {layout.edges.map((e) => {
          const a = layout.nodes.get(e.from)!;
          const b = layout.nodes.get(e.to)!;
          return edgeLabel(e, (x(a.col) + x(b.col)) / 2, y(b.row));
        })}
        {layout.rows.map((r) => {
          const last = r.nodes[r.nodes.length - 1]!;
          const land = r.sync ? undefined : landing.get(r.body.id);
          const home = graph.system.home;
          return (
            <g key={`n-${r.body.id}${r.sync ? '-sync' : ''}`}>
              <text x={x(last.col) + 16} y={y(r.row) + 4} className={r.sync ? 'dv-sync-name' : 'dv-body-name'}>
                {r.sync ? nodeLabel(graph.node(last.id)) : r.body.name}
              </text>
              {land && (
                <text x={x(last.col) + 24 + r.body.name.length * 8} y={y(r.row) + 1} className="dv-land">
                  {fmt(land.total)}
                  {land.orbitOnly ? ' to orbit' : ''}
                  <title>{`From ${home.name}'s surface to ${r.body.name}'s ${land.orbitOnly ? 'low orbit' : 'surface'}, m/s`}</title>
                </text>
              )}
              {land && land.worst - land.total >= 5 && (
                <text x={x(last.col) + 24 + r.body.name.length * 8} y={y(r.row) + 14} className="dv-land worst">
                  {fmt(land.worst)}
                  <title>Worst case, with the plane changes included, m/s</title>
                </text>
              )}
            </g>
          );
        })}
        {[...layout.nodes.values()].map((n) => {
          const node = graph.node(n.id);
          const state = n.id === from ? ' from' : n.id === to ? ' to' : route?.nodes.includes(n.id) ? ' via' : '';
          return (
            <g
              key={n.id}
              className={`dv-node${state}`}
              transform={`translate(${x(n.col)},${y(n.row)})`}
              onClick={() => pick(n.id)}
              role="button"
              tabIndex={0}
              aria-label={nodeLabel(node)}
              onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && pick(n.id)}
            >
              <circle r={13} className="hit" />
              <circle r={node.kind === 'surface' ? 7 : 5.5} style={{ fill: node.body.data.style.color }} />
              <text y={20}>{shortLabel(node)}</text>
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
