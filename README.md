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

Hovering a body shows its sphere of influence. The focused body's orbit shows Ap/Pe and AN/DN markers, and the orbits of the bodies around it (the planets when looking at the Sun) show their Ap/Pe. AN/DN are where the orbit crosses the reference plane its inclination is measured from (Kerbol's equator in stock, which is also Kerbin's orbit and every body's equator). The URL keeps the focused body (`?focus=Duna`) and accepts `?ut=` in seconds.

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
