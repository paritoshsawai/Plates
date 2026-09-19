/**
 * Screen/world mapping for the design canvas.
 *
 * World coordinates are grid units (1 unit = 2 ft). One unit is PX_PER_UNIT
 * pixels at scale 1; the Konva stage applies pan and zoom on top, so every
 * shape below can be drawn in plain world coordinates.
 */

import type { GridEdge, GridPoint } from '../core/types';

export const PX_PER_UNIT = 24;
/** Drawn wall thickness in world pixels. Panels are modelled with no thickness. */
export const WALL_PX = 9;
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 6;

/** Konva colours must be literal values, not CSS custom properties. */
export const COLORS = {
  gridMinor: '#e2e8f0',
  gridMajor: '#cbd5e1',
  plotFill: '#f8fafc',
  plotStroke: '#64748b',
  selection: '#f59e0b',
  error: '#dc2626',
  ghost: '#94a3b8',
  label: '#475569',
  anchor: '#0f766e',
} as const;

export interface Viewport {
  scale: number;
  x: number;
  y: number;
}

export function unitsToPx(units: number): number {
  return units * PX_PER_UNIT;
}

/**
 * Round to an integer grid coordinate, normalising -0 to 0 so coordinates
 * compare and serialise identically either side of the origin.
 */
function roundUnit(value: number): number {
  return Math.round(value) + 0;
}

/** Nearest grid node to a point given in world pixels. */
export function nearestNode(px: number, py: number): GridPoint {
  return { x: roundUnit(px / PX_PER_UNIT), y: roundUnit(py / PX_PER_UNIT) };
}

/**
 * Nearest grid edge to a point in world pixels: the 2 ft wall segment the
 * cursor is pointing at.
 *
 * The segment is chosen by distance to its *midpoint*, not by perpendicular
 * distance to a wall line. Perpendicular distance is degenerate along every
 * grid line - sitting on a node makes both axes exactly 0, so a sub-pixel
 * cursor jitter flips the panel to a perpendicular segment a whole unit away.
 * Midpoint distance varies smoothly and only ties on exact diagonals.
 */
export function nearestEdge(px: number, py: number): GridEdge {
  const ux = px / PX_PER_UNIT;
  const uy = py / PX_PER_UNIT;

  const horizontal: GridEdge = { x: roundUnit(ux - 0.5), y: roundUnit(uy), axis: 'h' };
  const vertical: GridEdge = { x: roundUnit(ux), y: roundUnit(uy - 0.5), axis: 'v' };

  const hDistance = squaredDistance(ux, uy, horizontal.x + 0.5, horizontal.y);
  const vDistance = squaredDistance(ux, uy, vertical.x, vertical.y + 0.5);

  return hDistance <= vDistance ? horizontal : vertical;
}

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

/** Visible world rectangle, in grid units, for culling grid lines. */
export function visibleUnits(
  viewport: Viewport,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const toWorld = (screen: number, offset: number) => (screen - offset) / viewport.scale / PX_PER_UNIT;
  return {
    minX: Math.floor(toWorld(0, viewport.x)) - 1,
    minY: Math.floor(toWorld(0, viewport.y)) - 1,
    maxX: Math.ceil(toWorld(width, viewport.x)) + 1,
    maxY: Math.ceil(toWorld(height, viewport.y)) + 1,
  };
}

/** Zoom about the pointer so the point under the cursor stays put. */
export function zoomAt(
  viewport: Viewport,
  pointer: { x: number; y: number },
  deltaY: number,
): Viewport {
  const factor = deltaY > 0 ? 1 / 1.12 : 1.12;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor));
  if (scale === viewport.scale) return viewport;
  const worldX = (pointer.x - viewport.x) / viewport.scale;
  const worldY = (pointer.y - viewport.y) / viewport.scale;
  return { scale, x: pointer.x - worldX * scale, y: pointer.y - worldY * scale };
}

/** Fit a bounding box in grid units into a viewport of the given pixel size. */
export function fitToBox(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  paddingPx = 64,
): Viewport {
  const boxW = Math.max(1, box.maxX - box.minX) * PX_PER_UNIT;
  const boxH = Math.max(1, box.maxY - box.minY) * PX_PER_UNIT;
  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min((width - paddingPx * 2) / boxW, (height - paddingPx * 2) / boxH)),
  );
  return {
    scale,
    x: (width - boxW * scale) / 2 - box.minX * PX_PER_UNIT * scale,
    y: (height - boxH * scale) / 2 - box.minY * PX_PER_UNIT * scale,
  };
}
