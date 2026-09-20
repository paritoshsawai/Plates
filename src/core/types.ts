/** Domain types shared by the geometry, BOM and persistence layers. */

/** The two footprint sizes Arplace manufactures, shared by every category. */
export type PanelSizeId = '4x10' | '2x10';

/**
 * What a panel is for. This is a first-class attribute, not a label: it selects
 * the price row, the plane the panel lives on, and its colour on the canvas.
 *
 * Linear categories (wall, door, window) occupy grid *edges*. Area categories
 * (floor, roof) occupy grid *cells* - for those the 10 ft dimension lies flat
 * in plan instead of standing up as wall height.
 */
export type PanelCategory = 'wall' | 'floor' | 'roof' | 'door' | 'window';

/** Categories laid along a wall line, sharing the edge model. */
export const LINEAR_CATEGORIES: readonly PanelCategory[] = ['wall', 'door', 'window'];

/** Categories that tile a footprint. Their geometry arrives in Phase 3. */
export const AREA_CATEGORIES: readonly PanelCategory[] = ['floor', 'roof'];

export function isLinearCategory(category: PanelCategory): boolean {
  return LINEAR_CATEGORIES.includes(category);
}

/**
 * Junction hardware, detected from the wall layout rather than placed by hand.
 * Every intersection of wall runs needs a connector, so counting them is
 * bookkeeping a manual process would get wrong.
 */
export type ConnectorType = 'corner' | 't-junction' | 'cross';

/** Everything that can carry a price: the panel categories plus connectors. */
export type PriceCategory = PanelCategory | 'connector';

/**
 * A panel's run direction on the floor plan.
 * 'h' is rotation 0 (the panel runs along +X), 'v' is rotation 90 (along +Y).
 * The 10 ft dimension is always the wall height and never appears in plan.
 */
export type Orientation = 'h' | 'v';

export interface PanelSpec {
  id: PanelSizeId;
  label: string;
  /** Horizontal run of the panel, in feet. */
  widthFt: number;
  /**
   * The panel's other dimension, in feet. For a wall it stands up as height and
   * never appears in plan; for a floor or roof panel it lies flat.
   */
  heightFt: number;
  /** Horizontal run in 2 ft grid units. This is the tiling denomination. */
  widthUnits: number;
}

/**
 * A placed panel. `x`/`y` are the panel's start node in grid units; the panel
 * occupies `widthUnits` consecutive grid edges from there along `orientation`.
 */
export interface Panel {
  id: string;
  category: PanelCategory;
  size: PanelSizeId;
  x: number;
  y: number;
  orientation: Orientation;
  /** Set on door and window panels; ignored on every other category. */
  opening?: Opening;
}

/**
 * Detail carried by a pre-cut opening. Arplace's factory cuts these into the
 * panel before delivery, so the swing and sill travel with the panel rather
 * than being decided on site.
 */
export interface Opening {
  /** Which jamb the door is hinged on, seen along the panel's run direction. */
  swing?: 'left' | 'right';
  /** Height of a window's sill above the floor, in feet. */
  sillHeightFt?: number;
}

/** Categories that carry an Opening. */
export function isOpeningCategory(category: PanelCategory): boolean {
  return category === 'door' || category === 'window';
}

/** A node of the modular grid, in integer grid units. */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * One grid cell: the 2 ft x 2 ft square whose top-left corner is (x, y).
 * Floor and roof panels are built from these, the way walls are built from
 * edges.
 */
export interface GridCell {
  x: number;
  y: number;
}

/**
 * One grid edge: the 2 ft segment from (x, y) to (x+1, y) when axis is 'h',
 * or to (x, y+1) when axis is 'v'. Walls are built from these; corners are the
 * dimensionless nodes where edges meet, which is why no panel is ever counted
 * twice at a junction.
 */
export interface GridEdge {
  x: number;
  y: number;
  axis: Orientation;
}

/** A rectilinear plot boundary, as a closed ring of nodes in grid units. */
export interface Plot {
  /** Ring of vertices; the closing edge back to vertices[0] is implied. */
  vertices: GridPoint[];
}

