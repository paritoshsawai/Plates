# Arplace Panel Studio

A browser tool for designing panelized floor plans from Arplace's two wall panels —
**4 ft × 10 ft** and **2 ft × 10 ft** — and getting the bill of materials, the cost and the
factory work order as you draw.

Panels are never cut or resized. That single constraint is what makes the whole tool tractable:
the design grid is **2 ft**, the greatest common divisor of the two panel widths, so any wall whose
length is a multiple of 2 ft tiles exactly with zero offcut, and nothing else can be built at all.

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # 228 unit tests over the geometry, tiling, BOM, pricing, store and 3D
npm run build     # typecheck + production bundle
```

## What it does

1. **Set the plot.** Enter the parcel in feet. Buildable dimensions round *down* onto the 2 ft
   module, so the design area never exceeds the land you actually have, and the dialog says exactly
   what snapping set aside.
2. **Draw walls.** Click two points; the run is auto-filled with the fewest possible panels. The
   preview shows the tiling and the panel count *before* you commit.
3. **Place single panels** where you want a specific one. Drag a box on the plan to select several
   at once (shift adds to the selection), then rotate, duplicate, delete, or nudge the whole lot
   2 ft at a time with the arrow keys. Panning is hold-Space or middle-drag, since a plain drag now
   draws the selection box.
4. **Watch it validate.** Overlaps, gaps, out-of-bounds panels and off-grid coordinates are flagged
   live. The plan reads *Manufacturable ✓* only when every error is gone.
5. **Read the BOM and cost.** Panel counts, line items, totals and material utilisation update on
   every edit, priced from an admin-editable schedule.
6. **Export.** Quote PDF, plan PNG, BOM CSV, plan JSON, and a work-order JSON payload shaped for an
   ERP.

## The model

Everything rests on one idea: **walls are edges of an integer grid, and panels own edges.**

- One internal unit = one 2 ft grid cell. Panel coordinates are integers, never floats, so the
  geometry has no tolerance bugs.
- A horizontal panel at `(x, y)` occupies the grid edges `(x, y)…(x + width, y)`. A 4 ft panel
  covers two edges, a 2 ft panel one.
- **Corners are dimensionless nodes.** Two walls meeting at a corner each stop at the shared node,
  so a corner is never covered twice and never double-counted in the BOM. That is the corner
  convention, and it needs no special case anywhere in the code.

From that, every check is integer bookkeeping:

| Check | Rule |
| --- | --- |
| Overlap | Two panels claim the same edge |
| Gap | A node has exactly **one** incident edge — a dangling wall end |
| Out of bounds | An edge's endpoints or midpoint fall outside the plot polygon |
| Off grid | A coordinate is not an integer (only reachable via import) |
| Detached structures | More than one connected component — a warning, not an error |
| Bare floor or roof | A floor or roof exists but does not reach every interior cell |

Node degree does all the gap work: 1 is an open end, 2 is a straight run or a corner, 3 a
T-junction, 4 a crossing.

### Floor and roof

Floor and roof panels lie *flat*, so both catalog sizes are 10 ft deep on plan and the two
categories occupy grid **cells** rather than edges. They are laid in 10 ft strips, with the 1D
tiling above picking the 4 ft and 2 ft widths along each strip. The building interior comes from a
flood fill starting *outside* the wall bounding box — the walls are a graph, not a closed ring, so
a fill handles any shape and ignores interior partitions for free.

The consequence is worth stating plainly: **a building no axis of which divides by 10 ft cannot be
fully floored.** Once a floor or roof exists, anything it cannot reach is a blocking error with the
bare area shaded on the plan, not a quiet approximation. A plan with no floor at all is untouched —
a wall-only plan is a legitimate work in progress.

### Minimum-panel tiling

Covering a wall of length *L* without cutting is the coin-change problem. For Arplace's widths the
closed form is `floor(L/4)` four-footers plus one two-footer when `L mod 4 === 2`, and greedy is
provably optimal because `{2, 1}` grid units is a canonical denomination set.

`src/core/tiling.ts` implements the dynamic program anyway —

```
C[p] = 0                                   if p = 0
C[p] = min over d ≤ p of { 1 + C[p − d] }  otherwise
```

— in Θ(n·k) time, and uses greedy only as a fast path guarded by an actual optimality check.
Greedy is *not* optimal for arbitrary denominations (`{5, 4, 1}` fills 8 as `5+1+1+1` where `4+4`
wins), so **adding a third panel size to the catalog is safe**: the guard fails over to the DP and
the quotes stay correct. That behaviour is covered by tests.

### Material utilisation

Offcut is always **0 ft** — panels are laid whole. The figures worth reporting instead are what a
cut-to-fit build would have wasted on the same walls (every 2 ft remainder sawn from a 4 ft board
leaves a 2 ft offcut) and how close the layout is to the fewest panels that cover its geometry.
Both are labelled as exactly that in the UI, the CSV and the PDF.

## Layout

```
src/core/        Pure domain logic — no DOM, no React. All of it unit-tested.
  units.ts         The 2 ft module, feet ⇄ grid units
  panels.ts        The catalog; panel → grid edges
  tiling.ts        Coin-change / minimum-panel tiling
  walls.ts         Panels → wall graph (edges, node degrees, straight runs)
  validation.ts    The manufacturability rules
  bom.ts           Counts, costs, utilisation
  pricing.ts       Dated, admin-editable price schedule
  plan.ts          Plan documents, strict parsing of untrusted JSON
  workorder.ts     The BOM as an ERP payload
src/canvas/      Konva rendering and screen ⇄ world mapping
src/components/  Rails, dialogs, top bar
src/state/       Zustand store (undo/redo) and the plan repository
src/export/      CSV, PDF, download plumbing
```

`src/core` has no imports from anything above it, which is why the interesting logic is testable
without a browser.

## Pricing

No price is hard-coded in the costing maths. The schedule lives in `src/core/pricing.ts` as an
admin-editable, dated config, and every quote carries the effective date it was priced from. The
seeded ₹20 / ₹10 values are placeholders from the build spec — the UI and the PDF both say so
until an admin enters a real schedule.

## Roles

The Architect / Admin / Client switch in the top bar decides **which panes render, nothing more**.
It is a UI affordance, not access control; real enforcement belongs on the server next to
authentication and must never be inferred from this value.

## Persistence

Plans are stored in the browser via a `PlanRepository` interface (`src/state/storage.ts`). The
document shape is already what a server would persist — a `jsonb` column — so a REST-backed
implementation drops in behind the same four methods with no change above that file. Plan JSON
exports round-trip back through Import.

## What is not built

- Multi-storey stacking, and **roof pitch** — the roof is a flat footprint until Arplace's
  structural team defines pitch rules
- DXF/CAD export and a dedicated factory view (Konva cannot emit DXF; this needs Maker.js or
  dxf-writer)
- A server, real authentication, and the ERP/webhook integration — `toWorkOrder()` produces the
  payload, but nothing POSTs it yet
- Tracing an uploaded survey image, GeoJSON/KML import
- Non-rectangular plot *drawing* in the UI. The geometry layer fully supports arbitrary rectilinear
  boundaries (`containsPoint`/`containsSegment` handle concave L-shapes, with tests); only the
  setup dialog is restricted to rectangles.
- Structural and load validation, wall thickness. The MVP models walls on their centreline with no
  thickness.
