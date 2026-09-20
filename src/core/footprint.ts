/**
 * The building interior, derived from the wall layout.
 *
 * Floor and roof panels fill the space a building encloses, so the tool has to
 * work out what "inside" means from the walls themselves. The walls are a
 * graph of 2 ft edges, not a closed ring, so rasterising a polygon is the wrong
 * tool: there is no polygon, and interior partitions would confuse one.
 *
 * A flood fill from *outside* handles every case instead. Anything the fill
 * cannot reach without crossing a wall is inside, which is exactly the
 * definition an architect means. Interior partitions fall out for free: they
 * subdivide the interior into rooms, but the fill never gets in there anyway.
 */

import { cellKey, edgeKey, panelEdges } from './panels';
import { isLinearCategory } from './types';
import type { GridCell, Panel } from './types';

export interface Footprint {
  cells: GridCell[];
  /** Fast membership test, keyed by `cellKey`. */
  has(cell: GridCell): boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const EMPTY: Footprint = { cells: [], has: () => false, bounds: null };

function makeFootprint(keys: Set<string>, cells: GridCell[]): Footprint {
  if (cells.length === 0) return EMPTY;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  }
  return {
    cells,
    has: (cell) => keys.has(cellKey(cell)),
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * Cells enclosed by the wall layout.
 *
 * Only linear categories form walls; a floor panel already inside the building
 * must not be treated as a barrier, or filling a floor twice would shrink the
 * footprint each time.
 */
export function interiorCells(panels: Panel[]): Footprint {
  const walls = panels.filter((panel) => isLinearCategory(panel.category));
  if (walls.length === 0) return EMPTY;

  const blocked = new Set<string>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const panel of walls) {
    for (const edge of panelEdges(panel)) {
      blocked.add(edgeKey(edge));
      const endX = edge.axis === 'h' ? edge.x + 1 : edge.x;
      const endY = edge.axis === 'h' ? edge.y : edge.y + 1;
      minX = Math.min(minX, edge.x);
      minY = Math.min(minY, edge.y);
      maxX = Math.max(maxX, endX);
      maxY = Math.max(maxY, endY);
    }
  }

  // One ring of slack all round, so the fill always has somewhere outside to
  // start from and can get round the outside of the building.
  const lowX = minX - 1;
  const lowY = minY - 1;
  const highX = maxX;
  const highY = maxY;

  const outside = new Set<string>();
  const start: GridCell = { x: lowX, y: lowY };
  const queue: GridCell[] = [start];
  outside.add(cellKey(start));

  // Moving between two cells crosses the edge on the boundary they share.
  const crossings: Array<{ dx: number; dy: number; edge: (c: GridCell) => string }> = [
    { dx: 1, dy: 0, edge: (c) => edgeKey({ x: c.x + 1, y: c.y, axis: 'v' }) },
    { dx: -1, dy: 0, edge: (c) => edgeKey({ x: c.x, y: c.y, axis: 'v' }) },
    { dx: 0, dy: 1, edge: (c) => edgeKey({ x: c.x, y: c.y + 1, axis: 'h' }) },
    { dx: 0, dy: -1, edge: (c) => edgeKey({ x: c.x, y: c.y, axis: 'h' }) },
  ];

  while (queue.length > 0) {
    const cell = queue.pop()!;
    for (const step of crossings) {
      const next = { x: cell.x + step.dx, y: cell.y + step.dy };
      if (next.x < lowX || next.y < lowY || next.x > highX || next.y > highY) continue;
      const key = cellKey(next);
      if (outside.has(key)) continue;
      if (blocked.has(step.edge(cell))) continue;
      outside.add(key);
      queue.push(next);
    }
  }

  const keys = new Set<string>();
  const cells: GridCell[] = [];
  for (let x = lowX; x <= highX; x++) {
    for (let y = lowY; y <= highY; y++) {
      const cell = { x, y };
      const key = cellKey(cell);
      if (outside.has(key)) continue;
      keys.add(key);
      cells.push(cell);
    }
  }

  return makeFootprint(keys, cells);
}

/** Floor area of a footprint, in square feet. Each cell is 2 ft x 2 ft. */
export function footprintAreaSqFt(footprint: Footprint): number {
  return footprint.cells.length * 4;
}
