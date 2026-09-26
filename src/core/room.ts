import { tileRun } from './tiling';
import type { GridPoint, Panel, PanelCategory } from './types';

/**
 * Rooms: four wall runs from two opposite corners.
 *
 * Almost every building starts as a rectangle, and drawing one as four
 * separate two-point runs is four chances to miss a grid node. Dragging out a
 * rectangle is one gesture and lands on the module by construction.
 */

export interface WallRun {
  from: GridPoint;
  to: GridPoint;
}

/**
 * The four runs enclosing the rectangle between two corners, in grid units.
 *
 * Empty when the two corners do not make a rectangle - a zero width or depth
 * is a line, not a room, and would produce two runs laid on top of each other.
 */
export function roomRuns(a: GridPoint, b: GridPoint): WallRun[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (minX === maxX || minY === maxY) return [];

  return [
    { from: { x: minX, y: minY }, to: { x: maxX, y: minY } },
    { from: { x: minX, y: maxY }, to: { x: maxX, y: maxY } },
    { from: { x: minX, y: minY }, to: { x: minX, y: maxY } },
    { from: { x: maxX, y: minY }, to: { x: maxX, y: maxY } },
  ];
}

/**
 * Every panel of a room, or null when the rectangle cannot be built.
 *
 * The corners are shared rather than doubled: each run spans corner to corner
 * and the runs meet at a node, which is dimensionless, so no 2 ft of wall is
 * ever claimed twice. That is the same rule the junction detector reads to
 * decide a corner needs a connector.
 */
export function tileRoom(
  a: GridPoint,
  b: GridPoint,
  category: PanelCategory = 'wall',
): Panel[] | null {
  const runs = roomRuns(a, b);
  if (runs.length === 0) return null;

  const panels: Panel[] = [];
  for (const run of runs) {
    const horizontal = run.from.y === run.to.y;
    const lengthUnits = horizontal ? run.to.x - run.from.x : run.to.y - run.from.y;
    const tiles = tileRun(run.from.x, run.from.y, lengthUnits, horizontal ? 'h' : 'v', category);
    if (!tiles) return null;
    panels.push(...tiles);
  }
  return panels;
}

/**
 * Where a run from `start` towards `cursor` actually ends.
 *
 * Walls run straight, so the cursor is projected onto whichever axis it
 * travelled further along. Shared by the live preview and the commit, so what
 * is drawn and what is built cannot disagree - they used to be two copies of
 * this rule, one in the canvas and one in the preview.
 */
export function straightEnd(start: GridPoint, cursor: GridPoint): GridPoint {
  const dx = cursor.x - start.x;
  const dy = cursor.y - start.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: cursor.x, y: start.y }
    : { x: start.x, y: cursor.y };
}
