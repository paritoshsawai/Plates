import { GRID_FT, WALL_HEIGHT_FT } from './units';
import type { Orientation, Panel, PanelSpec, PanelTypeId, GridEdge } from './types';

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
    color: '#2563eb',
  },
  {
    id: '2x10',
    label: '2 ft x 10 ft',
    widthFt: 2,
    heightFt: WALL_HEIGHT_FT,
    widthUnits: 2 / GRID_FT,
    color: '#0d9488',
  },
] as const;

const BY_ID = new Map<PanelTypeId, PanelSpec>(PANEL_CATALOG.map((p) => [p.id, p]));

export function getPanelSpec(type: PanelTypeId): PanelSpec {
  const spec = BY_ID.get(type);
  if (!spec) throw new Error(`Unknown panel type: ${type}`);
  return spec;
}

export function isKnownPanelType(type: string): type is PanelTypeId {
  return BY_ID.has(type as PanelTypeId);
}

/** Tiling denominations in grid units, largest first. */
export const DENOMINATIONS_UNITS: readonly number[] = PANEL_CATALOG.map((p) => p.widthUnits).sort(
  (a, b) => b - a,
);

/** Panel types indexed the same way as DENOMINATIONS_UNITS. */
export const DENOMINATION_TYPES: readonly PanelTypeId[] = [...PANEL_CATALOG]
  .sort((a, b) => b.widthUnits - a.widthUnits)
  .map((p) => p.id);

/** Run of a panel in grid units. */
export function panelLengthUnits(panel: Panel): number {
  return getPanelSpec(panel.type).widthUnits;
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
