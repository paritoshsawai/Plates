/** Domain types shared by the geometry, BOM and persistence layers. */

/** The only two panels Arplace manufactures. */
export type PanelTypeId = '4x10' | '2x10';

/**
 * A panel's run direction on the floor plan.
 * 'h' is rotation 0 (the panel runs along +X), 'v' is rotation 90 (along +Y).
 * The 10 ft dimension is always the wall height and never appears in plan.
 */
export type Orientation = 'h' | 'v';

export interface PanelSpec {
  id: PanelTypeId;
  label: string;
  /** Horizontal run of the panel, in feet. */
  widthFt: number;
  /** Wall height, in feet. Constant across the catalog. */
  heightFt: number;
  /** Horizontal run in 2 ft grid units. This is the tiling denomination. */
  widthUnits: number;
  /** Canvas fill, so the palette and the plan agree. */
  color: string;
}

/**
 * A placed panel. `x`/`y` are the panel's start node in grid units; the panel
 * occupies `widthUnits` consecutive grid edges from there along `orientation`.
 */
export interface Panel {
  id: string;
  type: PanelTypeId;
  x: number;
  y: number;
  orientation: Orientation;
}

/** A node of the modular grid, in integer grid units. */
export interface GridPoint {
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

export interface PriceConfig {
  currency: 'INR';
  /** ISO date from which these prices apply. */
  effectiveDate: string;
  /** Free-text provenance, e.g. "placeholder - not Arplace's real prices". */
  note: string;
  /** Per-panel ex-works price. */
  panelUnitPrice: Record<PanelTypeId, number>;
  /** Optional cost factors; all default to 0 so the MVP total is panels only. */
  laborPerPanel: number;
  transportPerPanel: number;
  transportFlat: number;
  taxPercent: number;
}

export interface BomLine {
  sku: PanelTypeId;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface CostBreakdown {
  panels: number;
  labor: number;
  transport: number;
  tax: number;
  total: number;
}

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
  lines: BomLine[];
  counts: Record<PanelTypeId, number>;
  totalPanels: number;
  cost: CostBreakdown;
  utilization: UtilizationReport;
  currency: 'INR';
  priceEffectiveDate: string;
}

export type IssueCode =
  | 'overlap'
  | 'open-end'
  | 'outside-plot'
  | 'off-grid'
  | 'disconnected'
  | 'unknown-panel'
  | 'empty-plan';

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
