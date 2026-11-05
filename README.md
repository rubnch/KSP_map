# KSP interactive map

An interactive, browser-based map of Kerbal Space Program planetary systems: navigate like the in-game map view, read a delta-v map generated from the actual system, and browse a timeline of optimal transfer windows. Stock first, then popular planet packs (OPM, JNSQ, RSS, Kcalbeloh).

## Map controls

| Action | Control |
| --- | --- |
| Orbit the camera | Drag (one finger on touch) |
| Zoom | Scroll wheel (pinch on touch) |
| Focus a body | Double-click it, click its label, or pick it in the body list |
| Cycle focus | Tab / Shift+Tab |
| Back to the home world | Backspace |
| Time warp | `.` faster, `,` slower, `/` back to 1× |
| Pause | P |
| Top-down view | 2D button |
| Set the date | Click the clock |

### Delta-v map

The **Δv map** button switches to a delta-v map generated from the loaded system (`?view=dv`). A vertical trunk down the middle stands for solar orbit; planets branch off it in order of distance from the star, alternating sides, with their moons below them. Each body is a row reading outwards: intercept → capture (periapsis at low orbit, apoapsis at the SOI edge) → low orbit → surface. Drag to pan, scroll or pinch to zoom (*Fit* shows the whole map). Click one node, then another, to sum the cheapest route between them; the panel lists each leg. The map stays drawn from the home world; a route between two other bodies runs along it, and only its transfer numbers change (shown in bold: the ejection on the departure body's row, the capture on the arrival body's, `—` where the craft coasts). Click anywhere off a node to clear the route. The **Calculator** menu (saved in the browser) sets what every number counts: round trips (there and back), aerobraking on captures and circularizations (edges marked **A**), parachute landings that cost only the deorbit burn (edges marked **P**), and worst-case plane changes (the full inclination gap burned at the slowest point of the transfer; the exact cost at AN/DN depends on the date and comes with the transfer timeline). Bodies whose synchronous orbit fits between their low orbit and SOI get three nodes above their row, showing both ways in: the **high capture** (periapsis at synchronous altitude, branching off before the capture node) then one burn to circularize, or the usual capture, a burn at low periapsis down to the **transfer** ellipse (also reached from low orbit: Kerbin 668 m/s from LKO), then circularize at the **synchronous orbit** (Kerbin 2,863 km, 431 m/s). From Duna the high capture is cheaper (688 vs 836 m/s). Next to each body name: the total from the home surface to landing there (and back, for round trips) with the calculator settings, and in grey below it the worst case with plane changes when those are off. Transfers are Hohmann between circular orbits at each body's semi-major axis, with the Oberth effect on ejection and capture. Ascent costs for atmospheric bodies come from the pack (community values for stock), are estimated for packs without them, and can be overridden per body under *Landing and ascent* (saved in the browser). Packs can tune the map with an optional `deltaV` block per body: `lowOrbitAltitude`, `ascent` and `hasSurface`.

Hovering a body shows its sphere of influence. The focused body's orbit shows Ap/Pe and AN/DN markers. The URL keeps the focused body (`?focus=Duna`) and accepts `?ut=` in seconds.

## Development

Requires Node 22.

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript project build
npm run build      # static site in dist/
```

## Layout

| Path | What lives there |
| --- | --- |
| `src/core/` | Orbit maths and data types. No UI code. |
| `src/map/` | The 3D / top-down map view (react-three-fiber). |
| `src/dv/` | Delta-v graph, route search, subway layout and the Δv map view. |
| `src/ui/` | Panels and controls around the map. |
| `data/packs/*.json` | One system per file in the unified format. |
| `data/schema/system.schema.json` | JSON Schema every pack is validated against in the tests. |
| `tools/converter/` | (later) Offline converter from Kopernicus configs to packs. |

### Pack format

Every system, stock or modded, is one JSON file following `data/schema/system.schema.json`: pack metadata (source mod and pinned version, calendar, root and home body) and a flat list of bodies. Each body has its parent, physical properties (radius, gravitational parameter, rotation, optional atmosphere and SOI) and Keplerian orbital elements relative to its parent. Units are metres and seconds, and **all angles are degrees** (including mean anomaly at epoch, which KSP itself stores in radians). Bodies use flat colours rather than mod textures, for licensing reasons.

## Branches and deployment

- **`dev`** is where work lands. Pull requests target `dev`, and every push to it deploys to `https://rubnch.github.io/KSP_map/dev/` for testing.
- **`main`** is the stable site at `https://rubnch.github.io/KSP_map/`. Promote by opening a PR from `dev` to `main`.
- Every pull request also gets its own preview at `https://rubnch.github.io/KSP_map/pr-preview/pr-<number>/`, linked in a comment on the PR and deleted when it closes.

Everything is served from the `gh-pages` branch, so Pages is set once to **Deploy from a branch → `gh-pages` / `(root)`**. Workflows:

| File | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | every PR, pushes to `main` and `dev` | typecheck, tests, build |
| `deploy.yml` | pushes to `main` and `dev` | publishes `main` to the root and `dev` to `/dev/` |
| `preview.yml` | PR opened, updated or closed | publishes or removes `/pr-preview/pr-<number>/` |
