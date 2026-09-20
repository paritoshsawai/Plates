/**
 * Tiling a footprint with floor or roof panels.
 *
 * This is NOT the 1D coin change the walls use. Lying flat, a 4x10 panel is a
 * 4 ft x 10 ft rectangle - 2 x 5 grid units - so both catalog sizes are 10 ft
 * deep. A footprint therefore decomposes into 10 ft strips, and only tiles
 * exactly where its depth is a whole number of them.
 *
 * Within one strip the problem collapses back to the familiar 1D case: pick
 * 4 ft and 2 ft widths along the strip, which `tilingSequence` already solves
 * optimally. So the 1D solver is reused, just one dimension in.
 *
 * Anything the strips cannot reach is reported rather than approximated. A
 * quote that silently rounds a floor area is worse than one that says which
 * 40 sq ft it cannot cover.
 */

import { AREA_DEPTH_UNITS, getPanelSpec, newPanelId } from './panels';
import { tilingSequence } from './tiling';
import { GRID_FT } from './units';
import type { Footprint } from './footprint';
import type { GridCell, Orientation, Panel, PanelCategory } from './types';

export interface AreaTiling {
  panels: Panel[];
  /** Footprint cells no strip could reach. */
  uncovered: GridCell[];
  /** Area of those cells, in square feet. */
  uncoveredSqFt: number;
}

/**
 * Lay `category` panels over `footprint`.
 *
 * Strips run along `orientation`: 'h' means each strip is 10 ft deep in Y and
 * panels tile along X. Bands are anchored to the footprint's own minimum, not
 * the world origin, so a building offset from the origin tiles just as well as
 * one at it.
 */
export function tileFootprint(
  footprint: Footprint,
  category: PanelCategory,
  orientation: Orientation = 'h',
): AreaTiling {
  if (!footprint.bounds || footprint.cells.length === 0) {
    return { panels: [], uncovered: [], uncoveredSqFt: 0 };
  }

  const { minX, minY, maxX, maxY } = footprint.bounds;
  // `along` is the axis panels tile down; `across` is the strip's 10 ft depth.
  const alongMin = orientation === 'h' ? minX : minY;
  const alongMax = orientation === 'h' ? maxX : maxY;
  const acrossMin = orientation === 'h' ? minY : minX;
  const acrossMax = orientation === 'h' ? maxY : maxX;

  const at = (along: number, across: number): GridCell =>
    orientation === 'h' ? { x: along, y: across } : { x: across, y: along };

  const panels: Panel[] = [];
  const covered = new Set<string>();

  for (let bandStart = acrossMin; bandStart <= acrossMax; bandStart += AREA_DEPTH_UNITS) {
    // A column belongs to this strip only when the whole 10 ft depth is inside
    // the footprint - half a panel cannot be laid.
    const full: boolean[] = [];
    for (let along = alongMin; along <= alongMax; along++) {
      let complete = true;
      for (let d = 0; d < AREA_DEPTH_UNITS; d++) {
        if (!footprint.has(at(along, bandStart + d))) {
          complete = false;
          break;
        }
      }
      full.push(complete);
    }

    // Contiguous full columns form a span, tiled by the 1D solver.
    let spanStart: number | null = null;
    for (let i = 0; i <= full.length; i++) {
      const isFull = i < full.length && full[i];
      if (isFull && spanStart === null) spanStart = i;
      if (isFull || spanStart === null) continue;

      const lengthUnits = i - spanStart;
      const sequence = tilingSequence(lengthUnits) ?? [];
      let cursor = alongMin + spanStart;
      for (const size of sequence) {
        const origin = at(cursor, bandStart);
        panels.push({ id: newPanelId(), category, size, ...origin, orientation });
        const widthUnits = getPanelSpec(size).widthUnits;
        for (let w = 0; w < widthUnits; w++) {
          for (let d = 0; d < AREA_DEPTH_UNITS; d++) {
            const cell = at(cursor + w, bandStart + d);
            covered.add(`${cell.x},${cell.y}`);
          }
        }
        cursor += widthUnits;
      }
      spanStart = null;
    }
  }

  const uncovered = footprint.cells.filter((cell) => !covered.has(`${cell.x},${cell.y}`));
  return { panels, uncovered, uncoveredSqFt: uncovered.length * GRID_FT * GRID_FT };
}

/**
 * The nearest depths, in feet, that a 10 ft panel tiles exactly. Used to turn
 * an uncoverable footprint into something the architect can act on.
 */
export function nearestTileableDepthFt(depthFt: number): { down: number; up: number } {
  const step = AREA_DEPTH_UNITS * GRID_FT;
  return {
    down: Math.max(step, Math.floor(depthFt / step) * step),
    up: Math.max(step, Math.ceil(depthFt / step) * step),
  };
}

/**
 * Whichever strip direction covers more of the footprint. A building 20 ft one
 * way and 30 ft the other only tiles across the 30 ft axis, and the architect
 * should not have to work that out.
 */
export function bestTileFootprint(
  footprint: Footprint,
  category: PanelCategory,
): AreaTiling & { orientation: Orientation } {
  const horizontal = tileFootprint(footprint, category, 'h');
  const vertical = tileFootprint(footprint, category, 'v');
  return horizontal.uncovered.length <= vertical.uncovered.length
    ? { ...horizontal, orientation: 'h' }
    : { ...vertical, orientation: 'v' };
}
