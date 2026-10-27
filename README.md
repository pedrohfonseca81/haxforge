<div align="center">

<img src="docs/logo.svg" alt="haxforge logo" width="96" height="96">

# haxforge

**English** · [Português](README.pt-BR.md) · [Español](README.es.md)

**A modern, visual HaxBall stadium editor that runs in your browser.**<br>
Build from scratch, generate a field in seconds, or open any `.hbs` file and edit it without losing a single comma of formatting.

[**Open the editor →**](https://pedrohfonseca81.github.io/haxforge/) · [**Discord Community →**](https://discord.gg/ZTu7zwgvhm)

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/ZTu7zwgvhm)
[![Deploy](https://github.com/pedrohfonseca81/haxforge/actions/workflows/pages.yml/badge.svg)](https://github.com/pedrohfonseca81/haxforge/actions/workflows/pages.yml)

<img src="docs/screenshots/editor.webp" alt="The editor with Futsal x3 open: layers on the left, canvas in the center, inspector on the right" width="100%">

</div>

## What it does that other editors don't

<table>
<tr>
<td width="50%" valign="top">

### True text banners

Type any text and it turns into segments on the field. The built-in font, **Haxforge Sans**, is made of lines and **native HaxBall arcs**: an "O" costs just 4 vertexes and 4 segments and stays smooth at any zoom. Rotation, bend (curved text along an arc), multi-line, accents, decorative or solid.

**46 fonts** in a gallery with live preview of your text and exact segment cost: 15 single-stroke fonts (Hershey and EMS: sans, serif, script, gothic, techno), 30 from Google Fonts (Bebas Neue, Anton, Press Start 2P, Pacifico…), plus your own TTF/OTF/WOFF uploads.

</td>
<td width="50%"><img src="docs/screenshots/letreiro.webp" alt="HAXBOOK text banner drawn on the futsal field"></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/launcher.webp" alt="Playground with ball launcher and predicted trajectory"></td>
<td width="50%" valign="top">

### Play the map without leaving the editor

The playground runs HaxBall's exact physics and netcode (via [kickr](#credits)) right inside the browser, with no server. **`/extrapolation` and `/lag` actually work**, showing ping, confirmed frame, and rendered frame on screen. Pause, frame-by-frame step, slow motion, **10 s rewind**, ball launcher with predicted trajectory, and a local second player.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Live editing and physics linter

Editor and game side-by-side: every edit reloads the map **without stopping the match**. The linter finds **gaps where the ball or players can escape** (using each body's actual radius and the exact physics collision rules, including bare segment ends without vertexes), bodies spawning inside walls, duplicate segments, and more, with one-click fixes.

</td>
<td width="50%"><img src="docs/screenshots/lado-a-lado.webp" alt="Editor and playground side-by-side, with the issues tab open"></td>
</tr>
</table>

## Everything included

**Lossless file handling**
- Importing a `.hbs` and exporting without changes returns **the exact same file, byte for byte**: comments, JSON5 syntax, traits, unknown fields, and formatting.
- New items match the file's existing style (minified, one object per line, or indented). Index comments (`/* 12 */`) are renumbered automatically.

**Editing**
- **Tools:** chained segments, vertex, disc, goal, plane, joint, and spawn points.
- **Precision:** grid, snap to vertexes, midpoints, and intersections, alignment guides, `Shift` locks 15° angles, and direct length/angle entry (`120` or `120<45`). Curve any segment by dragging its center diamond.
- **Layers = real array order.** Reordering automatically remaps `v0/v1` and `d0/d1` indices.
- **Inspector:** shows where every value comes from (object, trait, or HaxBall default), with reset and "push to trait". Numeric fields accept math expressions (`370/2`) and label scrubbing.
- **255-limit meter** per object type, always visible.

**Smart objects** (store parameters and regenerate in place)
- **Field generator:** Classic, Big, Futsal, Real Soccer, and Hockey/arena, controlled by sliders. All five pass the linter with zero gaps.
- **Live symmetry** (↔, ↕, 4 quadrants) and linear or circular **repeat**: copies follow the original as you edit, flipping curves, bias, and teams properly.
- **SVG and images:** imported and redrawn with simplification and arc fitting (a circle costs 2 segments). PNG/JPG images are traced first with a live preview.
- **Patterns:** striped grass, grid, and dots along an arc.
- **Optimizer:** merges duplicate vertexes, fuses collinear segments, replaces polylines with arcs (a 36-segment ring becomes 2), and previews the savings before applying.

**Physics at a glance** (Physics menu)
- Color by collision: see what each wall blocks.
- Bias thickness and direction.
- Inflated walls (Minkowski sum) for the ball or a team, showing where the center of a body cannot reach.

**Projects & Internationalization**
- Browser autosave, unlimited undo, and named **versions** with one-click restore.
- **Shareable map link:** compresses the `.hbs` directly into the URL hash, no server required.
- Built-in HaxBall stadium templates ready to open.
- **Bilingual UI (Portuguese / English):** defaults to Portuguese for users in Brazil and English everywhere else, with an instant toggle in the top bar.

<div align="center"><img src="docs/screenshots/paleta.webp" alt="Command palette (Ctrl+K)" width="80%"></div>

## Shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| `V` | Select | `Ctrl+K` | Command palette |
| `S` | Segment | `Ctrl+Enter` | Play |
| `X` | Vertex | `Ctrl+Shift+Enter` | Play side-by-side |
| `D` | Disc | `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `G` | Goal | `Ctrl+D` | Duplicate |
| `P` | Plane | `Ctrl+E` | Export `.hbs` |
| `J` | Joint | `Shift+1` | Fit map to screen |
| `R` / `B` | Red / blue spawn | `Space` + drag | Pan view |
| `T` | Text banner | `Alt` + drag | Duplicate while dragging |

In the playground: Arrows/WASD move and `X`/`Space` kick. `P` pauses, `.` steps one frame, and `Enter` opens commands (`/extrapolation`, `/lag`, `/speed`, `/reset`, `/p2`).

## AI Agents (WebMCP)

The editor registers **25 tools** for browser-based AI agents via [WebMCP](https://webmachinelearning.github.io/webmcp/) (`document.modelContext.registerTool`, also supporting the earlier `navigator.modelContext` draft).
- **What an agent can do:** read the map and lint issues, generate fields, draw paths, write text banners, mirror objects, optimize geometry, **simulate shots using the real physics engine**, and export.
- **User control:** every agent action is recorded in the undo history (`Ctrl+Z` undoes it) and listed in the robot button panel, where WebMCP access can be toggled off at any time.
- WebMCP is a W3C Community Group draft. In browsers without it, nothing changes.

## Development

```sh
bun install
bun dev          # http://localhost:5174
bun test         # lossless round-trip, physics, linter, smart objects, i18n, WebMCP
bun run build    # static site in dist/
```

Every push to `main` deploys the site to GitHub Pages ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)). Design notes and architecture decisions are documented in [PLAN.md](PLAN.md).

<details>
<summary>Code structure</summary>

- `src/doc/`: document layer.
  - `cst.ts`: concrete syntax tree JSON5 parser.
  - `print.ts` & `style.ts`: lossless printer and formatting detector.
  - `model.ts` & `ops.ts`: document model and operations with automatic index remapping.
  - `lint.ts`, `resolve.ts`, `fields.ts`, and `bodies.ts`.
- `src/editor/`: state and undo history, tools, snapping, canvas renderer, actions, versions.
- `src/smart/`: smart objects.
  - `text.ts` & `font.ts`: text banners and built-in arc font.
  - `field.ts`: parametric field generator.
  - `svg.ts` & `trace.ts`: SVG import and raster image tracing.
  - `pattern.ts`, `optimize.ts`, and `smart.ts`.
- `src/play/`: playground (kickr room and client over a simulated network, with virtual clock and rewind).
- `src/agent/`: WebMCP agent tools.
- `src/persist/`: IndexedDB storage (projects, versions, fonts) and compressed URL sharing.
- `src/ui/`: Preact screens and panels.
- `src/i18n.ts`: internationalization (Brazil -> `pt`, other countries -> `en`).
- `src/vendor/kickr/`: kickr engine (bit-exact HaxBall physics). See `VENDOR.md`.

</details>

## Credits

- Physics, rules, netcode, and classic renderer come from **kickr**, a bit-for-bit verified HaxBall reimplementation.
- Template stadiums were exported from HaxBall itself. **Futsal x3** is by Bazinga (HaxMaps).
- Single-stroke fonts are **Hershey** (Dr. A. V. Hershey, U.S. National Bureau of Standards) and **EMS** by Evil Mad Scientist (SIL OFL), via [hersheytext](https://github.com/techninja/hersheytextjs). Full notices in [`src/smart/STROKE_FONTS.md`](src/smart/STROKE_FONTS.md). Google Fonts are loaded from the [Fontsource](https://fontsource.org) CDN.
- HaxBall is by Mario Carbajal (basro). haxforge is an independent fan project.
