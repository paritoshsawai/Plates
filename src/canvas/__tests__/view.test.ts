import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, PX_PER_UNIT, fitToBox, nearestEdge, nearestNode, zoomAt } from '../view';

/** Convert grid units to the world pixels the canvas handlers work in. */
const at = (ux: number, uy: number): [number, number] => [ux * PX_PER_UNIT, uy * PX_PER_UNIT];

describe('nearestNode', () => {
  it('snaps to the closest grid node', () => {
    expect(nearestNode(...at(2.4, 5.6))).toEqual({ x: 2, y: 6 });
  });

  it('normalises -0 so coordinates either side of the origin compare equal', () => {
    const node = nearestNode(...at(-0.4, 0.4));
    expect(node).toEqual({ x: 0, y: 0 });
    expect(Object.is(node.x, -0)).toBe(false);
  });
});

describe('nearestEdge', () => {
  it('picks the horizontal segment the cursor sits on', () => {
    expect(nearestEdge(...at(3.5, 0))).toEqual({ x: 3, y: 0, axis: 'h' });
  });

  it('picks the vertical segment the cursor sits on', () => {
    expect(nearestEdge(...at(0, 3.5))).toEqual({ x: 0, y: 3, axis: 'v' });
  });

  it('stays on the same segment under sub-pixel jitter near a node', () => {
    // The old perpendicular-distance rule flipped axis here and placed the
    // panel a whole unit away from the cursor.
    const jitter = [-0.02, -0.005, 0, 0.005, 0.02];
    const picks = jitter.map((dy) => nearestEdge(...at(1.5, dy)));
    for (const pick of picks) {
      expect(pick).toEqual({ x: 1, y: 0, axis: 'h' });
    }
  });

  it('never reaches more than half a segment behind the cursor', () => {
    for (let ux = 0; ux <= 6; ux += 0.25) {
      for (let uy = 0; uy <= 6; uy += 0.25) {
        const edge = nearestEdge(...at(ux, uy));
        const midX = edge.axis === 'h' ? edge.x + 0.5 : edge.x;
        const midY = edge.axis === 'h' ? edge.y : edge.y + 0.5;
        expect(Math.hypot(ux - midX, uy - midY)).toBeLessThanOrEqual(0.71);
      }
    }
  });
});

describe('zoomAt', () => {
  const viewport = { scale: 1, x: 0, y: 0 };

  it('keeps the point under the cursor fixed', () => {
    const pointer = { x: 300, y: 200 };
    const next = zoomAt(viewport, pointer, -1);
    const worldBefore = (pointer.x - viewport.x) / viewport.scale;
    const worldAfter = (pointer.x - next.x) / next.scale;
    expect(worldAfter).toBeCloseTo(worldBefore, 6);
  });

  it('clamps to the configured zoom range', () => {
    let zoomedOut = viewport;
    for (let i = 0; i < 100; i++) zoomedOut = zoomAt(zoomedOut, { x: 0, y: 0 }, 1);
    expect(zoomedOut.scale).toBe(MIN_SCALE);

    let zoomedIn = viewport;
    for (let i = 0; i < 100; i++) zoomedIn = zoomAt(zoomedIn, { x: 0, y: 0 }, -1);
    expect(zoomedIn.scale).toBe(MAX_SCALE);
  });
});

describe('fitToBox', () => {
  it('centres the box within the viewport', () => {
    const box = { minX: 0, minY: 0, maxX: 30, maxY: 20 };
    const viewport = fitToBox(box, 1000, 800);
    const widthPx = 30 * PX_PER_UNIT * viewport.scale;
    expect(viewport.x).toBeCloseTo((1000 - widthPx) / 2, 6);
  });

  it('respects a box that does not start at the origin', () => {
    const box = { minX: 10, minY: 5, maxX: 40, maxY: 25 };
    const viewport = fitToBox(box, 1000, 800);
    // The box's top-left must land at the same screen point as a box of the
    // same size anchored at the origin.
    const anchored = fitToBox({ minX: 0, minY: 0, maxX: 30, maxY: 20 }, 1000, 800);
    expect(viewport.x + 10 * PX_PER_UNIT * viewport.scale).toBeCloseTo(anchored.x, 6);
  });
});