/**
 * One priced SKU. Wall, floor and roof share the two footprint sizes but are
 * separate rows, so Arplace can price a roof panel differently from a wall
 * panel of identical dimensions without a schema change. Connector rows carry
 * a ConnectorType as their size.
 */
export interface PriceRow {
  category: PriceCategory;
  /** A PanelSizeId for panels, a ConnectorType for connectors. */
  size: string;
  unitPrice: number;
  /** Overrides the schedule date for this row alone. */
  effectiveDate?: string;
}

export interface PriceConfig {
  currency: 'INR';
  /** ISO date this schedule applies from; a row may override it. */
  effectiveDate: string;
  /** Free-text provenance, e.g. "placeholder - not Arplace's real prices". */
  note: string;
  rows: PriceRow[];
  /** Optional cost factors; all default to 0 so the total is panels only. */
  laborPerPanel: number;
  transportPerPanel: number;
  transportFlat: number;
  taxPercent: number;
}

export interface BomLine {
  category: PriceCategory;
  /** A PanelSizeId for panels, a ConnectorType for connectors. */
  sku: string;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/** One category's lines plus its own subtotal, shown before the grand total. */
export interface BomGroup {
  category: PriceCategory;
  label: string;
  lines: BomLine[];
  qty: number;
  subtotal: number;
}

export interface CostBreakdown {
  panels: number;
  connectors: number;
  labor: number;
  transport: number;
  tax: number;
  total: number;
}

/**
 * Material utilisation. Every figure here is about the *wall* line: offcut
 * avoided counts 2 ft remainders on wall runs, so area categories must not be
 * folded in silently when floor and roof arrive.
 */
export interface UtilizationReport {
  /** Total linear feet of wall the plan covers. */
  linearFt: number;
  /** Panels actually placed. */
  panelCount: number;
  /** Fewest panels that could cover the same wall geometry. */
  optimalPanelCount: number;
  /** panelCount / optimalPanelCount as a percentage, capped at 100. */
  optimalityPercent: number;
  /** Feet of offcut produced. Always 0: panels are never cut. */
  offcutFt: number;
  /**
   * Feet of offcut a cut-to-fit build would have produced for the same walls,
   * assuming every 2 ft remainder is cut from a 4 ft board. This is the
   * sustainability figure the panel system avoids.
   */
  offcutAvoidedFt: number;
}

export interface Bom {
  /** Per-category groups, each with its own subtotal. */
  groups: BomGroup[];
  /** Every line across all groups, for consumers that want them flat. */
  lines: BomLine[];
  /** Panel counts keyed `${category}:${size}`. */
  counts: Record<string, number>;
  /** Detected junction hardware, keyed by connector type. */
  connectorCounts: Record<ConnectorType, number>;
  totalPanels: number;
  totalConnectors: number;
  cost: CostBreakdown;
  utilization: UtilizationReport;
  currency: 'INR';
  /** The latest row date actually used, so a quote cites real provenance. */
  priceEffectiveDate: string;
}

export type IssueCode =
  | 'overlap'
  | 'open-end'
  | 'outside-plot'
  | 'off-grid'
  | 'disconnected'
  | 'unknown-panel'
  | 'empty-plan'
  | 'area-overlap'
  | 'area-outside-plot'
  | 'area-incomplete';

export interface ValidationIssue {
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
  /** Panels to highlight in red on the canvas. */
  panelIds: string[];
  /** Node to flag, for open ends. */
  at?: GridPoint;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** True only when there are no errors and at least one panel is placed. */
  manufacturable: boolean;
  /** Panel ids involved in any error, for canvas highlighting. */
  flaggedPanelIds: Set<string>;
}

export interface Plan {
  schemaVersion: number;
  id: string;
  name: string;
  plot: Plot;
  panels: Panel[];
  createdAt: string;
  updatedAt: string;
  /** Monotonic version number, bumped on each explicit save. */
  version: number;
  notes: string;
}
