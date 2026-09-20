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
