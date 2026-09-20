# Build spec — implementation status

Tracks this repository against the Arplace Panel Studio build spec. "Where" points at the code that
satisfies the item.

## MVP (spec §4)

| # | Feature | Status | Where |
| --- | --- | --- | --- |
| 1 | Plot boundary input | **Done**, rectangles | `components/PlotDialog.tsx`, `core/plot.ts` |
| 2 | Canvas with 2 ft grid, pan/zoom, live dimensions | **Done** | `canvas/DesignCanvas.tsx`, `canvas/Annotations.tsx` |
| 3 | Panel placement, snapping, rotate/delete/duplicate/undo | **Done** | `canvas/PanelShape.tsx`, `state/store.ts` |
| 4 | Real-time validation engine | **Done** | `core/validation.ts`, `core/walls.ts` |
| 5 | Live panel counter and BOM | **Done** | `core/bom.ts`, `components/RightRail.tsx` |
| 6 | Cost calculator from admin config | **Done** | `core/pricing.ts`, `components/PricingDialog.tsx` |
| 7 | Minimum-panel helper / auto-fill wall | **Done** | `core/tiling.ts` — it *is* the wall tool |
| 8 | Save / load / version | **Done**, browser-local | `state/storage.ts`, `components/PlansDialog.tsx` |
| 9 | Export PNG / PDF / CSV | **Done**, plus plan and work-order JSON | `export/` |

### Deviations from the spec, and why

- **Plot dimensions round down, not to nearest.** Rounding a parcel *up* would claim land the owner
  does not have. The dialog reports what snapping set aside. (A unit test asserts this.)
- **`orientation: 'h' | 'v'` instead of `rotation: 0 | 90`.** Less error-prone at every call site.
  The parser accepts the `rotation` form on import, so spec-shaped JSON still loads.
- **Gaps are detected by node degree, not by scanning each wall for holes.** A dangling wall end is
  exactly a node with one incident edge. It is one rule instead of a special case per wall, and it
  catches holes the per-wall scan would miss at junctions.
- **No backend.** MVP item 8 asks for plan persistence, which the `PlanRepository` interface
  provides; the Postgres/REST implementation of that interface is Phase 2. Nothing above
  `state/storage.ts` knows where plans live.
- **Roles ship as a UI switch only.** Real access control needs the server that is Phase 2.
  Labelled as such in the code and the README so nobody mistakes it for enforcement.

## Extension spec

| § | Feature | Status |
| --- | --- | --- |
| 1 | Panel categories, category×size pricing, grouped BOM | **Done** |
| 3 | Corner / T / cross connector auto-detection | **Done** |
| 2 | Doors and windows | **Done** |
| 1 | Floor and roof panels (10 ft strip tiling) | **Done** |
| 4 | Image trace-over with scale calibration | **Done** (raster; PDF not read) |
| 5 | 3D view | **Done** |

### Extension deviations

- **§1 floor/roof cannot reuse the 1D coin change.** A floor `4x10` lies flat as a 4 ft × 10 ft
  rectangle (2 × 5 grid units), so both sizes are 5 units in one direction and the footprint only
  tiles exactly when its depth is a multiple of 10 ft. They will lay in 10 ft strips, with the
  existing 1D tiling picking widths within each strip.
- **§3 degree-1 open ends stay a blocking error**, not a warning. A hole in a wall must not read as
  manufacturable.
- **§2 openings are conversions, not insertions.** A door replaces a wall panel in place, keeping
  its size, position and orientation — which is how the factory pre-cuts them, and which removes
  the size-mismatch case entirely. A "split into 2 ft panels" action exists so a 2 ft opening can
  be placed in a run that was auto-tiled with 4 ft panels.
- **§5 uses no CSG and no extrusion.** Openings occupy whole discrete panel slots, so a door is
  built as a header rather than cut out of a solid wall, and every panel is an axis-aligned box.
  That drops a WASM dependency and a lot of machinery for no loss.
- **§5 uses plain Three.js, not react-three-fiber.** r3f currently pins React below the version
  this app runs on and pulls an Expo peer tree behind it. The 3D view is a read-only viewer -- a
  scene rebuilt from the panel list, an orbit camera and raycast picking -- so the dependency was
  not worth downgrading React for.
- **§1 floor/roof footprint comes from a flood fill**, not a polygon: the walls are a graph, not a
  closed ring, and a fill from outside handles any shape and ignores interior partitions for free.
- **An incomplete floor or roof is a blocking error, not a warning.** Once a category has a single
  panel it must reach the whole building, and the uncovered cells are shaded on the plan. The
  honest consequence, stated plainly: a building no axis of which divides by 10 ft — a 16 × 16 ft
  one, say — can never be fully floored, so once a floor exists it cannot read manufacturable until
  it is resized. That is what "panels are never cut" costs. A plan with **no** floor at all is
  untouched: a wall-only plan is a legitimate work in progress.

## Still not built

Multi-storey stacking · DXF export and factory view · branded client-shareable quote links ·
ERP/webhook integration · whole-plan optimisation pass · ML floor-plan recognition · PDF import
(export the page to PNG first) · GeoJSON/KML import · structural and load validation · wall
thickness and interior/exterior typing · collaboration and comments · **roof pitch**.

`toWorkOrder()` already emits the ERP payload, so that integration is a transport problem, not a
modelling one.

## Edge cases (spec §8)

| Case | Handling |
| --- | --- |
| Grid alignment between the two panels | Both tile the same 2 ft module by construction; off-grid coordinates are rejected at import |
| Orientation | 90° only; the 10 ft dimension is wall height and never appears in plan |
| Non-modular plot dimension | Warned in the plot dialog with the nearest buildable lengths above and below |
| Corners and junctions | Auto-detected and separately priced. Panels own edges, connectors own nodes, so nothing is counted twice |
| Door/window grid width | Grid-aligned 2 ft and 4 ft SKUs (§2 option (a)). **Arplace must confirm their real widths** — §6 calls this their decision |
| Wall thickness, interior vs exterior | MVP models the centreline with no thickness; Phase 2 |
| Shared party walls | One set of panels covers a shared wall; a second set on the same edges is an overlap error (tested) |
| Pricing correctness | Never hard-coded; dated schedule, effective date on every quote |
| Units | Feet at the edges, integer 2 ft units internally — no floating-point drift |
| Floor or roof that cannot reach the whole building | Blocking error with the bare area in sq ft, the uncovered cells shaded on the plan, and the nearest buildable depth |

## Test coverage

228 unit tests across `core/`, `state/`, `three/` and `canvas/view.ts`, plus a Playwright drive of the built app that
exercises drawing, selection, deletion, undo, the placement guards, pricing, all five exports, save
and reopen, and the read-only client view. Drawing a 20 × 16 ft room in the browser produces the
same 18 panels / 72 linear ft the unit tests assert.

The browser drive is not a formality — it is what caught the corner-click, `nearestEdge` and
PDF-encoding bugs, and in this round two more that no unit test would have: a marquee left open
when the mouse is released off-canvas, and a space-drag pan silently clearing the selection.
