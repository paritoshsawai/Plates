import { describe, expect, it } from 'vitest';
import { panelBoundsUnits, rectsIntersect } from '../panels';
import type { UnitRect } from '../panels';
import type { Panel } from '../types';

function panel(over: Partial<Panel>): Panel {
  return { id: 'p', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'h', ...over };
}

describe('panelBoundsUnits', () => {
  it('gives a linear panel its run and no thickness', () => {
    // A 4 ft wall is 2 grid units long and, on plan, a line.
    expect(panelBoundsUnits(panel({ x: 3, y: 7 }))).toEqual({ x: 3, y: 7, width: 2, height: 0 });
  });

  it('turns the run down the Y axis when the panel is vertical', () => {
    expect(panelBoundsUnits(panel({ x: 3, y: 7, orientation: 'v' }))).toEqual({
      x: 3,
      y: 7,
      width: 0,
      height: 2,
    });
  });

  it('measures a 2 ft panel as one unit', () => {
    expect(panelBoundsUnits(panel({ size: '2x10' })).width).toBe(1);
  });

  it('gives an area panel its full 10 ft depth', () => {
    // Lying flat, a floor 4x10 is 2 units wide and 5 deep.
    expect(panelBoundsUnits(panel({ category: 'floor', x: 2, y: 4 }))).toEqual({
      x: 2,
      y: 4,
      width: 2,
      height: 5,
    });
  });

  it('swaps an area panel width and depth when it is vertical', () => {
    expect(panelBoundsUnits(panel({ category: 'roof', orientation: 'v' }))).toEqual({
      x: 0,
      y: 0,
      width: 5,
      height: 2,
    });
  });
});

describe('rectsIntersect', () => {
  const box: UnitRect = { x: 2, y: 2, width: 4, height: 4 };

  it('catches a panel wholly inside the box', () => {
    expect(rectsIntersect(panelBoundsUnits(panel({ x: 3, y: 3 })), box)).toBe(true);
  });

  it('catches a panel only partly inside the box', () => {
    // Runs from x=5 to x=7; the box ends at x=6.
    expect(rectsIntersect(panelBoundsUnits(panel({ x: 5, y: 3 })), box)).toBe(true);
  });

  it('misses a panel entirely outside the box', () => {
    expect(rectsIntersect(panelBoundsUnits(panel({ x: 8, y: 3 })), box)).toBe(false);
  });

  it('misses a panel on the right row but past the end of the box', () => {
    expect(rectsIntersect(panelBoundsUnits(panel({ x: 3, y: 9 })), box)).toBe(false);
  });

  it('catches a zero-height wall lying exactly on the box edge', () => {
    // The common case: a box dragged to finish flush with a wall run.
    expect(rectsIntersect(panelBoundsUnits(panel({ x: 3, y: 2 })), box)).toBe(true);
  });

  it('is symmetric', () => {
    const a = panelBoundsUnits(panel({ x: 5, y: 3 }));
    expect(rectsIntersect(a, box)).toBe(rectsIntersect(box, a));
  });
});
