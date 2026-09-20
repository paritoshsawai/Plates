import { describe, expect, it } from 'vitest';
import { isInsidePlot, validatePlan, wouldOverlap } from '../validation';
import { rectPlotFromFt } from '../plot';
import { tileRun } from '../tiling';
import { ftToUnits } from '../units';
import type { Panel, Plot } from '../types';

const plot: Plot = rectPlotFromFt(40, 40);

/** A closed rectangular room, laid with the minimum-panel tiling on each side. */
function closedRoom(widthFt: number, heightFt: number, originX = 0, originY = 0): Panel[] {
  const w = ftToUnits(widthFt);
  const h = ftToUnits(heightFt);
  return [
    ...tileRun(originX, originY, w, 'h')!,
    ...tileRun(originX, originY + h, w, 'h')!,
    ...tileRun(originX, originY, h, 'v')!,
    ...tileRun(originX + w, originY, h, 'v')!,
  ];
}

describe('validatePlan', () => {
  it('accepts a closed room as manufacturable', () => {
    const result = validatePlan(closedRoom(20, 16), plot);
    expect(result.errors).toEqual([]);
    expect(result.manufacturable).toBe(true);
  });

  it('flags an empty plan as not manufacturable, without an error', () => {
    const result = validatePlan([], plot);
    expect(result.manufacturable).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.warnings[0].code).toBe('empty-plan');
  });

  it('detects a gap left by a removed panel', () => {
    const panels = closedRoom(20, 16);
    const withGap = panels.slice(1);
    const result = validatePlan(withGap, plot);
    expect(result.manufacturable).toBe(false);
    expect(result.errors.some((e) => e.code === 'open-end')).toBe(true);
  });

  it('detects two panels claiming the same 2 ft of wall', () => {
    const panels = closedRoom(20, 16);
    const duplicate: Panel = { ...panels[0], id: 'dup' };
    const result = validatePlan([...panels, duplicate], plot);
    expect(result.manufacturable).toBe(false);
    const overlap = result.errors.find((e) => e.code === 'overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.panelIds).toContain('dup');
    expect(overlap!.panelIds).toContain(panels[0].id);
  });

  it('detects a panel that leaves the plot', () => {
    const outside: Panel = { id: 'out', category: 'wall', size: '4x10', x: 30, y: 30, orientation: 'h' };
    const result = validatePlan([...closedRoom(20, 16), outside], plot);
    expect(result.errors.some((e) => e.code === 'outside-plot')).toBe(true);
    expect(result.flaggedPanelIds.has('out')).toBe(true);
  });

  it('accepts walls that run exactly along the plot boundary', () => {
    const result = validatePlan(closedRoom(40, 40), plot);
    expect(result.errors).toEqual([]);
  });

  it('flags a lone stub wall at both ends', () => {
    const stub: Panel[] = [{ id: 's', category: 'wall', size: '4x10', x: 2, y: 2, orientation: 'h' }];
    const result = validatePlan(stub, plot);
    const openEnds = result.errors.filter((e) => e.code === 'open-end');
    expect(openEnds).toHaveLength(2);
  });

  it('warns but does not fail on two detached structures', () => {
    const panels = [...closedRoom(8, 8, 0, 0), ...closedRoom(8, 8, 10, 10)];
    const result = validatePlan(panels, plot);
    expect(result.manufacturable).toBe(true);
    expect(result.warnings.some((w) => w.code === 'disconnected')).toBe(true);
  });

  it('accepts two rooms sharing a party wall', () => {
    // Rooms side by side sharing the wall at x = 10 units (20 ft).
    const panels = [...closedRoom(20, 16, 0, 0), ...closedRoom(20, 16, 10, 0)].filter(
      // Drop the duplicate party wall - the second room's left wall repeats the
      // first room's right wall, which is exactly the overlap the engine catches.
      (p, i, all) =>
        all.findIndex(
          (q) => q.x === p.x && q.y === p.y && q.orientation === p.orientation && q.size === p.size,
        ) === i,
    );
    const result = validatePlan(panels, plot);
    expect(result.errors).toEqual([]);
    expect(result.manufacturable).toBe(true);
  });

  it('rejects a panel size that is not manufactured', () => {
    const bogus = { id: 'b', category: 'wall', size: '6x10', x: 0, y: 0, orientation: 'h' } as unknown as Panel;
    const result = validatePlan([bogus], plot);
    expect(result.errors[0].code).toBe('unknown-panel');
  });

  it('rejects an off-grid coordinate from an imported plan', () => {
    const offGrid = { id: 'o', category: 'wall', size: '4x10', x: 1.5, y: 0, orientation: 'h' } as Panel;
    const result = validatePlan([offGrid], plot);
    expect(result.errors[0].code).toBe('off-grid');
  });
});

