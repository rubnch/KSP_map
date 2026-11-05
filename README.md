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

The **Δv map** button switches to a delta-v map generated from the loaded system (`?view=dv`). A vertical trunk down the middle stands for solar orbit; planets branch off it in order of distance from the star, alternating sides, with their moons below them. Each body is a row reading outwards: intercept → capture (periapsis at low orbit, apoapsis at the SOI edge) → low orbit → surface. It is drawn like the community subway maps: thick lines in each body's colour with the numbers inside them, rounded corners, and white rings whose inside sketches the orbit (a legend sits in the corner); aerobraking shows as an arrow in the line, hollow when possible and filled when counted. Drag to pan, scroll or pinch to zoom (*Fit* shows the whole map). Hover a node to see a sketch of the orbit it stands for. Click one node, then another, to sum the cheapest route between them; the panel lists each leg. The map stays drawn from the home world; a route between two other bodies runs along it, and only its transfer numbers change (shown in a light tag, on the destination's row: its trunk line carries the ejection, its intercept line the capture; legs the craft coasts through show no number). As soon as a start is picked, the interplanetary numbers switch to its planet: each planet's trunk line shows the ejection toward it, its intercept line the capture there. Click anywhere off a node to clear the route. The **Calculator** menu (saved in the browser) sets what every number counts: round trips (there and back), aerobraking on captures and circularizations (edges marked **A**), parachute landings that cost only the deorbit burn (edges marked **P**), and worst-case plane changes (shown as `+N plane` under every transfer when off; the full inclination gap burned at the slowest point of the transfer; the exact cost at AN/DN depends on the date and comes with the transfer timeline). Bodies whose synchronous orbit fits between their low orbit and SOI get a **transfer** node on the line between capture and low orbit (the Hohmann ellipse up to synchronous altitude: Kerbin 668 m/s from LKO, 276 from the capture, which add up to the 944 escape), the **synchronous orbit** straight above it (2,863 km, 431 m/s to circularize), and a **high capture** (periapsis at synchronous altitude) above the capture node, reached from the intercept, one burn from the synchronous orbit. From Duna the high capture is cheaper (688 vs 836 m/s). They are off by default; the calculator menu turns them on. The star sits at the top: the trunk carries on straight up through its intercept to a low orbit around it (a Hohmann down from each planet). The home world's row has an intercept node like the others, standing for arrivals from every other planet. Next to each body name: the total from the home surface (or from the picked departure, once there is one) to landing there (and back, for round trips) with the calculator settings, and in grey below it the worst case with plane changes when those are off. Transfers are Hohmann between circular orbits at each body's semi-major axis, with the Oberth effect on ejection and capture. Ascent costs for atmospheric bodies come from the pack (community values for stock), are estimated for packs without them, and can be overridden per body under *Landing and ascent* (saved in the browser). Packs can tune the map with an optional `deltaV` block per body: `lowOrbitAltitude`, `ascent` and `hasSurface`.

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
