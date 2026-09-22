import { describe, expect, it } from 'vitest';
import { planBoundsUnits } from '../view';
import { rectPlotFromFt } from '../../core/plot';
import type { Panel } from '../../core/types';

/**
 * The region an export frames.
 *
 * Derived from the plan rather than the viewport, because an export that
 * followed the viewport depended on scroll position, zoom, window size and
 * which tab happened to be open - which is how a quote came out showing an
 * empty corner of the plot with the building half out of frame.
 */

const wall = (over: Partial<Panel>): Panel => ({
  id: 'w',
  category: 'wall',
  size: '4x10',
  x: 0,
  y: 0,
  orientation: 'h',
  ...over,
});

/** A closed room from (x, y), in grid units. */
function room(x: number, y: number, w: number, h: number): Panel[] {
  return [
    wall({ id: 'n', x, y, orientation: 'h' }),
    wall({ id: 's', x, y: y + h, orientation: 'h' }),
    wall({ id: 'e', x: x + w, y, orientation: 'v' }),
    wall({ id: 'wst', x, y, orientation: 'v' }),
  ];
}

describe('planBoundsUnits', () => {
  const plot = rectPlotFromFt(60, 40); // 30 x 20 grid units

  it('frames the plot when nothing is drawn yet', () => {
    expect(planBoundsUnits(plot, [], 0)).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 20 });
  });

  it('frames the building, not the parcel, once something is drawn', () => {
    // The complaint this fixes: a 60 x 40 ft plot with a small building in one
    // corner exported as mostly bare land. The frame follows the building.
    const box = planBoundsUnits(plot, room(0, 0, 4, 3), 0);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 3 });
  });

  it('pads the box so the drawing is not flush with the edge', () => {
    const box = planBoundsUnits(plot, room(2, 2, 4, 3), 1);
    expect(box).toEqual({ minX: 1, minY: 1, maxX: 7, maxY: 6 });
  });

  it('covers every panel, wherever it sits', () => {
    const scattered = [wall({ id: 'a', x: -6, y: -3 }), wall({ id: 'b', x: 40, y: 25 })];
    expect(planBoundsUnits(plot, scattered, 0)).toEqual({
      minX: -6,
      minY: -3,
      maxX: 42,
      maxY: 25,
    });
  });

  it('accounts for the full depth of an area panel, not just its run', () => {
    // A floor panel lies flat: 2 units wide by 5 deep.
    const box = planBoundsUnits(plot, [wall({ category: 'floor', x: 1, y: 1 })], 0);
    expect(box).toEqual({ minX: 1, minY: 1, maxX: 3, maxY: 6 });
  });

  it('gives a lone panel a box with area, since a wall is a line', () => {
    // A single horizontal wall has zero height; without this the capture
    // region collapses and the image comes out empty.
    const box = planBoundsUnits(plot, [wall({})], 0);
    expect(box.maxY).toBeGreaterThan(box.minY);
    expect(box.maxX).toBeGreaterThan(box.minX);
  });

  it('always returns a box with area, even for a degenerate plot', () => {
    const box = planBoundsUnits(rectPlotFromFt(0, 0), []);
    expect(box.maxX).toBeGreaterThan(box.minX);
    expect(box.maxY).toBeGreaterThan(box.minY);
  });

  it('is independent of the plot once panels exist', () => {
    // Same building, wildly different parcels: the export must not change.
    const building = room(2, 2, 6, 4);
    expect(planBoundsUnits(rectPlotFromFt(60, 40), building)).toEqual(
      planBoundsUnits(rectPlotFromFt(400, 400), building),
    );
  });

  it('keeps the drawing aspect, which is what stops the PDF distorting it', () => {
    const box = planBoundsUnits(plot, room(0, 0, 6, 4), 0);
    expect((box.maxX - box.minX) / (box.maxY - box.minY)).toBeCloseTo(1.5, 6);
  });
});