/** The pre-placement guards the canvas uses to refuse a drop. */
describe('wouldOverlap', () => {
  // A 4 ft panel spanning grid edges 0 and 1 along y = 0.
  const existing: Panel[] = [{ id: 'a', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'h' }];

  it('rejects a panel landing on an occupied segment', () => {
    expect(wouldOverlap(existing, { id: 'b', category: 'wall', size: '2x10', x: 0, y: 0, orientation: 'h' })).toBe(true);
    expect(wouldOverlap(existing, { id: 'b', category: 'wall', size: '2x10', x: 1, y: 0, orientation: 'h' })).toBe(true);
  });

  it('rejects a 4 ft panel that only partly overlaps', () => {
    expect(wouldOverlap(existing, { id: 'b', category: 'wall', size: '4x10', x: 1, y: 0, orientation: 'h' })).toBe(true);
  });

  it('accepts a panel butting up against the existing one', () => {
    expect(wouldOverlap(existing, { id: 'b', category: 'wall', size: '4x10', x: 2, y: 0, orientation: 'h' })).toBe(false);
  });

  it('accepts a perpendicular panel sharing only a node', () => {
    expect(wouldOverlap(existing, { id: 'b', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'v' })).toBe(false);
  });

  it('ignores the panel being moved, so a no-op drag is not an overlap', () => {
    expect(wouldOverlap(existing, { ...existing[0] })).toBe(false);
  });
});

describe('isInsidePlot', () => {
  it('accepts a panel lying along the boundary', () => {
    expect(isInsidePlot(plot, { id: 'a', category: 'wall', size: '4x10', x: 0, y: 0, orientation: 'h' })).toBe(true);
  });

  it('rejects a panel that starts before the origin', () => {
    expect(isInsidePlot(plot, { id: 'a', category: 'wall', size: '4x10', x: 0, y: -1, orientation: 'v' })).toBe(false);
  });

  it('rejects a panel whose far end leaves the plot', () => {
    // The 40 ft plot is 20 units wide; a 4 ft panel starting at 19 runs to 21.
    expect(isInsidePlot(plot, { id: 'a', category: 'wall', size: '4x10', x: 19, y: 0, orientation: 'h' })).toBe(false);
    expect(isInsidePlot(plot, { id: 'a', category: 'wall', size: '2x10', x: 19, y: 0, orientation: 'h' })).toBe(true);
  });
});

/**
 * Floor and roof sit on their own planes. The wall checks must not see them,
 * and they must not see each other.
 */
describe('area categories', () => {
  const bigPlot = rectPlotFromFt(60, 60);

  function room20x20(): Panel[] {
    const u = ftToUnits(20);
    return [
      ...tileRun(0, 0, u, 'h')!,
      ...tileRun(0, u, u, 'h')!,
      ...tileRun(0, 0, u, 'v')!,
      ...tileRun(u, 0, u, 'v')!,
    ];
  }

  /** One full-depth floor strip across a 20 ft span. */
  function strip(category: 'floor' | 'roof', y = 0): Panel[] {
    return [0, 2, 4, 6, 8].map((x, i) => ({
      id: `${category}-${y}-${i}`,
      category,
      size: '4x10' as const,
      x,
      y,
      orientation: 'h' as const,
    }));
  }

  it('lets a floor and a roof share the same cells', () => {
    const panels = [...room20x20(), ...strip('floor', 0), ...strip('floor', 5), ...strip('roof', 0), ...strip('roof', 5)];
    const result = validatePlan(panels, bigPlot);
    expect(result.errors).toEqual([]);
    expect(result.manufacturable).toBe(true);
  });

  it('rejects two floor panels on the same cells', () => {
    const panels = [...room20x20(), ...strip('floor', 0), ...strip('floor', 0)];
    const result = validatePlan(panels, bigPlot);
    expect(result.errors.some((e) => e.code === 'area-overlap')).toBe(true);
  });

  it('does not let a floor panel break the wall gap check', () => {
    // Area panels produce no edges, so they must not appear as open ends.
    const panels = [...room20x20(), ...strip('floor', 0)];
    const result = validatePlan(panels, bigPlot);
    expect(result.errors.filter((e) => e.code === 'open-end')).toEqual([]);
  });

  it('blocks the plan when a floor does not reach the whole building', () => {
    const panels = [...room20x20(), ...strip('floor', 0)];
    const result = validatePlan(panels, bigPlot);
    const issue = result.errors.find((e) => e.code === 'area-incomplete');
    expect(issue).toBeDefined();
    // Half the 400 sq ft room is still bare.
    expect(issue!.message).toContain('200 sq ft');
    expect(result.manufacturable).toBe(false);
  });

  it('carries the uncovered cells so the plan can shade them', () => {
    const panels = [...room20x20(), ...strip('floor', 0)];
    const issue = validatePlan(panels, bigPlot).errors.find((e) => e.code === 'area-incomplete');
    // 200 sq ft of bare floor is 50 cells of 2 x 2 ft, all in the lower half.
    expect(issue!.cells).toHaveLength(50);
    expect(issue!.cells!.every((cell) => cell.y >= 5)).toBe(true);
  });

  it('says nothing about a category with no panels at all', () => {
    // A wall-only plan is a legitimate work in progress, not a broken one.
    const result = validatePlan(room20x20(), bigPlot);
    expect(result.issues.some((i) => i.code === 'area-incomplete')).toBe(false);
    expect(result.manufacturable).toBe(true);
  });

  it('rejects a floor panel that leaves the plot', () => {
    const tiny = rectPlotFromFt(10, 10);
    const stray: Panel = { id: 's', category: 'floor', size: '4x10', x: 8, y: 0, orientation: 'h' };
    const result = validatePlan([...room20x20(), stray], tiny);
    expect(result.errors.some((e) => e.code === 'area-outside-plot')).toBe(true);
  });
});
