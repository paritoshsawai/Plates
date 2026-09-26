import { describe, expect, it } from 'vitest';
import { zoomAt, zoomBy } from '../view';
import { midpoint, pinchFactor, pointerDistance } from '../../core/gestures';
import type { Viewport } from '../view';

/**
 * Pinch-to-zoom arithmetic, kept pure so it can be tested without a canvas or
 * a touchscreen - the same reason `fitRadius` and `normalizeWheelDelta` are
 * pure in the 3D controls.
 *
 * The invariant that matters is the same one the 3D cursor-anchored zoom
 * holds: whatever sits under the anchor before the zoom sits under it after.
 * For a pinch the anchor is the midpoint between the fingers, so the drawing
 * grows and shrinks around the gesture rather than sliding out from under it.
 */

const at = (scale: number, x = 0, y = 0): Viewport => ({ scale, x, y });

/** Where a world point lands on screen under a given viewport. */
const project = (v: Viewport, world: { x: number; y: number }) => ({
  x: world.x * v.scale + v.x,
  y: world.y * v.scale + v.y,
});

/** What world point is under a screen point. */
const unproject = (v: Viewport, screen: { x: number; y: number }) => ({
  x: (screen.x - v.x) / v.scale,
  y: (screen.y - v.y) / v.scale,
});

describe('pinchFactor', () => {
  it('is 1 when the fingers have not moved', () => {
    expect(pinchFactor(120, 120)).toBe(1);
  });

  it('doubles when the span doubles', () => {
    expect(pinchFactor(100, 200)).toBe(2);
  });

  it('halves when the span halves', () => {
    expect(pinchFactor(200, 100)).toBe(0.5);
  });

  it('inverts cleanly, so a pinch out and back lands where it started', () => {
    expect(pinchFactor(100, 250) * pinchFactor(250, 100)).toBeCloseTo(1, 12);
  });

  it('refuses a zero span rather than returning Infinity', () => {
    // Two fingers can report the same position for a frame as the second
    // lands. Dividing by that would send the scale to Infinity and blank the
    // canvas, so the gesture is treated as not having moved yet.
    expect(pinchFactor(0, 100)).toBe(1);
    expect(pinchFactor(100, 0)).toBe(1);
    expect(Number.isFinite(pinchFactor(0, 0))).toBe(true);
  });
});

describe('pointerDistance and midpoint', () => {
  it('measures the span between two fingers', () => {
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('is the same whichever finger is named first', () => {
    const a = { x: 10, y: 40 };
    const b = { x: 90, y: 120 };
    expect(pointerDistance(a, b)).toBe(pointerDistance(b, a));
    expect(midpoint(a, b)).toEqual(midpoint(b, a));
  });

  it('puts the anchor halfway between them', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({ x: 50, y: 25 });
  });
});

describe('zoomBy holds its anchor', () => {
  it('leaves the world point under the anchor exactly where it was', () => {
    const before = at(1.5, 40, -20);
    const anchor = { x: 317, y: 208 };
    const world = unproject(before, anchor);

    const after = zoomBy(before, anchor, 1.8);

    expect(after.scale).not.toBe(before.scale);
    expect(project(after, world).x).toBeCloseTo(anchor.x, 9);
    expect(project(after, world).y).toBeCloseTo(anchor.y, 9);
  });

  it('holds the anchor when zooming out too', () => {
    const before = at(2, -130, 75);
    const anchor = { x: 88, y: 402 };
    const world = unproject(before, anchor);

    const after = zoomBy(before, anchor, 0.4);

    expect(project(after, world).x).toBeCloseTo(anchor.x, 9);
    expect(project(after, world).y).toBeCloseTo(anchor.y, 9);
  });

  it('holds it across a run of small steps, the way a real pinch arrives', () => {
    // A pinch is dozens of tiny factors, not one big one. Drift would show up
    // here and nowhere else.
    const anchor = { x: 210, y: 160 };
    let v = at(1, 0, 0);
    const world = unproject(v, anchor);
    for (let i = 0; i < 40; i++) v = zoomBy(v, anchor, 1.03);

    expect(v.scale).toBeGreaterThan(2);
    expect(project(v, world).x).toBeCloseTo(anchor.x, 6);
    expect(project(v, world).y).toBeCloseTo(anchor.y, 6);
  });

  it('does nothing when a factor of 1 arrives', () => {
    const v = at(1.25, 12, 34);
    expect(zoomBy(v, { x: 100, y: 100 }, 1)).toBe(v);
  });

  it('clamps rather than letting a violent pinch leave the range', () => {
    const wayIn = zoomBy(at(1), { x: 0, y: 0 }, 10_000);
    const wayOut = zoomBy(at(1), { x: 0, y: 0 }, 0.00001);

    expect(Number.isFinite(wayIn.scale)).toBe(true);
    expect(Number.isFinite(wayOut.scale)).toBe(true);
    expect(wayIn.scale).toBeGreaterThan(1);
    expect(wayOut.scale).toBeLessThan(1);
    // And clamping must not smuggle a NaN into the offsets.
    expect(Number.isFinite(wayIn.x) && Number.isFinite(wayIn.y)).toBe(true);
    expect(Number.isFinite(wayOut.x) && Number.isFinite(wayOut.y)).toBe(true);
  });
});

describe('the wheel still behaves exactly as it did', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    const v = at(1, 0, 0);
    expect(zoomAt(v, { x: 50, y: 50 }, -100).scale).toBeGreaterThan(v.scale);
    expect(zoomAt(v, { x: 50, y: 50 }, 100).scale).toBeLessThan(v.scale);
  });

  it('is the same thing as zoomBy with the old fixed step', () => {
    const v = at(1.3, 20, 9);
    const p = { x: 140, y: 60 };
    expect(zoomAt(v, p, -1)).toEqual(zoomBy(v, p, 1.12));
    expect(zoomAt(v, p, 1)).toEqual(zoomBy(v, p, 1 / 1.12));
  });
});
