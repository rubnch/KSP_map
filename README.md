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

Hovering a body shows its sphere of influence. The focused body's orbit shows Ap/Pe and AN/DN markers. The URL keeps the focused body (`?focus=Duna`) and accepts `?ut=` in seconds.

### Transfer planner

The **Transfer planner** button above the clock (or `?transfers` in the URL) opens a full-screen page, and pauses the clock. Pick an origin (the home world by default, or any body with siblings) and its parking orbit altitude. The **timeline** shows the next windows to every other body around the same parent: each bar spans the departure dates within 10% of the window's best Δv, the diamond marks the best date, the cheapest window in view is highlighted, and ◀ Now ▶ page through the years. Dragging along it moves the clock. Click a window to select it, or a body's name for its **porkchop plot** (departure date against flight time, coloured by Δv; click any point to pick that transfer). The side panel draws the selected transfer top-down, with the phase angle and the plane change burn, and lists the dates, the Δv split (ejection, mid-course plane change, capture), v∞, the phase angle against the Hohmann ideal, and the ejection angle and inclination to fly it by hand. **Show on map** goes back to the map in 2D, framed on both orbits at the departure date, with the transfer drawn and a ship that moves along it as time passes; the strip above the clock jumps to departure or arrival, reopens the planner, or removes the transfer.

Windows are found in two steps: circular-orbit maths predicts when each one opens (the phase angle equals the Hohmann phase angle, once per synodic period), then a Lambert solver (Izzo's algorithm) searches around each prediction on the real, eccentric and inclined orbits. **Optimal** takes the cheaper of a direct transfer and one flown in the origin's plane with a plane change burn on the way (**Ballistic** allows only the direct one); that burn is the date-specific plane change cost. Ejection and capture use circular parking orbits at each body's low orbit, the same one the Δv map uses (the pack's `deltaV.lowOrbitAltitude`, else 10 km above the atmosphere, else 5% of the radius; the departure orbit can be changed in the panel), and the speed at the SOI edge, like alexmoon's Launch Window Planner, whose stock Kerbin → Duna windows the tests reproduce to within 0.1 m/s. The searches run in Web Workers and are cached per pack. Lambert solutions are single-revolution only.

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
| `src/ui/` | Panels and controls around the map. |
| `src/transfer/` | Lambert solver, transfer windows, porkchop plots, the timeline and the transfer arc. |
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
