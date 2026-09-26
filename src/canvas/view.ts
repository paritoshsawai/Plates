/**
 * Screen/world mapping for the design canvas.
 *
 * World coordinates are grid units (1 unit = 2 ft). One unit is PX_PER_UNIT
 * pixels at scale 1; the Konva stage applies pan and zoom on top, so every
 * shape below can be drawn in plain world coordinates.
 */

import { plotBboxUnits } from '../core/plot';
import { panelBoundsUnits } from '../core/panels';
import type { GridEdge, GridPoint, Panel, Plot } from '../core/types';

export const PX_PER_UNIT = 24;
/** Konva name for nodes an export must leave out. */
export const EXPORT_HIDDEN = 'export-hidden';

/** Drawn wall thickness in world pixels. Panels are modelled with no thickness. */
export const WALL_PX = 9;
/**
 * Margin an export leaves around the drawing, in grid units.
 *
 * Derived from the dimension labels rather than picked by eye: a vertical run's
 * label is drawn in a 72 px box starting WALL_PX to the right of the wall, so
 * anything less clips the furthest label - which is exactly what a 1 unit
 * margin did, cutting "20 ft" down to "20".
 */
export const EXPORT_MARGIN_UNITS = (72 + WALL_PX) / PX_PER_UNIT;
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
  connector: '#475569',
} as const;

export type { Point } from '../core/gestures';

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

/**
 * Zoom about a fixed screen point, so whatever is under it stays under it.
 *
 * Takes a factor rather than a wheel delta, because a pinch has no notion of
 * a notch: the factor is the ratio the fingers moved apart by. The wheel path
 * goes through `zoomAt`, which is this with a fixed step.
 */
export function zoomBy(
  viewport: Viewport,
  anchor: { x: number; y: number },
  factor: number,
): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor));
  if (scale === viewport.scale) return viewport;
  const worldX = (anchor.x - viewport.x) / viewport.scale;
  const worldY = (anchor.y - viewport.y) / viewport.scale;
  return { scale, x: anchor.x - worldX * scale, y: anchor.y - worldY * scale };
}

/** Zoom about the pointer so the point under the cursor stays put. */
export function zoomAt(
  viewport: Viewport,
  pointer: { x: number; y: number },
  deltaY: number,
): Viewport {
  return zoomBy(viewport, pointer, deltaY > 0 ? 1 / 1.12 : 1.12);
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

/**
 * Live-snap a Konva drag to the 2 ft grid.
 *
 * Konva hands the handler absolute stage coordinates, so the transform has to
 * be undone, the position snapped in world space, and the transform reapplied.
 * Written as a standalone function because it is bound as a `dragBoundFunc`,
 * where `this` is the node being dragged.
 */
export function snapToGrid(this: { getStage(): { scaleX(): number; x(): number; y(): number } | null }, pos: { x: number; y: number }): { x: number; y: number } {
  const stage = this.getStage();
  if (!stage) return pos;
  const scale = stage.scaleX() || 1;
  const originX = stage.x();
  const originY = stage.y();
  const snap = (screen: number, origin: number) =>
    Math.round((screen - origin) / scale / PX_PER_UNIT) * PX_PER_UNIT * scale + origin;
  return { x: snap(pos.x, originX), y: snap(pos.y, originY) };
}

/**
 * The world region an exported drawing should cover.
 *
 * Derived from the plan, never from the viewport. An export that framed
 * whatever the architect happened to be looking at would depend on their
 * scroll position, their zoom, their window size and even which tab was open -
 * which is exactly how a quote ended up showing an empty corner of the plot
 * with the building half out of frame.
 *
 * It frames the *panels* once anything is drawn, not the plot. A quote is
 * about the building: on a parcel much larger than the house, framing the plot
 * leaves the subject a small shape in one corner and most of the page bare
 * land. The plot boundary is still drawn and still appears whenever it is near
 * the building; on a big parcel it simply runs off the edge, which is what
 * zoom-to-contents does in any drawing tool. An empty plan has nothing to
 * frame but the plot, so it gets the plot.
 */
export function planBoundsUnits(
  plot: Plot,
  panels: Panel[],
  padUnits = EXPORT_MARGIN_UNITS,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const panel of panels) {
    const rect = panelBoundsUnits(panel);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  if (!Number.isFinite(minX)) {
    const box = plotBboxUnits(plot);
    minX = box.minX;
    minY = box.minY;
    maxX = box.maxX;
    maxY = box.maxY;
  }

  // A single panel is a line with no thickness, and a degenerate plot has no
  // area at all. Either way the capture needs a box with real extent.
  if (!(maxX > minX) || !(maxY > minY)) {
    return { minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1 };
  }
  return {
    minX: minX - padUnits,
    minY: minY - padUnits,
    maxX: maxX + padUnits,
    maxY: maxY + padUnits,
  };
}

/**
 * Handlers that make a shape selectable by both a mouse and a finger.
 *
 * Konva dispatches by pointer kind and never doubles up: a mouse gets
 * `mousedown`, a finger gets `touchstart`. A shape wired only for the mouse -
 * which is what every shape here was - simply cannot be picked on a
 * touchscreen. Defined once so the two shape components cannot drift.
 *
 * `shiftKey` only exists on the mouse event, so additive selection is a
 * mouse-only affordance; a tap replaces the selection, which is what a tap
 * means everywhere else.
 */
export function selectHandlers(onPick: (additive: boolean) => void) {
  // A touchscreen fires a compatibility mousedown after every touchstart. For a
  // plain select that is merely redundant, but the same handler converts a wall
  // into a door and back, so a doubled call would undo itself.
  let lastTouchAt = 0;
  const pick = (e: { cancelBubble: boolean; evt: MouseEvent | TouchEvent }) => {
    const touch = 'touches' in e.evt;
    if (touch) lastTouchAt = Date.now();
    else if (Date.now() - lastTouchAt < 700) return;
    e.cancelBubble = true;
    onPick('shiftKey' in e.evt && e.evt.shiftKey);
  };
  return { onMouseDown: pick, onTouchStart: pick };
}
