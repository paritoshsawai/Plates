import { GRID_FT, WALL_HEIGHT_FT } from './units';
import type {
  ConnectorType,
  GridEdge,
  Orientation,
  Panel,
  PanelCategory,
  PanelSizeId,
  PanelSpec,
} from './types';

/**
 * The panel catalog. Arplace manufactures exactly these; the tool must never
 * invent a size, because a size that is not here cannot be built.
 *
 * Adding a third size here is the one change that breaks the greedy shortcut in
 * `tiling.ts` - see the note there. The dynamic-programming path already
 * handles it, so the catalog is safe to extend.
 */
export const PANEL_CATALOG: readonly PanelSpec[] = [
  {
    id: '4x10',
    label: '4 ft x 10 ft',
    widthFt: 4,
    heightFt: WALL_HEIGHT_FT,
    widthUnits: 4 / GRID_FT,
  },
  {
    id: '2x10',
    label: '2 ft x 10 ft',
    widthFt: 2,
    heightFt: WALL_HEIGHT_FT,
    widthUnits: 2 / GRID_FT,
  },
] as const;

/**
 * Category presentation, shared by the canvas, the palette and the BOM.
 *
 * Colour encodes *category*, not size: a 4 ft panel is already visibly twice
 * the length of a 2 ft one, so spending colour on size would say the same
 * thing twice. Every hue stays clear of the validation red.
 */
export const CATEGORY_STYLE: Record<PanelCategory, { label: string; plural: string; color: string }> = {
  wall: { label: 'Wall panel', plural: 'Wall panels', color: '#2563eb' },
  floor: { label: 'Floor panel', plural: 'Floor panels', color: '#b45309' },
  roof: { label: 'Roof panel', plural: 'Roof panels', color: '#7c3aed' },
  door: { label: 'Door panel', plural: 'Door panels', color: '#0d9488' },
  window: { label: 'Window panel', plural: 'Window panels', color: '#0891b2' },
};

export const CONNECTOR_STYLE: Record<ConnectorType, { label: string; plural: string }> = {
  corner: { label: 'Corner connector', plural: 'Corner connectors' },
  't-junction': { label: 'T-junction connector', plural: 'T-junction connectors' },
  cross: { label: 'Cross connector', plural: 'Cross connectors' },
};

/** Categories the architect can draw runs in. Floor and roof arrive in Phase 3. */
export const PLACEABLE_CATEGORIES: readonly PanelCategory[] = ['wall'];

/**
 * Categories applied by converting an existing panel rather than by drawing.
 * Arplace pre-cuts openings into a panel at the factory, so a door *is* the
 * panel occupying that slot.
 */
export const OPENING_CATEGORIES: readonly PanelCategory[] = ['door', 'window'];

export function categoryColor(category: PanelCategory): string {
  return CATEGORY_STYLE[category]?.color ?? CATEGORY_STYLE.wall.color;
}

/** Stable key for a priced SKU, used by the price table and the BOM counts. */
export function skuKey(category: string, size: string): string {
  return `${category}:${size}`;
}

const BY_ID = new Map<PanelSizeId, PanelSpec>(PANEL_CATALOG.map((p) => [p.id, p]));

export function getPanelSpec(size: PanelSizeId): PanelSpec {
  const spec = BY_ID.get(size);
  if (!spec) throw new Error(`Unknown panel size: ${size}`);
  return spec;
}

export function isKnownPanelSize(size: string): size is PanelSizeId {
  return BY_ID.has(size as PanelSizeId);
}

export function isKnownCategory(category: string): category is PanelCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_STYLE, category);
}

/** Tiling denominations in grid units, largest first. */
export const DENOMINATIONS_UNITS: readonly number[] = PANEL_CATALOG.map((p) => p.widthUnits).sort(
  (a, b) => b - a,
);

/** Panel sizes indexed the same way as DENOMINATIONS_UNITS. */
export const DENOMINATION_SIZES: readonly PanelSizeId[] = [...PANEL_CATALOG]
  .sort((a, b) => b.widthUnits - a.widthUnits)
  .map((p) => p.id);

/** Run of a panel in grid units. */
export function panelLengthUnits(panel: Panel): number {
  return getPanelSpec(panel.size).widthUnits;
}

/** The grid node where the panel ends. */
export function panelEndNode(panel: Panel): { x: number; y: number } {
  const len = panelLengthUnits(panel);
  return panel.orientation === 'h'
    ? { x: panel.x + len, y: panel.y }
    : { x: panel.x, y: panel.y + len };
}

/**
 * The grid edges a panel occupies. Every downstream check - overlap, gaps,
 * in-bounds, BOM aggregation - is expressed over these, which is what keeps the
 * geometry free of floating-point tolerance bugs.
 */
export function panelEdges(panel: Panel): GridEdge[] {
  const len = panelLengthUnits(panel);
  const edges: GridEdge[] = [];
  for (let i = 0; i < len; i++) {
    edges.push(
      panel.orientation === 'h'
        ? { x: panel.x + i, y: panel.y, axis: 'h' }
        : { x: panel.x, y: panel.y + i, axis: 'v' },
    );
  }
  return edges;
}

export function edgeKey(edge: GridEdge): string {
  return `${edge.x},${edge.y},${edge.axis}`;
}

export function nodeKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function flipOrientation(o: Orientation): Orientation {
  return o === 'h' ? 'v' : 'h';
}

let idCounter = 0;

/** Ids only need to be unique within a plan, and stable across undo/redo. */
export function newPanelId(): string {
  idCounter += 1;
  return `p${Date.now().toString(36)}${idCounter.toString(36)}`;
}
