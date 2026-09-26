/**
 * Pointer arithmetic for touch gestures.
 *
 * Pure and shared: the plan canvas and the 3D view run the same pinch, one
 * against a 2D viewport and one against an orbit camera, and the maths should
 * be stated once. Nothing here knows about either.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * How much a pinch has zoomed: the ratio of the current finger span to the
 * previous one. Guarded against a zero span, which happens for one frame when
 * a second finger lands exactly on the first.
 */
export function pinchFactor(previousDistance: number, currentDistance: number): number {
  if (!(previousDistance > 0) || !(currentDistance > 0)) return 1;
  return currentDistance / previousDistance;
}

/** Distance between two screen points. */
export function pointerDistance(
  a: Point,
  b: Point,
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point a pinch is anchored on: halfway between the two fingers. */
export function midpoint(
  a: Point,
  b: Point,
): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
