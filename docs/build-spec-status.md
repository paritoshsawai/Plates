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

## Phase 2 (spec §5) — not built

Doors and windows · multi-storey stacking · DXF export and factory view · branded client-shareable
quote links · ERP/webhook integration · whole-plan optimisation pass · survey-image tracing and
GeoJSON/KML import · structural and load validation · wall thickness and interior/exterior typing ·
collaboration and comments.

`toWorkOrder()` already emits the ERP payload, so that integration is a transport problem, not a
modelling one.

## Edge cases (spec §8)

| Case | Handling |
| --- | --- |
| Grid alignment between the two panels | Both tile the same 2 ft module by construction; off-grid coordinates are rejected at import |
| Orientation | 90° only; the 10 ft dimension is wall height and never appears in plan |
| Non-modular plot dimension | Warned in the plot dialog with the nearest buildable lengths above and below |
| Corners and junctions | Panels own edges, junctions are dimensionless nodes — no double-counting |
| Wall thickness, interior vs exterior | MVP models the centreline with no thickness; Phase 2 |
| Shared party walls | One set of panels covers a shared wall; a second set on the same edges is an overlap error (tested) |
| Pricing correctness | Never hard-coded; dated schedule, effective date on every quote |
| Units | Feet at the edges, integer 2 ft units internally — no floating-point drift |

## Test coverage

98 unit tests across `core/` and `canvas/view.ts`, plus a Playwright drive of the built app that
exercises drawing, selection, deletion, undo, the placement guards, pricing, all five exports, save
and reopen, and the read-only client view. Drawing a 20 × 16 ft room in the browser produces the
same 18 panels / 72 linear ft the unit tests assert.
